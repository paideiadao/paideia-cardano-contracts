use aiken/collection/list
use cardano/assets.{AssetName, PolicyId, quantity_of}
use cardano/transaction.{Transaction}

pub type TokenMintingRedeemer {
  InitialMint
  SubsequentMint
}

validator token_minting_policy(
  auth_policy_id: PolicyId,
  auth_token_name: AssetName,
) {
  mint(redeemer: TokenMintingRedeemer, _policy_id: PolicyId, tx: Transaction) {
    when redeemer is {
      InitialMint -> {
        quantity_of(tx.mint, auth_policy_id, auth_token_name) > 0
      }
      SubsequentMint -> {
        // For subsequent mints, auth token must exist in inputs
        list.any(tx.inputs, fn(input) { 
          quantity_of(input.output.value, auth_policy_id, auth_token_name) > 0 
        })
      }
    }
  }
  
  else(_) {
    fail
  }
}