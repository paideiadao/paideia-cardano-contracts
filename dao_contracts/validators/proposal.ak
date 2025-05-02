use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use dao_contracts/proposal as proposal_lib

validator proposal(
  dao_policy_id: PolicyId,
  dao_key: AssetName,
  vote_policy_id: PolicyId,
) {
  spend(
    datum_opt: Option<proposal_lib.ProposalDatum>,
    redeemer: proposal_lib.ProposalRedeemer,
    utxo: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = datum_opt
    proposal_lib.spend(datum, redeemer, self, dao_policy_id, dao_key, utxo)
  }

  mint(
    redeemer: proposal_lib.ProposalRedeemer,
    policy_id: PolicyId,
    self: Transaction,
  ) {
    proposal_lib.mint(
      policy_id,
      redeemer,
      self,
      dao_policy_id,
      dao_key,
      vote_policy_id,
    )
  }

  else(_) {
    fail
  }
}
