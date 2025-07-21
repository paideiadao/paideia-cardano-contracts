use aiken/interval.{Finite, Interval, IntervalBound}
use aiken/primitive/bytearray.{concat, drop, take}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{add, from_asset, from_asset_list, from_lovelace}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use dao_contracts/action_send_funds.{
  ActionIdentifier, ActionSendFundsDatum, CreateAction, Target,
  get_action_identifier,
}
use dao_contracts/dao.{CreateDAO, DAODatum, unique_dao_identifier}
use dao_contracts/proposal.{
  Active, CreateProposal, Passed, ProposalDatum, get_proposal_identifier,
  get_vote_receipt_identifier, to_proposal_datum,
}
use dao_contracts/treasury
use dao_contracts/vote.{
  CreateVote, EmptyVote, VoteDatum, nft_prefix, reference_prefix,
  unique_cip68_asset_name,
}

pub const test_dao_policy_id =
  #"00000000000000000000000100000000000000000000000000010000"

pub fn test_dao_output_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 666,
  }
}

pub const test_dao_token =
  #"ff000000000000000000000100000000000000000000000000010000ffff"

pub fn test_dao_datum() -> DAODatum {
  DAODatum {
    name: @"Test",
    governance_token: test_dao_token,
    threshold: 60,
    min_proposal_time: 2400,
    max_proposal_time: 2800,
    quorum: 10,
    min_gov_proposal_create: 1000,
    whitelisted_proposals: [test_proposal_policy_id],
    whitelisted_actions: [test_action_send_funds_policy_id],
  }
}

pub fn test_dao_output() -> Output {
  Output {
    address: Address(Script(test_dao_policy_id), None),
    value: from_lovelace(2_000_000)
      |> add(
          test_dao_policy_id,
          unique_dao_identifier(test_user_output_ref()),
          1,
        ),
    datum: InlineDatum(test_dao_datum()),
    reference_script: None,
  }
}

pub const test_user_key =
  #"ee000000000000000000000100000000000000000000000000010000"

pub fn test_user_output() -> Output {
  Output {
    address: Address(VerificationKey(test_user_key), None),
    value: from_lovelace(100_000_000),
    datum: NoDatum,
    reference_script: None,
  }
}

pub fn test_user_output_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 123,
  }
}

pub fn test_user_input() -> Input {
  Input { output_reference: test_user_output_ref(), output: test_user_output() }
}

pub fn test_dao_input() -> Input {
  Input { output_reference: test_dao_output_ref(), output: test_dao_output() }
}

test dao_mint_create_dao() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [test_user_input()],
      outputs: [test_dao_output()],
      mint: from_asset(
        test_dao_policy_id,
        unique_dao_identifier(test_user_output_ref()),
        1,
      ),
    }

  let redeemer = CreateDAO(test_user_output_ref())

  dao.mint(test_dao_policy_id, redeemer, tx)
}

pub const test_vote_policy_id =
  #"cc000000000000000000000100000000000000000000000000010000"

pub fn test_vote_output() -> Output {
  Output {
    address: Address(Script(test_vote_policy_id), None),
    value: from_lovelace(2_000_000)
      |> add(
          test_vote_policy_id,
          concat(
            reference_prefix,
            unique_cip68_asset_name(test_user_output_ref()),
          ),
          1,
        )
      |> add(take(test_dao_token, 28), drop(test_dao_token, 28), 10_000_000),
    datum: InlineDatum(test_vote_datum()),
    reference_script: None,
  }
}

pub fn test_vote_output_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 321,
  }
}

pub fn test_vote_input() -> Input {
  Input { output_reference: test_vote_output_ref(), output: test_vote_output() }
}

pub fn test_vote_datum() -> VoteDatum {
  VoteDatum { metadata: [], version: 1, extra: None }
}

test vote_mint_create_vote() {
  let vote_key = unique_cip68_asset_name(test_user_output_ref())

  let user_output =
    Output {
      ..test_user_output(),
      value: test_user_output().value
        |> add(test_vote_policy_id, concat(nft_prefix, vote_key), 1),
    }

  let tx =
    Transaction {
      ..placeholder,
      inputs: [test_user_input()],
      reference_inputs: [test_dao_input()],
      outputs: [test_vote_output(), user_output],
      mint: from_asset(test_vote_policy_id, concat(nft_prefix, vote_key), 1)
        |> add(test_vote_policy_id, concat(reference_prefix, vote_key), 1),
    }

  let redeemer = CreateVote(test_user_output_ref())

  vote.mint(
    test_vote_policy_id,
    redeemer,
    tx,
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
  )
}

