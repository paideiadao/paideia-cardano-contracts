use aiken/cbor.{serialise}
use aiken/collection/dict.{get, keys, size, to_pairs}
use aiken/collection/list.{
  all, any, at, filter, find, foldl, indexed_map, length, map, range, zip,
}
use aiken/crypto.{blake2b_256}
use aiken/interval.{Finite, Interval, IntervalBound}
use aiken/option.{and_then, is_some, or_else}
use aiken/primitive/bytearray.{drop, take}
use cardano/address.{Script}
use cardano/assets.{
  AssetName, PolicyId, ada_policy_id, flatten, quantity_of, to_dict,
  tokens, without_lovelace,
}
use cardano/transaction.{
  Datum, InlineDatum, Input, Output, OutputReference, Transaction, find_input,
  find_script_outputs,
}
use dao_contracts/dao.{DAODatum, get_dao_datum_from_reference}
use dao_contracts/utils.{after_time}
use dao_contracts/vote.{get_vote_reference}

pub type ProposalStatus {
  Active
  FailedThreshold
  FailedQuorum
  Passed(Int)
}

pub type ProposalDatum {
  name: String,
  description: String,
  tally: List<Int>,
  end_time: Int,
  status: ProposalStatus,
  identifier: OutputReference,
}

pub type ProposalIdentifier {
  identifier: OutputReference,
  index: Int,
}

pub type VoteReceiptIdentifier {
  proposal_identifier: ByteArray,
  index: Int,
}

pub type ProposalRedeemer {
  CreateProposal { vote_key: ByteArray }
  CastVote
  CleanReceipts
  EvaluateProposal
}

fn minimum_staked(
  tx: Transaction,
  dao_datum: DAODatum,
  vote_policy_id: PolicyId,
  vote_key: ByteArray,
) -> Bool {
  let vote_output = get_vote_reference(tx, vote_policy_id, vote_key)
  let staked_governance =
    quantity_of(
      vote_output.value,
      take(dao_datum.governance_token, 28),
      drop(dao_datum.governance_token, 28),
    )
  staked_governance >= dao_datum.min_gov_proposal_create
}

fn correct_duration(
  tx: Transaction,
  dao_datum: DAODatum,
  proposal_datum: ProposalDatum,
) -> Bool {
  expect Interval {
    upper_bound: IntervalBound { bound_type: Finite(tx_time), .. },
    ..
  } = tx.validity_range
  let minimum_duration =
    proposal_datum.end_time >= tx_time + dao_datum.min_proposal_time
  let maximum_duration =
    proposal_datum.end_time <= tx_time + dao_datum.max_proposal_time
  and {
    minimum_duration?,
    maximum_duration?,
  }
}

pub fn get_proposal_identifier(output_ref: OutputReference) -> AssetName {
  blake2b_256(
    serialise(ProposalIdentifier { identifier: output_ref, index: -1 }),
  )
}

pub fn get_vote_receipt_identifier(
  identifier: ByteArray,
  index: Int,
) -> ByteArray {
  blake2b_256(
    serialise(VoteReceiptIdentifier { proposal_identifier: identifier, index }),
  )
}

fn single_identifier_minted_into_proposal(
  tx: Transaction,
  policy_id: PolicyId,
  proposal_output: Output,
  proposal_datum: ProposalDatum,
) -> Bool {
  expect Some(_output_ref_present) =
    find_input(tx.inputs, proposal_datum.identifier)
  expect [minted_proposal_identifier] =
    tx.mint |> tokens(policy_id) |> to_pairs()
  let proposal_identifier = minted_proposal_identifier.1st
  let proposal_identifier_amount = minted_proposal_identifier.2nd
  let correct_identifier = get_proposal_identifier(proposal_datum.identifier)
  and {
    (proposal_identifier == correct_identifier)?,
    (proposal_identifier_amount == 1)?,
    (quantity_of(proposal_output.value, policy_id, proposal_identifier) >= 1)?,
  }
}

fn create_proposal(
  tx: Transaction,
  dao_datum: DAODatum,
  vote_policy_id: PolicyId,
  vote_key: ByteArray,
  policy_id: PolicyId,
) -> Bool {
  expect [proposal_output] = find_script_outputs(tx.outputs, policy_id)
  let proposal_datum = to_proposal_datum(proposal_output.datum)
  and {
    minimum_staked(tx, dao_datum, vote_policy_id, vote_key)?,
    correct_duration(tx, dao_datum, proposal_datum)?,
    single_identifier_minted_into_proposal(
      tx,
      policy_id,
      proposal_output,
      proposal_datum,
    )?,
  }
}

pub fn to_proposal_datum(datum: Data) -> ProposalDatum {
  expect InlineDatum(proposal_data): Datum = datum
  expect proposal_datum: ProposalDatum = proposal_data
  proposal_datum
}

