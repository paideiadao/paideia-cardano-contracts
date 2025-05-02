use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use dao_contracts/dao as dao_lib

validator dao {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _utxo: OutputReference,
    _self: Transaction,
  ) {
    dao_lib.spend()
  }

  mint(redeemer: dao_lib.DAORedeemer, policy_id: PolicyId, self: Transaction) {
    dao_lib.mint(policy_id, redeemer, self)
  }

  else(_) {
    fail
  }
}
