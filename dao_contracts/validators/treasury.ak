use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use dao_contracts/treasury as treasury_lib

validator treasury(dao_policy_id: PolicyId, dao_key: AssetName) {
  spend(
    _datum_opt: Option<Data>,
    _redeemer: Data,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    treasury_lib.spend(self, dao_policy_id, dao_key)
  }

  else(_) {
    fail
  }
}