fn find_script_inputs(inputs: List<Input>, policy_id: PolicyId) -> List<Output> {
  find_script_outputs(inputs |> map(fn(i) { i.output }), policy_id)
}

fn get_tally_difference(in: List<Int>, out: List<Int>) -> List<Int> {
  zip(in, out) |> map(fn(io) { io.2nd - io.1st })
}

fn tokens_minted_burned_according_to_tally(
  tx: Transaction,
  policy_id: PolicyId,
  identifier: ByteArray,
  tally_difference: List<Int>,
) -> Bool {
  let minted_tokens = tx.mint |> tokens(policy_id)
  let number_of_changes =
    tally_difference |> filter(fn(td) { td != 0 }) |> length()
  let tally_matches_mint =
    tally_difference
      |> indexed_map(
          fn(i, td) {
            let vote_receipt = get_vote_receipt_identifier(identifier, i)
            if td == 0 {
              get(minted_tokens, vote_receipt) == None
            } else {
              get(minted_tokens, vote_receipt) == Some(td)
            }
          },
        )
      |> all(fn(b) { b })
  and {
    tally_matches_mint,
    size(minted_tokens) == number_of_changes,
  }
}

fn vote_not_exceed_governance(dao_datum: DAODatum, vote_output: Output) -> Bool {
  let governance_amount =
    quantity_of(
      vote_output.value,
      take(dao_datum.governance_token, 28),
      drop(dao_datum.governance_token, 28),
    )
  flatten(vote_output.value)
    |> all(fn(a) { a.3rd <= governance_amount || a.1st == ada_policy_id })
}

fn before_end_time(tx: Transaction, proposal_datum: ProposalDatum) -> Bool {
  expect Interval {
    upper_bound: IntervalBound { bound_type: Finite(tx_time), .. },
    ..
  } = tx.validity_range
  tx_time <= proposal_datum.end_time
}

fn no_leaking_vote_receipts(
  tx: Transaction,
  policy_id: PolicyId,
  identifier: AssetName,
  vote_policy_id: PolicyId,
) -> Bool {
  tx.outputs
    |> filter(fn(o) { o.address.payment_credential != Script(vote_policy_id) })
    |> all(
        fn(o) {
          o.value
            |> tokens(policy_id)
            |> keys()
            |> all(fn(an) { an == identifier })
        },
      )
}

fn cast_vote(
  tx: Transaction,
  dao_datum: DAODatum,
  policy_id: PolicyId,
  vote_policy_id: PolicyId,
) -> Bool {
  expect [proposal_output] = find_script_outputs(tx.outputs, policy_id)
  expect [proposal_input] = find_script_inputs(tx.inputs, policy_id)
  expect [vote_output] = find_script_outputs(tx.outputs, vote_policy_id)
  let proposal_input_datum = to_proposal_datum(proposal_input.datum)
  let proposal_output_datum = to_proposal_datum(proposal_output.datum)
  let tally_difference =
    get_tally_difference(
      proposal_input_datum.tally,
      proposal_output_datum.tally,
    )
  let identifier = get_proposal_identifier(proposal_input_datum.identifier)
  and {
    tokens_minted_burned_according_to_tally(
      tx,
      policy_id,
      identifier,
      tally_difference,
    )?,
    vote_not_exceed_governance(dao_datum, vote_output)?,
    before_end_time(tx, proposal_output_datum)?,
    no_leaking_vote_receipts(tx, policy_id, identifier, vote_policy_id)?,
  }
}

fn proposals_ended(
  policy_id: PolicyId,
  burned_tokens: Pairs<ByteArray, Int>,
  proposal_references: List<Output>,
) -> Bool {
  burned_tokens
    |> all(
        fn(bt) {
          is_some(
            proposal_references
              |> find(
                  fn(pr) {
                    let proposal_datum = to_proposal_datum(pr.datum)
                    let identifier =
                      get_proposal_identifier(proposal_datum.identifier)
                    expect Some(_) =
                      range(0, length(proposal_datum.tally) - 1)
                        |> find(
                            fn(i) {
                              bt.1st == get_vote_receipt_identifier(
                                identifier,
                                i,
                              )
                            },
                          )
                    and {
                      quantity_of(pr.value, policy_id, identifier) > 0,
                      proposal_datum.status != Active,
                      bt.2nd < 0,
                    }
                  },
                ),
          )
        },
      )
}

fn clean_receipts(tx: Transaction, policy_id: PolicyId) -> Bool {
  let burned_tokens =
    tx.mint
      |> tokens(policy_id)
      |> to_pairs()
  let proposal_references = find_script_inputs(tx.reference_inputs, policy_id)
  proposals_ended(policy_id, burned_tokens, proposal_references)
}