fn empty_vote_tx() -> Transaction {
  let vote_key = unique_cip68_asset_name(test_user_output_ref())

  Transaction {
    ..placeholder,
    inputs: [test_vote_input()],
    reference_inputs: [test_dao_input()],
    outputs: [],
    mint: from_asset(test_vote_policy_id, concat(nft_prefix, vote_key), -1)
      |> add(test_vote_policy_id, concat(reference_prefix, vote_key), -1),
  }
}

test vote_mint_empty_vote() {
  let redeemer = EmptyVote

  vote.mint(
    test_vote_policy_id,
    redeemer,
    empty_vote_tx(),
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
  )
}

test vote_spend_empty_vote() {
  let redeemer = EmptyVote

  vote.spend(
    test_vote_datum(),
    redeemer,
    empty_vote_tx(),
    test_vote_output_ref(),
  )
}

pub const test_proposal_policy_id =
  #"dd000000000000000000000100000000000000000000000000010000"

pub const test_action_send_funds_policy_id =
  #"dd000000000000000000000100000000000000000000000000010001"

pub const test_treasury_policy_id =
  #"dd000000000000000000000100000000000000000000000000010002"

pub fn test_proposal_datum() -> ProposalDatum {
  ProposalDatum {
    name: @"Test",
    description: @"Test",
    tally: [0, 0],
    end_time: 3500,
    status: Active,
    identifier: test_user_output_ref(),
  }
}

pub fn test_proposal_output() -> Output {
  Output {
    address: Address(Script(test_proposal_policy_id), None),
    value: from_lovelace(2_000_000)
      |> add(
          test_proposal_policy_id,
          get_proposal_identifier(test_proposal_datum().identifier),
          1,
        ),
    datum: InlineDatum(test_proposal_datum()),
    reference_script: None,
  }
}

pub fn test_proposal_output_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 111,
  }
}

pub fn test_proposal_input() -> Input {
  Input {
    output: test_proposal_output(),
    output_reference: test_proposal_output_ref(),
  }
}

test proposal_mint_create_proposal() {
  let vote_key = unique_cip68_asset_name(test_user_output_ref())
  let tx =
    Transaction {
      ..placeholder,
      inputs: [test_user_input()],
      reference_inputs: [test_dao_input(), test_vote_input()],
      outputs: [test_proposal_output()],
      validity_range: Interval(
        IntervalBound(Finite(0), True),
        IntervalBound(Finite(1000), True),
      ),
      mint: from_asset(
        test_proposal_policy_id,
        get_proposal_identifier(test_proposal_datum().identifier),
        1,
      ),
    }

  let redeemer = CreateProposal(vote_key)

  proposal.mint(
    test_proposal_policy_id,
    redeemer,
    tx,
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_vote_policy_id,
  )
}

fn test_action_send_funds_datum() -> ActionSendFundsDatum {
  ActionSendFundsDatum {
    name: @"Test",
    description: @"Test",
    activation_time: 1000,
    action_identifier: ActionIdentifier {
      proposal_policy_id: test_proposal_policy_id,
      proposal_identifier: get_proposal_identifier(
        test_proposal_datum().identifier,
      ),
      action_index: 0,
    },
    option: 1,
    targets: [
      Target {
        address: Address(VerificationKey(test_user_key), None),
        coins: 100_000_000,
        tokens: [],
        datum: NoDatum,
      },
    ],
    treasury: Address(Script(test_treasury_policy_id), None),
  }
}

fn test_action_send_funds_output() {
  Output {
    address: Address(Script(test_action_send_funds_policy_id), None),
    value: from_lovelace(2_000_000)
      |> add(
          test_action_send_funds_policy_id,
          get_action_identifier(
            test_action_send_funds_datum().action_identifier.proposal_policy_id,
            test_action_send_funds_datum().action_identifier.proposal_identifier,
            test_action_send_funds_datum().action_identifier.action_index,
          ),
          1,
        ),
    datum: InlineDatum(test_action_send_funds_datum()),
    reference_script: None,
  }
}

