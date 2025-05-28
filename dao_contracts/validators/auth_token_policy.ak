use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}

validator auth_token_policy(initial_utxo: OutputReference) {
  mint(_redeemer: Data, _policy_id: PolicyId, tx: Transaction) {
    // One-shot: just check that the initial UTXO is consumed
    list.any(tx.inputs, fn(input) { input.output_reference == initial_utxo })
  }
  
  else(_) {
    fail
  }
}