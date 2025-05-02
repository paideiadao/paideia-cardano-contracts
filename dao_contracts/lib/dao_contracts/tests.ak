use aiken/interval.{Finite, Interval, IntervalBound}
use aiken/primitive/bytearray.{concat, drop, take}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{add, from_asset, from_lovelace}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use dao_contracts/dao.{CreateDAO, DAODatum, unique_dao_identifier}
use dao_contracts/proposal.{
  Active, CreateProposal, Passed, ProposalDatum, get_proposal_identifier,
  get_vote_receipt_identifier, to_proposal_datum,
}
use dao_contracts/vote.{
  CreateVote, EmptyVote, VoteDatum, nft_prefix, reference_prefix,
  unique_cip68_asset_name,
}

pub const test_dao_policy_id =
  #"00000000000000000000000100000000000000000000000000010000"

pub fn test_dao_output_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 666,
  }
}

pub const test_dao_token =
  #"ff000000000000000000000100000000000000000000000000010000ffff"

pub fn test_dao_datum() -> DAODatum {
  DAODatum {
    name: @"Test",
    governance_token: test_dao_token,
    threshold: 60,
    min_proposal_time: 2400,
    max_proposal_time: 2800,
    quorum: 10,
    min_gov_proposal_create: 1000,
    whitelisted_proposals: [test_proposal_policy_id],
    whitelisted_actions: [],
  }
}

pub fn test_dao_output() -> Output {
  Output {
    address: Address(Script(test_dao_policy_id), None),
    value: from_lovelace(2_000_000)
      |> add(
          test_dao_policy_id,
          unique_dao_identifier(test_user_output_ref()),
          1,
        ),
    datum: InlineDatum(test_dao_datum()),
    reference_script: None,
  }
}

pub const test_user_key =
  #"ee000000000000000000000100000000000000000000000000010000"

pub fn test_user_output() -> Output {
  Output {
    address: Address(VerificationKey(test_user_key), None),
    value: from_lovelace(100_000_000),
    datum: NoDatum,
    reference_script: None,
  }
}

pub fn test_user_output_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 123,
  }
}

pub fn test_user_input() -> Input {
  Input { output_reference: test_user_output_ref(), output: test_user_output() }
}

pub fn test_dao_input() -> Input {
  Input { output_reference: test_dao_output_ref(), output: test_dao_output() }
}

test dao_mint_create_dao() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [test_user_input()],
      outputs: [test_dao_output()],
      mint: from_asset(
        test_dao_policy_id,
        unique_dao_identifier(test_user_output_ref()),
        1,
      ),
    }

  let redeemer = CreateDAO(test_user_output_ref())

  dao.mint(test_dao_policy_id, redeemer, tx)
}

pub const test_vote_policy_id =
  #"cc000000000000000000000100000000000000000000000000010000"

pub fn test_vote_output() -> Output {
  Output {
    address: Address(Script(test_vote_policy_id), None),
    value: from_lovelace(2_000_000)
      |> add(
          test_vote_policy_id,
          concat(
            reference_prefix,
            unique_cip68_asset_name(test_user_output_ref()),
          ),
          1,
        )
      |> add(take(test_dao_token, 28), drop(test_dao_token, 28), 10_000_000),
    datum: InlineDatum(test_vote_datum()),
    reference_script: None,
  }
}

pub fn test_vote_output_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 321,
  }
}

pub fn test_vote_input() -> Input {
  Input { output_reference: test_vote_output_ref(), output: test_vote_output() }
}

pub fn test_vote_datum() -> VoteDatum {
  VoteDatum { metadata: [], version: 1, extra: None }
}

test vote_mint_create_vote() {
  let vote_key = unique_cip68_asset_name(test_user_output_ref())

  let user_output =
    Output {
      ..test_user_output(),
      value: test_user_output().value
        |> add(test_vote_policy_id, concat(nft_prefix, vote_key), 1),
    }

  let tx =
    Transaction {
      ..placeholder,
      inputs: [test_user_input()],
      reference_inputs: [test_dao_input()],
      outputs: [test_vote_output(), user_output],
      mint: from_asset(test_vote_policy_id, concat(nft_prefix, vote_key), 1)
        |> add(test_vote_policy_id, concat(reference_prefix, vote_key), 1),
    }

  let redeemer = CreateVote(test_user_output_ref())

  vote.mint(
    test_vote_policy_id,
    redeemer,
    tx,
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
  )
}

fn empty_vote_tx() -> Transaction {
  let vote_key = unique_cip68_asset_name(test_user_output_ref())

  Transaction {
    ..placeholder,
    inputs: [test_vote_input()],
    reference_inputs: [test_dao_input()],
    outputs: [],
    mint: from_asset(test_vote_policy_id, concat(nft_prefix, vote_key), -1)
      |> add(test_vote_policy_id, concat(reference_prefix, vote_key), -1),
  }
}

test vote_mint_empty_vote() {
  let redeemer = EmptyVote

  vote.mint(
    test_vote_policy_id,
    redeemer,
    empty_vote_tx(),
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
  )
}

test vote_spend_empty_vote() {
  let redeemer = EmptyVote

  vote.spend(
    test_vote_datum(),
    redeemer,
    empty_vote_tx(),
    test_vote_output_ref(),
  )
}

pub const test_proposal_policy_id =
  #"dd000000000000000000000100000000000000000000000000010000"

pub fn test_proposal_datum() -> ProposalDatum {
  ProposalDatum {
    name: @"Test",
    description: @"Test",
    tally: [0, 0],
    end_time: 3500,
    status: Active,
    identifier: test_user_output_ref(),
  }
}