test proposal_mint_create_proposal_with_action() {
  let vote_key = unique_cip68_asset_name(test_user_output_ref())
  let tx =
    Transaction {
      ..placeholder,
      inputs: [test_user_input()],
      reference_inputs: [test_dao_input(), test_vote_input()],
      outputs: [test_proposal_output(), test_action_send_funds_output()],
      validity_range: Interval(
        IntervalBound(Finite(0), True),
        IntervalBound(Finite(1000), True),
      ),
      mint: from_asset_list(
        [
          Pair(
            test_proposal_policy_id,
            [Pair(get_proposal_identifier(test_proposal_datum().identifier), 1)],
          ),
          Pair(
            test_action_send_funds_policy_id,
            [
              Pair(
                get_action_identifier(
                  test_proposal_policy_id,
                  get_proposal_identifier(test_proposal_datum().identifier),
                  0,
                ),
                1,
              ),
            ],
          ),
        ],
      ),
    }

  let proposal_redeemer = CreateProposal(vote_key)

  let action_send_funds_redeemer =
    CreateAction {
      proposal_policy_id: test_proposal_policy_id,
      proposal_identifier: test_proposal_datum().identifier,
    }

  let dao_key = unique_dao_identifier(test_user_output_ref())

  and {
    proposal.mint(
      test_proposal_policy_id,
      proposal_redeemer,
      tx,
      test_dao_policy_id,
      dao_key,
      test_vote_policy_id,
    ),
    action_send_funds.mint(
      tx,
      test_action_send_funds_policy_id,
      action_send_funds_redeemer,
      test_dao_policy_id,
      dao_key,
    ),
  }
}

fn cast_vote_tx() -> Transaction {
  let output_proposal_datum =
    ProposalDatum { ..test_proposal_datum(), tally: [0, 100] }
  let proposal_output =
    Output {
      ..test_proposal_output(),
      datum: InlineDatum(output_proposal_datum),
    }

  let vote_receipt =
    get_vote_receipt_identifier(
      get_proposal_identifier(output_proposal_datum.identifier),
      1,
    )

  let vote_output =
    Output {
      ..test_vote_output(),
      value: test_vote_output().value
        |> add(test_proposal_policy_id, vote_receipt, 100),
    }

  Transaction {
    ..placeholder,
    inputs: [test_proposal_input(), test_vote_input()],
    reference_inputs: [test_dao_input()],
    outputs: [proposal_output, vote_output],
    mint: from_asset(test_proposal_policy_id, vote_receipt, 100),
    validity_range: Interval(
      IntervalBound(Finite(1000), True),
      IntervalBound(Finite(1001), True),
    ),
  }
}

test proposal_mint_cast_vote() {
  let redeemer = proposal.CastVote

  proposal.mint(
    test_proposal_policy_id,
    redeemer,
    cast_vote_tx(),
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_vote_policy_id,
  )
}

test proposal_spend_cast_vote() {
  let redeemer = proposal.CastVote

  proposal.spend(
    to_proposal_datum(test_proposal_input().output.datum),
    redeemer,
    cast_vote_tx(),
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_proposal_output_ref(),
  )
}

test vote_spend_cast_vote() {
  let redeemer = vote.CastVote

  vote.spend(
    test_vote_datum(),
    redeemer,
    cast_vote_tx(),
    test_vote_output_ref(),
  )
}

fn clean_receipts_tx() -> Transaction {
  let output_proposal_datum =
    ProposalDatum {
      ..test_proposal_datum(),
      tally: [0, 100],
      status: Passed(1),
    }
  let proposal_output =
    Output {
      ..test_proposal_output(),
      datum: InlineDatum(output_proposal_datum),
    }

  let proposal_input =
    Input { output: proposal_output, output_reference: test_dao_output_ref() }

  let vote_receipt =
    get_vote_receipt_identifier(
      get_proposal_identifier(output_proposal_datum.identifier),
      1,
    )

  let vote_output =
    Output {
      ..test_vote_output(),
      value: test_vote_output().value
        |> add(test_proposal_policy_id, vote_receipt, 100),
    }

  let vote_input =
    Input { output: vote_output, output_reference: test_dao_output_ref() }
  Transaction {
    ..placeholder,
    inputs: [vote_input],
    reference_inputs: [proposal_input, test_dao_input()],
    outputs: [test_vote_output()],
    mint: from_asset(test_proposal_policy_id, vote_receipt, -100),
    validity_range: Interval(
      IntervalBound(Finite(5000), True),
      IntervalBound(Finite(5001), True),
    ),
  }
}

test proposal_mint_clean_receipts() {
  let redeemer = proposal.CleanReceipts

  proposal.mint(
    test_proposal_policy_id,
    redeemer,
    clean_receipts_tx(),
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_vote_policy_id,
  )
}

test vote_spend_clean_receipts() {
  let redeemer = vote.CleanReceipts

  vote.spend(
    test_vote_datum(),
    redeemer,
    clean_receipts_tx(),
    test_dao_output_ref(),
  )
}

