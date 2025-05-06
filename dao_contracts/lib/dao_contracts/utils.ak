use aiken/collection/list
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Input}

pub fn find_input_by_identifier(
  inputs: List<Input>,
  policy_id: PolicyId,
  identifier: AssetName,
) -> Option<Input> {
  inputs
    |> list.find(
        fn(input: Input) {
          ( input.output.value |> assets.quantity_of(policy_id, identifier) ) > 0
        },
      )
}
