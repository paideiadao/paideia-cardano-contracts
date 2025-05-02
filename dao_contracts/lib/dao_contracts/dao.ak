use aiken/cbor.{serialise}
use aiken/collection/dict.{to_pairs}
use aiken/collection/list.{map}
use aiken/crypto.{blake2b_256}
use aiken/option.{is_some}
use cardano/assets.{AssetName, PolicyId, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, OutputReference, Transaction, find_input, find_script_outputs,
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
  tx: Transaction,
  dao_policy_id: PolicyId,
  dao_key: AssetName,
) -> DAODatum {
  expect [dao_reference] =
    tx.reference_inputs
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

pub fn output_ref_exists(tx: Transaction, output_ref: OutputReference) -> Bool {
  find_input(tx.inputs, output_ref) |> is_some
}

pub fn only_one_identifier_minted(
  tx: Transaction,
  policy_id: PolicyId,
  dao_identifier: AssetName,
) -> Bool {
  expect [Pair(minted_asset_name, minted_amount)] =
    tx.mint |> tokens(policy_id) |> to_pairs
  and {
    (minted_asset_name == dao_identifier)?,
    (minted_amount == 1)?,
  }
}

pub fn minted_into_dao(
  tx: Transaction,
  policy_id: PolicyId,
  dao_identifier: AssetName,
) -> Bool {
  expect [dao_output] = find_script_outputs(tx.outputs, policy_id)
  expect InlineDatum(dao_data) = dao_output.datum
  expect _dao_datum: DAODatum = dao_data
  quantity_of(dao_output.value, policy_id, dao_identifier) == 1
}

pub fn mint(policy_id: PolicyId, redeemer: DAORedeemer, tx: Transaction) -> Bool {
  let CreateDAO { output_ref } = redeemer
  let dao_identifier = unique_dao_identifier(output_ref)
  and {
    output_ref_exists(tx, output_ref)?,
    only_one_identifier_minted(tx, policy_id, dao_identifier)?,
    minted_into_dao(tx, policy_id, dao_identifier)?,
  }
}

pub fn spend() -> Bool {
  False
}
