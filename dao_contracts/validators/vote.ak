use aiken/transaction.{ScriptContext}
use aiken/transaction/value.{AssetName, PolicyId}
use dao_contracts/vote

validator(dao_policy_id: PolicyId, dao_key: AssetName) {
  fn spend(
    datum: vote.VoteDatum,
    redeemer: vote.VoteRedeemer,
    script_context: ScriptContext,
  ) {
    vote.spend(datum, redeemer, script_context)
  }

  fn mint(redeemer: vote.VoteRedeemer, script_context: ScriptContext) {
    vote.mint(redeemer, script_context, dao_policy_id, dao_key)
  }
}
