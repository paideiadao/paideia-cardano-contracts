use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use dao_contracts/vote as vote_lib

validator vote(dao_policy_id: PolicyId, dao_key: AssetName) {
  spend(
    datum_opt: Option<vote_lib.VoteDatum>,
    redeemer: vote_lib.VoteRedeemer,
    utxo: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = datum_opt
    vote_lib.spend(datum, redeemer, self, utxo)
  }

  mint(redeemer: vote_lib.VoteRedeemer, policy_id: PolicyId, self: Transaction) {
    vote_lib.mint(policy_id, redeemer, self, dao_policy_id, dao_key)
  }

  else(_) {
    fail
  }
}
