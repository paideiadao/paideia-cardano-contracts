use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Input, Transaction}
use dao_contracts/dao.{DAODatum, get_dao_datum_from_reference}

pub fn spend(tx: Transaction, dao_policy_id: PolicyId, dao_key: AssetName) {
  let dao_datum = get_dao_datum_from_reference(tx, dao_policy_id, dao_key)
  single_action_present(tx, dao_datum)?
}

fn single_action_present(tx: Transaction, dao_datum: DAODatum) -> Bool {
  let valid_whitelisted_actions =
    tx.inputs
      |> list.filter(
          fn(input: Input) {
            when input.output.address.payment_credential is {
              Script(action_policy_id) -> {
                let action_identifier_present =
                  (
                    input.output.value
                      |> assets.tokens(action_policy_id)
                      |> dict.to_pairs()
                      |> list.length()
                  ) == 1
                and {
                  dao_datum.whitelisted_actions |> list.has(action_policy_id),
                  action_identifier_present,
                }
              }
              _ -> False
            }
          },
        )
  ( valid_whitelisted_actions |> list.length() ) == 1
}
