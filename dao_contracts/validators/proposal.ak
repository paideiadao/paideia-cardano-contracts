use aiken/transaction.{ScriptContext}
use aiken/transaction/value.{AssetName, PolicyId}
use dao_contracts/proposal

validator(
  dao_policy_id: PolicyId,
  dao_key: AssetName,
  vote_policy_id: PolicyId,
) {
  fn spend(
    datum: proposal.ProposalDatum,
    redeemer: proposal.ProposalRedeemer,
    script_context: ScriptContext,
  ) {
    proposal.spend(datum, redeemer, script_context, dao_policy_id, dao_key)
  }

  fn mint(redeemer: proposal.ProposalRedeemer, script_context: ScriptContext) {
    proposal.mint(
      redeemer,
      script_context,
      dao_policy_id,
      dao_key,
      vote_policy_id,
    )
  }
}