test proposal_spend_evaluate_proposal_failed_quorum() {
  let proposal_output_datum =
    ProposalDatum { ..test_proposal_datum(), status: proposal.FailedQuorum }

  let proposal_output =
    Output {
      ..test_proposal_output(),
      datum: InlineDatum(proposal_output_datum),
    }

  let tx =
    Transaction {
      ..placeholder,
      inputs: [test_proposal_input()],
      reference_inputs: [test_dao_input()],
      outputs: [proposal_output],
      validity_range: Interval(
        IntervalBound(Finite(5000), True),
        IntervalBound(Finite(5001), True),
      ),
    }

  let redeemer = proposal.EvaluateProposal

  proposal.spend(
    test_proposal_datum(),
    redeemer,
    tx,
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_proposal_output_ref(),
  )
}

fn test_proposal_voted_datum() -> ProposalDatum {
  ProposalDatum { ..test_proposal_datum(), tally: [0, 100] }
}

fn test_proposal_voted_output() -> Output {
  Output {
    ..test_proposal_output(),
    datum: InlineDatum(test_proposal_voted_datum()),
  }
}

fn test_proposal_voted_input() -> Input {
  Input {
    output_reference: test_proposal_output_ref(),
    output: test_proposal_voted_output(),
  }
}

fn test_passed_proposal_datum() -> ProposalDatum {
  ProposalDatum { ..test_proposal_voted_datum(), status: Passed(1) }
}

fn test_passed_proposal_output() -> Output {
  Output {
    ..test_proposal_voted_output(),
    datum: InlineDatum(test_passed_proposal_datum()),
  }
}

test proposal_spend_evaluate_proposal_passed_1() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [test_proposal_voted_input()],
      reference_inputs: [test_dao_input()],
      outputs: [test_passed_proposal_output()],
      validity_range: Interval(
        IntervalBound(Finite(5000), True),
        IntervalBound(Finite(5001), True),
      ),
    }

  let redeemer = proposal.EvaluateProposal

  proposal.spend(
    test_proposal_voted_datum(),
    redeemer,
    tx,
    test_dao_policy_id,
    unique_dao_identifier(test_user_output_ref()),
    test_proposal_output_ref(),
  )
}

fn test_proposal_passed_input() -> Input {
  Input {
    output_reference: test_proposal_output_ref(),
    output: test_passed_proposal_output(),
  }
}

fn test_treasury_output() -> Output {
  Output {
    address: Address(Script(test_treasury_policy_id), None),
    value: from_lovelace(70_000_000),
    datum: NoDatum,
    reference_script: None,
  }
}

fn test_treasury_output_ref_1() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 222,
  }
}

fn test_treasury_output_ref_2() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 333,
  }
}

fn test_treasury_input_1() -> Input {
  Input {
    output_reference: test_treasury_output_ref_1(),
    output: test_treasury_output(),
  }
}

fn test_treasury_input_2() -> Input {
  Input {
    output_reference: test_treasury_output_ref_2(),
    output: test_treasury_output(),
  }
}

fn test_action_send_funds_output_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000010000000000000000000000000001000000000000",
    output_index: 444,
  }
}

fn test_action_send_funds_input() -> Input {
  Input {
    output_reference: test_action_send_funds_output_ref(),
    output: test_action_send_funds_output(),
  }
}

fn test_treasury_output_3() -> Output {
  Output {
    address: Address(Script(test_treasury_policy_id), None),
    value: from_lovelace(40_000_000),
    datum: NoDatum,
    reference_script: None,
  }
}

test action_send_funds_spend() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        test_action_send_funds_input(),
        test_treasury_input_1(),
        test_treasury_input_2(),
      ],
      reference_inputs: [test_proposal_passed_input(), test_dao_input()],
      outputs: [
        test_treasury_output_3(),
        test_user_output(),
        test_user_output(),
      ],
      mint: from_asset(
        test_action_send_funds_policy_id,
        get_action_identifier(
          test_action_send_funds_policy_id,
          get_proposal_identifier(test_proposal_datum().identifier),
          0,
        ),
        -1,
      ),
      validity_range: Interval(
        IntervalBound(Finite(6000), True),
        IntervalBound(Finite(6001), True),
      ),
    }

  let mint_redeemer = action_send_funds.Execute

  let dao_key = unique_dao_identifier(test_user_output_ref())

  and {
    action_send_funds.spend(
      tx,
      test_action_send_funds_datum(),
      test_action_send_funds_output_ref(),
    ),
    action_send_funds.mint(
      tx,
      test_action_send_funds_policy_id,
      mint_redeemer,
      test_dao_policy_id,
      dao_key,
    ),
    treasury.spend(tx, test_dao_policy_id, dao_key),
  }
}
