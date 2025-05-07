use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use dao_contracts/action_send_funds as action_send_funds_lib

validator action_send_funds(dao_policy_id: PolicyId, dao_key: AssetName) {
  spend(
    datum_opt: Option<action_send_funds_lib.ActionSendFundsDatum>,
    _redeemer: Data,
    utxo: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = datum_opt
    action_send_funds_lib.spend(self, datum, utxo)
  }

  mint(
    redeemer: action_send_funds_lib.ActionSendFundsMintRedeemer,
    policy_id: PolicyId,
    self: Transaction,
  ) {
    action_send_funds_lib.mint(
      self,
      policy_id,
      redeemer,
      dao_policy_id,
      dao_key,
    )
  }

  else(_) {
    fail
  }
}
