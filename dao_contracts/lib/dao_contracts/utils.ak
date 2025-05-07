use aiken/collection/list
use aiken/interval.{Finite, Interval, IntervalBound}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Input, Transaction}

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

pub fn after_time(tx: Transaction, time: Int) -> Bool {
  expect Interval {
    lower_bound: IntervalBound { bound_type: Finite(tx_time), .. },
    ..
  } = tx.validity_range
  tx_time > time
}
