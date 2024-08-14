use aiken/transaction.{ScriptContext}
use dao_contracts/dao

validator {
  fn spend(_datum: Data, _redeemer: Data, _script_context: Data) {
    dao.spend()
  }

  fn mint(redeemer: dao.DAORedeemer, script_context: ScriptContext) {
    dao.mint(redeemer, script_context)
  }
}
