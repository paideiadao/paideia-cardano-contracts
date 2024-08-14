use aiken/cbor.{serialise}
use aiken/dict.{to_pairs}
use aiken/hash.{blake2b_256}
use aiken/list.{map}
use aiken/option.{is_some}
use aiken/transaction.{
  InlineDatum, Mint, OutputReference, ScriptContext, find_input,
  find_script_outputs,
}
use aiken/transaction/value.{
  AssetName, PolicyId, from_minted_value, quantity_of, tokens,
}

pub type DAODatum {
  name: String,
  governance_token: ByteArray,
  threshold: Int,
  min_proposal_time: Int,
  max_proposal_time: Int,
  quorum: Int,
  min_gov_proposal_create: Int,
  whitelisted_proposals: List<ByteArray>,
  whitelisted_actions: List<ByteArray>,
}

pub type DAORedeemer {
  CreateDAO { output_ref: OutputReference }
}

pub fn get_dao_datum_from_reference(
  ctx: ScriptContext,
  dao_policy_id: PolicyId,
  dao_key: AssetName,
) -> DAODatum {
  expect [dao_reference] =
    ctx.transaction.reference_inputs
      |> map(fn(ri) { ri.output })
      |> list.filter(
          fn(o) { ( o.value |> quantity_of(dao_policy_id, dao_key) ) > 0 },
        )
  expect InlineDatum(dao_data) = dao_reference.datum
  expect dao_datum: DAODatum = dao_data
  dao_datum
}

pub fn unique_dao_identifier(output_ref: OutputReference) -> AssetName {
  blake2b_256(serialise(output_ref))
}

pub fn output_ref_exists(
  ctx: ScriptContext,
  output_ref: OutputReference,
) -> Bool {
  find_input(ctx.transaction.inputs, output_ref) |> is_some
}

pub fn only_one_identifier_minted(
  ctx: ScriptContext,
  policy_id: PolicyId,
  dao_identifier: AssetName,
) -> Bool {
  expect [Pair(minted_asset_name, minted_amount)] =
    ctx.transaction.mint |> from_minted_value |> tokens(policy_id) |> to_pairs
  and {
    (minted_asset_name == dao_identifier)?,
    (minted_amount == 1)?,
  }
}

pub fn minted_into_dao(
  ctx: ScriptContext,
  policy_id: PolicyId,
  dao_identifier: AssetName,
) -> Bool {
  expect [dao_output] = find_script_outputs(ctx.transaction.outputs, policy_id)
  expect InlineDatum(dao_data) = dao_output.datum
  expect _dao_datum: DAODatum = dao_data
  quantity_of(dao_output.value, policy_id, dao_identifier) == 1
}

pub fn mint(redeemer: DAORedeemer, ctx: ScriptContext) -> Bool {
  let CreateDAO { output_ref } = redeemer
  expect Mint(policy_id) = ctx.purpose
  let dao_identifier = unique_dao_identifier(output_ref)
  and {
    output_ref_exists(ctx, output_ref)?,
    only_one_identifier_minted(ctx, policy_id, dao_identifier)?,
    minted_into_dao(ctx, policy_id, dao_identifier)?,
  }
}

pub fn spend() -> Bool {
  False
}
