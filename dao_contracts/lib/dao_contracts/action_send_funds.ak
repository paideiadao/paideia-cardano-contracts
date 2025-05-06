use aiken/cbor.{serialise}
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{blake2b_256}
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{
  Datum, InlineDatum, Output, OutputReference, Transaction, find_input,
  find_script_outputs,
}
use dao_contracts/dao.{get_dao_datum_from_reference}
use dao_contracts/proposal.{get_proposal_identifier}
use dao_contracts/utils.{find_input_by_identifier}

pub type Target {
  address: Address,
  value: Value,
  datum: Datum,
}

pub type ActionSendFundsDatum {
  name: String,
  description: String,
  activation_time: Int,
  action_identifier: ActionIdentifier,
  option: Int,
  targets: List<Target>,
  treasury: Address,
}

pub type ActionIdentifier {
  proposal_policy_id: PolicyId,
  proposal_identifier: AssetName,
  action_index: Int,
}

pub type ActionSendFundsMintRedeemer {
  CreateAction {
    proposal_policy_id: PolicyId,
    proposal_identifier: OutputReference,
  }
  Execute
}

pub fn mint(
  tx: Transaction,
  policy_id: PolicyId,
  redeemer: ActionSendFundsMintRedeemer,
  dao_policy_id: PolicyId,
  dao_key: AssetName,
) {
  let dao_datum = get_dao_datum_from_reference(tx, dao_policy_id, dao_key)
  when redeemer is {
    CreateAction { proposal_policy_id, proposal_identifier } -> and {
        single_identifier_minted_into_each_action(
          tx,
          policy_id,
          proposal_policy_id,
          proposal_identifier,
        )?,
        proposal_type_whitelisted(
          dao_datum.whitelisted_proposals,
          proposal_policy_id,
        )?,
      }
    Execute -> only_burned_action_tokens(tx, policy_id)?
  }
}

fn only_burned_action_tokens(tx: Transaction, policy_id: PolicyId) -> Bool {
  let minted_action_identifiers =
    tx.mint |> assets.tokens(policy_id) |> dict.to_pairs()
  minted_action_identifiers
    |> list.all(
        fn(minted_action_identifier: Pair<AssetName, Int>) {
          minted_action_identifier.2nd < 0
        },
      )
}

fn proposal_type_whitelisted(
  whitelisted_proposals: List<ByteArray>,
  proposal_policy_id: PolicyId,
) -> Bool {
  whitelisted_proposals
    |> list.any(
        fn(whitelisted_proposal: ByteArray) {
          whitelisted_proposal == proposal_policy_id
        },
      )
}

fn single_identifier_minted_into_each_action(
  tx: Transaction,
  policy_id: PolicyId,
  proposal_policy_id: PolicyId,
  proposal_identifier: OutputReference,
) -> Bool {
  expect Some(_output_ref_present) = find_input(tx.inputs, proposal_identifier)
  let proposal_identifier_hash = get_proposal_identifier(proposal_identifier)
  let minted_action_identifiers =
    tx.mint |> assets.tokens(policy_id) |> dict.to_pairs()
  let action_outputs = find_script_outputs(tx.outputs, policy_id)
  minted_action_identifiers
    |> list.all(
        fn(minted_action_identifier: Pair<AssetName, Int>) {
          let minted_into_action =
            action_outputs
              |> list.any(
                  fn(output: Output) {
                    expect InlineDatum(datum) = output.datum
                    expect action_datum: ActionSendFundsDatum = datum
                    minted_action_identifier.1st == get_action_identifier(
                      proposal_policy_id,
                      proposal_identifier_hash,
                      action_datum.action_identifier.action_index,
                    )
                  },
                )
          and {
            minted_into_action?,
            minted_action_identifier.2nd == 1,
          }
        },
      )
}

pub fn get_action_identifier(
  proposal_policy_id: PolicyId,
  proposal_identifier: AssetName,
  action_index: Int,
) -> AssetName {
  let action_identifier =
    blake2b_256(
      serialise(
        ActionIdentifier {
          proposal_policy_id,
          proposal_identifier,
          action_index,
        },
      ),
    )
  action_identifier
}

pub fn spend(
  tx: Transaction,
  datum: ActionSendFundsDatum,
  output_ref: OutputReference,
) {
  expect Some(self) = find_input(tx.inputs, output_ref)
  expect Address { payment_credential: Script(action_policy_id), .. } =
    self.output.address
  and {
    proposal_present_and_passed(
      datum.action_identifier.proposal_policy_id,
      datum.action_identifier.proposal_identifier,
      datum.option,
      tx,
    )?,
    targets_present(datum.targets, tx.outputs)?,
    only_targets_and_treasury_outputs(datum.treasury, tx.outputs, datum.targets)?,
    action_token_burned(action_policy_id, tx.outputs)?,
  }
}

fn proposal_present_and_passed(
  proposal_policy_id: PolicyId,
  proposal_identifier: AssetName,
  option: Int,
  tx: Transaction,
) -> Bool {
  expect Some(proposal_reference_input) =
    find_input_by_identifier(tx.inputs, proposal_policy_id, proposal_identifier)
  expect InlineDatum(proposal_data) = proposal_reference_input.output.datum
  expect proposal_datum: proposal.ProposalDatum = proposal_data
  expect proposal.Passed(passed_option) = proposal_datum.status
  passed_option == option
}

fn targets_present(targets: List<Target>, outputs: List<Output>) -> Bool {
  targets
    |> list.all(
        fn(target: Target) {
          outputs
            |> list.any(
                fn(output: Output) {
                  and {
                    (output.address == target.address)?,
                    (output.value == target.value)?,
                    (output.datum == target.datum)?,
                  }
                },
              )
        },
      )
}

fn only_targets_and_treasury_outputs(
  treasury: Address,
  outputs: List<Output>,
  targets: List<Target>,
) -> Bool {
  expect Address { payment_credential: Script(treasury_script_hash), .. } =
    treasury
  let treasury_outputs = find_script_outputs(outputs, treasury_script_hash)
  ( treasury_outputs |> list.length() ) + ( targets |> list.length() ) == (
    outputs |> list.length()
  )
}

fn action_token_burned(
  action_policy_id: PolicyId,
  outputs: List<Output>,
) -> Bool {
  expect None =
    outputs
      |> list.find(
          fn(output: Output) {
            ( output.value |> assets.tokens(action_policy_id) ) != dict.empty
          },
        )
  True
}