pub fn test_proposal_output() -> Output {
  Output {
    address: Address(Script(test_proposal_policy_id), None),
    value: from_lovelace(2_000_000)
      |> add(
          test_proposal_policy_id,
          get_proposal_identifier(test_proposal_datum().identifier),
          1,
        ),
    datum: InlineDatum(test_proposal_datum()),
    reference_script: None,
  }
}

pub fn test_proposal_output_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 111,
  }
}

pub fn test_proposal_input() -> Input {
  Input {
    output: test_proposal_output(),
    output_reference: test_proposal_output_ref(),
  }
}

test proposal_mint_create_proposal() {
  let vote_key = unique_cip68_asset_name(test_user_output_ref())
  let tx =
    Transaction {
      ..placeholder,
      inputs: [test_user_input()],
      reference_inputs: [test_dao_input(), test_vote_input()],
      outputs: [test_proposal_output()],
      validity_range: Interval(
        IntervalBound(Finite(0), True),
        IntervalBound(Finite(1000), True),
      ),
      mint: from_asset(
        test_proposal_policy_id,
        get_proposal_identifier(test_proposal_datum().identifier),
        1,
      ),
    }

  let redeemer = CreateProposal(vote_key)

  proposal.mint(
    test_proposal_policy_id,
    redeemer,
    tx,
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_vote_policy_id,
  )
}

fn cast_vote_tx() -> Transaction {
  let output_proposal_datum =
    ProposalDatum { ..test_proposal_datum(), tally: [0, 100] }
  let proposal_output =
    Output {
      ..test_proposal_output(),
      datum: InlineDatum(output_proposal_datum),
    }

  let vote_receipt =
    get_vote_receipt_identifier(
      get_proposal_identifier(output_proposal_datum.identifier),
      1,
    )

  let vote_output =
    Output {
      ..test_vote_output(),
      value: test_vote_output().value
        |> add(test_proposal_policy_id, vote_receipt, 100),
    }

  Transaction {
    ..placeholder,
    inputs: [test_proposal_input(), test_vote_input()],
    reference_inputs: [test_dao_input()],
    outputs: [proposal_output, vote_output],
    mint: from_asset(test_proposal_policy_id, vote_receipt, 100),
    validity_range: Interval(
      IntervalBound(Finite(1000), True),
      IntervalBound(Finite(1001), True),
    ),
  }
}

test proposal_mint_cast_vote() {
  let redeemer = proposal.CastVote

  proposal.mint(
    test_proposal_policy_id,
    redeemer,
    cast_vote_tx(),
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_vote_policy_id,
  )
}

test proposal_spend_cast_vote() {
  let redeemer = proposal.CastVote

  proposal.spend(
    to_proposal_datum(test_proposal_input().output.datum),
    redeemer,
    cast_vote_tx(),
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_proposal_output_ref(),
  )
}

test vote_spend_cast_vote() {
  let redeemer = vote.CastVote

  vote.spend(
    test_vote_datum(),
    redeemer,
    cast_vote_tx(),
    test_vote_output_ref(),
  )
}

fn clean_receipts_tx() -> Transaction {
  let output_proposal_datum =
    ProposalDatum {
      ..test_proposal_datum(),
      tally: [0, 100],
      status: Passed(1),
    }
  let proposal_output =
    Output {
      ..test_proposal_output(),
      datum: InlineDatum(output_proposal_datum),
    }

  let proposal_input =
    Input { output: proposal_output, output_reference: test_dao_output_ref() }

  let vote_receipt =
    get_vote_receipt_identifier(
      get_proposal_identifier(output_proposal_datum.identifier),
      1,
    )

  let vote_output =
    Output {
      ..test_vote_output(),
      value: test_vote_output().value
        |> add(test_proposal_policy_id, vote_receipt, 100),
    }

  let vote_input =
    Input { output: vote_output, output_reference: test_dao_output_ref() }
  Transaction {
    ..placeholder,
    inputs: [vote_input],
    reference_inputs: [proposal_input, test_dao_input()],
    outputs: [test_vote_output()],
    mint: from_asset(test_proposal_policy_id, vote_receipt, -100),
    validity_range: Interval(
      IntervalBound(Finite(5000), True),
      IntervalBound(Finite(5001), True),
    ),
  }
}

test proposal_mint_clean_receipts() {
  let redeemer = proposal.CleanReceipts

  proposal.mint(
    test_proposal_policy_id,
    redeemer,
    clean_receipts_tx(),
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_vote_policy_id,
  )
}

test vote_spend_clean_receipts() {
  let redeemer = vote.CleanReceipts

  vote.spend(
    test_vote_datum(),
    redeemer,
    clean_receipts_tx(),
    test_dao_output_ref(),
  )
}

test proposal_spend_evaluate_proposal() {
  let proposal_output_datum =
    ProposalDatum { ..test_proposal_datum(), status: proposal.FailedQuorum }

  let proposal_output =
    Output {
      ..test_proposal_output(),
      datum: InlineDatum(proposal_output_datum),
    }

  let tx =
    Transaction {
      ..placeholder,
      inputs: [test_proposal_input()],
      reference_inputs: [test_dao_input()],
      outputs: [proposal_output],
      validity_range: Interval(
        IntervalBound(Finite(5000), True),
        IntervalBound(Finite(5001), True),
      ),
    }

  let redeemer = proposal.EvaluateProposal

  proposal.spend(
    test_proposal_datum(),
    redeemer,
    tx,
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_proposal_output_ref(),
  )
}