pub fn mint(
  policy_id: PolicyId,
  redeemer: ProposalRedeemer,
  tx: Transaction,
  dao_policy_id: PolicyId,
  dao_key: AssetName,
  vote_policy_id: PolicyId,
) -> Bool {
  let dao_datum = get_dao_datum_from_reference(tx, dao_policy_id, dao_key)
  when redeemer is {
    CreateProposal { vote_key } ->
      create_proposal(tx, dao_datum, vote_policy_id, vote_key, policy_id)
    CastVote -> cast_vote(tx, dao_datum, policy_id, vote_policy_id)
    CleanReceipts -> clean_receipts(tx, policy_id)
    _ -> fail @"Wrong redeemer type"
  }
}

fn mint_policy_present(tx: Transaction, policy_id: PolicyId) -> Bool {
  expect Some(_) = tx.mint |> to_dict() |> get(policy_id)
  True
}

fn utxo_unchanged_except_tally(
  input: Output,
  input_datum: ProposalDatum,
  output: Output,
) -> Bool {
  let output_datum = to_proposal_datum(output.datum)
  let input_without_tally = ProposalDatum { ..input_datum, tally: [] }
  let output_without_tally = ProposalDatum { ..output_datum, tally: [] }
  and {
    input.address == output.address,
    (without_lovelace(input.value) == without_lovelace(output.value))?,
    input_without_tally == output_without_tally,
  }
}

fn cast_vote_spend(
  tx: Transaction,
  datum: ProposalDatum,
  output_ref: OutputReference,
) -> Bool {
  expect Some(proposal_input) = find_input(tx.inputs, output_ref)
  expect Script(policy_id) = proposal_input.output.address.payment_credential
  expect [proposal_output] = find_script_outputs(tx.outputs, policy_id)
  and {
    utxo_unchanged_except_tally(proposal_input.output, datum, proposal_output)?,
    before_end_time(tx, datum)?,
    mint_policy_present(tx, policy_id)?,
  }
}

fn utxo_unchanged_except_status(
  input: Output,
  input_datum: ProposalDatum,
  output: Output,
) -> Bool {
  let output_datum = to_proposal_datum(output.datum)
  let input_without_status = ProposalDatum { ..input_datum, status: Active }
  let output_without_status = ProposalDatum { ..output_datum, status: Active }
  and {
    (input.address == output.address)?,
    (without_lovelace(input.value) == without_lovelace(output.value))?,
    (input_without_status == output_without_status)?,
  }
}

fn not_evaluated_yet(datum: ProposalDatum) -> Bool {
  datum.status == Active
}

fn correct_winner(dao_datum: DAODatum, proposal_output: Output) -> Bool {
  let datum = to_proposal_datum(proposal_output.datum)
  let tally_total = datum.tally |> foldl(0, fn(n, total) { n + total })
  let quorum_met = tally_total >= dao_datum.quorum
  let threshold_met =
    tally_total > 0 && (
      datum.tally
        |> any(fn(v) { v * 100 / tally_total >= dao_datum.threshold })
    )
  when datum.status is {
    Active -> False
    FailedThreshold -> and {
        quorum_met,
        not(threshold_met),
      }
    FailedQuorum -> not(quorum_met)
    Passed(winning) -> and {
        quorum_met,
        threshold_met,
        datum.tally
          |> at(winning)
          |> and_then(fn(t) { Some(t > tally_total / 2) })
          |> or_else(False),
      }
  }
}

fn evaluate_proposal(
  tx: Transaction,
  dao_datum: DAODatum,
  output_ref: OutputReference,
  datum: ProposalDatum,
) -> Bool {
  expect Some(proposal_input) = find_input(tx.inputs, output_ref)
  expect Script(policy_id) = proposal_input.output.address.payment_credential
  expect [proposal_output] = find_script_outputs(tx.outputs, policy_id)
  and {
    utxo_unchanged_except_status(proposal_input.output, datum, proposal_output)?,
    after_time(tx, datum.end_time)?,
    not_evaluated_yet(datum)?,
    correct_winner(dao_datum, proposal_output)?,
  }
}

pub fn spend(
  datum: ProposalDatum,
  redeemer: ProposalRedeemer,
  tx: Transaction,
  dao_policy_id: PolicyId,
  dao_key: AssetName,
  output_ref: OutputReference,
) -> Bool {
  when redeemer is {
    CastVote -> cast_vote_spend(tx, datum, output_ref)
    EvaluateProposal -> {
      let dao_datum = get_dao_datum_from_reference(tx, dao_policy_id, dao_key)
      evaluate_proposal(tx, dao_datum, output_ref, datum)
    }
    _ -> fail @"Wrong redeemer type"
  }
}
