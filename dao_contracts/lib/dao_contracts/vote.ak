use aiken/bytearray.{concat, drop, take}
use aiken/cbor.{serialise}
use aiken/dict.{filter, size, to_pairs}
use aiken/hash.{blake2b_256}
use aiken/list.{all, at, length, map}
use aiken/transaction.{
  InlineDatum, Mint, Output, OutputReference, ScriptContext, Spend, find_input,
  find_script_outputs,
}
use aiken/transaction/credential.{Address, ScriptCredential}
use aiken/transaction/value.{
  AssetName, PolicyId, from_minted_value, merge, quantity_of, tokens,
}
use dao_contracts/dao.{DAODatum, get_dao_datum_from_reference}

pub type VoteDatum {
  metadata: Pairs<ByteArray, ByteArray>,
  version: Int,
  extra: Data,
}

pub type VoteRedeemer {
  CreateVote { output_ref: OutputReference }
  CastVote
  CleanReceipts
  EmptyVote
}

pub const reference_prefix = #"0000"

pub const nft_prefix: ByteArray = #"0001"

pub fn unique_cip68_asset_name(output_ref: OutputReference) -> ByteArray {
  blake2b_256(serialise(output_ref)) |> take(28)
}

fn minted_cip68_vote_tokens(
  policy_id: PolicyId,
  unique_name: ByteArray,
  ctx: ScriptContext,
) -> Bool {
  let minted_tokens =
    from_minted_value(ctx.transaction.mint) |> tokens(policy_id)
  expect [reference_token] =
    filter(
      minted_tokens,
      fn(k, _v) { k == concat(reference_prefix, unique_name) },
    )
      |> to_pairs()
  expect [vote_token] =
    filter(minted_tokens, fn(k, _v) { k == concat(nft_prefix, unique_name) })
      |> to_pairs()
  and {
    (reference_token.2nd == 1)?,
    (vote_token.2nd == 1)?,
  }
}

pub fn get_vote_reference(
  ctx: ScriptContext,
  vote_policy_id: PolicyId,
  vote_key: ByteArray,
) -> Output {
  expect [vote_reference] =
    ctx.transaction.reference_inputs
      |> map(fn(ri) { ri.output })
      |> list.filter(
          fn(o) {
            (
              o.value
                |> quantity_of(vote_policy_id, concat(reference_prefix, vote_key))
            ) > 0
          },
        )
  vote_reference
}

fn reference_into_valid_vote_utxo(
  vote_output: Output,
  policy_id: PolicyId,
  unique_name: ByteArray,
  dao_datum: DAODatum,
) -> Bool {
  expect InlineDatum(vote_data) = vote_output.datum
  expect _: VoteDatum = vote_data

  let gov_policy_id = dao_datum.governance_token |> take(28)
  let gov_asset_name = dao_datum.governance_token |> drop(28)

  let enough_governance_tokens =
    ( vote_output.value |> quantity_of(gov_policy_id, gov_asset_name) ) > 0
  let reference_token_in_vote =
    (
      vote_output.value
        |> quantity_of(policy_id, concat(reference_prefix, unique_name))
    ) > 0

  and {
    enough_governance_tokens?,
    reference_token_in_vote?,
  }
}

fn create_vote(
  policy_id: PolicyId,
  unique_name: ByteArray,
  ctx: ScriptContext,
  dao_datum: DAODatum,
) -> Bool {
  expect [vote_output] = find_script_outputs(ctx.transaction.outputs, policy_id)
  and {
    minted_cip68_vote_tokens(policy_id, unique_name, ctx)?,
    reference_into_valid_vote_utxo(
      vote_output,
      policy_id,
      unique_name,
      dao_datum,
    )?,
  }
}

fn key_and_reference_burned(ctx: ScriptContext, policy_id: PolicyId) -> Bool {
  let minted_tokens =
    ctx.transaction.mint
      |> from_minted_value()
      |> tokens(policy_id)
      |> to_pairs()
  expect length(minted_tokens) == 2
  let all_burned = minted_tokens |> all(fn(t) { t.2nd == -1 })
  expect Some(first_token) = minted_tokens |> at(0)
  expect Some(second_token) = minted_tokens |> at(1)
  let matching_pair_burned =
    drop(first_token.1st, 4) == drop(second_token.1st, 4)
  and {
    all_burned?,
    matching_pair_burned?,
  }
}

fn no_vote_receipts_present(ctx: ScriptContext, dao_datum: DAODatum) -> Bool {
  dao_datum.whitelisted_proposals
    |> all(
        fn(wlp) {
          ctx.transaction.inputs
            |> all(fn(i) { ( i.output.value |> tokens(wlp) |> size() ) == 0 })
        },
      )
}

fn empty_vote_mint(
  ctx: ScriptContext,
  policy_id: PolicyId,
  dao_datum: DAODatum,
) -> Bool {
  and {
    key_and_reference_burned(ctx, policy_id)?,
    no_vote_receipts_present(ctx, dao_datum)?,
  }
}

pub fn mint(
  redeemer: VoteRedeemer,
  ctx: ScriptContext,
  dao_policy_id: PolicyId,
  dao_key: AssetName,
) -> Bool {
  expect Mint(policy_id) = ctx.purpose
  let dao_datum = get_dao_datum_from_reference(ctx, dao_policy_id, dao_key)
  when redeemer is {
    CreateVote(output_ref) -> {
      let unique_name = unique_cip68_asset_name(output_ref)
      create_vote(policy_id, unique_name, ctx, dao_datum)
    }
    EmptyVote -> empty_vote_mint(ctx, policy_id, dao_datum)
    _ -> fail @"Wrong redeemer type"
  }
}

fn same_plus_minted(ctx: ScriptContext, output_ref: OutputReference) -> Bool {
  expect Some(vote_input) = find_input(ctx.transaction.inputs, output_ref)
  expect Address(ScriptCredential(policy_id), _) = vote_input.output.address
  expect [vote_output] = find_script_outputs(ctx.transaction.outputs, policy_id)
  and {
    (vote_input.output.address == vote_output.address)?,
    (vote_input.output.datum == vote_output.datum)?,
    (merge(vote_input.output.value, ctx.transaction.mint |> from_minted_value()) == vote_output.value)?,
  }
}

fn empty_vote(ctx: ScriptContext, output_ref: OutputReference) -> Bool {
  expect Some(vote_input) = find_input(ctx.transaction.inputs, output_ref)
  expect Address(ScriptCredential(policy_id), _) = vote_input.output.address
  expect [reference_nft] =
    vote_input.output.value |> tokens(policy_id) |> to_pairs()
  let minted_tokens =
    ctx.transaction.mint
      |> from_minted_value()
      |> quantity_of(policy_id, reference_nft.1st)
  reference_nft.2nd * -1 == minted_tokens
}

pub fn spend(
  _datum: VoteDatum,
  redeemer: VoteRedeemer,
  ctx: ScriptContext,
) -> Bool {
  expect Spend(output_ref) = ctx.purpose
  when redeemer is {
    CastVote -> same_plus_minted(ctx, output_ref)
    CleanReceipts -> same_plus_minted(ctx, output_ref)
    EmptyVote -> empty_vote(ctx, output_ref)
    _ -> fail @"Wrong redeemer type"
  }
}
