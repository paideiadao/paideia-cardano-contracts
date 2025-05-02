use cardano/address.{Address}
use cardano/assets.{Value}

pub type Target {
  address: Address,
  value: Value,
  datum: Data,
}

pub type ActionSendFundsDatum {
  targets: List<Target>,
}

pub fn spend() {
  and {
    proposal_present_and_passed()?,
    targets_present()?,
    only_targets_and_treasury_outputs()?,
    action_token_burned()?,
  }
}

fn proposal_present_and_passed() {
  //proposal_identifier: ByteArray,
  //option: Int,
  //script_context: ScriptContext,
  //expect [proposal_reference] = script_context.transaction.reference_inputs |> find(fn (ri) {
  //    ri.output.value |> 
  //})
  True
}

fn targets_present() {
  True
}

fn only_targets_and_treasury_outputs() {
  True
}

fn action_token_burned() {
  True
}
