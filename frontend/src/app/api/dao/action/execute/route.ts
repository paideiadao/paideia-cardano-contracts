import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core, Provider, Wallet } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  createParameterizedScript,
  addressFromScript,
  getCurrentSlot,
  getNetworkId,
  getUTXOsWithFallback,
} from "@/lib/server/helpers/script-helpers";
import {
  fetchDAOInfo,
  findDeployedScriptUtxoViaMaestro,
} from "@/lib/server/helpers/dao-helpers";
import {
  getProposalUtxo,
  parseProposalDatum,
  parseActionDatum,
  ActionTarget,
  ParsedActionDatum,
  getActionIdentifier,
} from "@/lib/server/helpers/proposal-helpers";
import { findUTXOWithAsset } from "@/lib/server/helpers/utxo-helpers";

interface CollateralItem {
  input: {
    outputIndex: number;
    txHash: string;
  };
  output: {
    address: string;
    amount: any[];
  };
}

interface ExecuteActionRequest {
  daoPolicyId: string;
  daoKey: string;
  actionIndex: number;
  proposalPolicyId: string;
  proposalAssetName: string;
  walletAddress: string;
  collateral: CollateralItem[];
  changeAddress: string;
}

class ActionExecutionError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "ActionExecutionError";
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const requestData = await validateRequest(request);

    const sendAddress = Core.addressFromBech32(requestData.walletAddress);
    const wallet = new ColdWallet(
      sendAddress,
      getNetworkId(),
      blazeMaestroProvider
    );
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    const daoInfo = await fetchDAOInfo(
      requestData.daoPolicyId,
      requestData.daoKey
    );

    const actionScript = createParameterizedScript(
      "action_send_funds.action_send_funds.spend",
      [requestData.daoPolicyId, requestData.daoKey]
    );
    const actionPolicyId = actionScript.hash();
    const actionAssetName = getActionIdentifier(
      requestData.proposalPolicyId,
      requestData.proposalAssetName,
      requestData.actionIndex
    );

    const actionUtxo = await findActionUtxo(
      actionPolicyId,
      actionAssetName,
      requestData.daoPolicyId,
      requestData.daoKey
    );

    const actionDatum = parseActionDatum(
      actionUtxo.output().datum()?.asInlineData()!
    );
    if (!actionDatum) {
      throw new ActionExecutionError(
        "Failed to parse action datum",
        "ACTION_DATUM_PARSE_ERROR"
      );
    }

    const proposalUtxo = await getProposalUtxo(
      actionDatum.actionIdentifier.proposal_policy_id,
      actionDatum.actionIdentifier.proposal_identifier,
      requestData.daoPolicyId,
      requestData.daoKey
    );

    if (!proposalUtxo) {
      throw new ActionExecutionError(
        `Proposal UTXO not found for action`,
        "PROPOSAL_UTXO_NOT_FOUND"
      );
    }

    const proposalDatum = parseProposalDatum(
      proposalUtxo.output().datum()?.asInlineData()!,
      daoInfo
    );
    if (!proposalDatum) {
      throw new ActionExecutionError(
        "Failed to parse proposal datum",
        "PROPOSAL_DATUM_PARSE_ERROR"
      );
    }

    validateProposalStatus(proposalDatum, actionDatum);

    const treasuryUtxos = await findTreasuryUtxos(
      requestData.daoPolicyId,
      requestData.daoKey
    );
    validateTreasuryFunds(treasuryUtxos, actionDatum);

    const scriptRefs = await getScriptReferences(
      requestData.daoPolicyId,
      requestData.daoKey
    );

    const transaction = await buildExecutionTransaction({
      requestData,
      blaze,
      daoInfo,
      actionUtxo,
      proposalUtxo,
      treasuryUtxos,
      actionDatum,
      scriptRefs,
      actionPolicyId,
      actionAssetName,
    });

    return NextResponse.json({
      unsignedTx: transaction.toCbor(),
      actionExecuted: actionDatum.name,
      targets: actionDatum.targets,
      totalAmountSent: calculateTotalAmount(actionDatum.targets),
    });
  } catch (error) {
    console.error("❌ Action execution error:", error);

    if (error instanceof ActionExecutionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to execute action",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

async function validateRequest(
  request: NextRequest
): Promise<ExecuteActionRequest> {
  const body = await request.json();

  const requiredFields = [
    "daoPolicyId",
    "daoKey",
    "proposalPolicyId",
    "proposalAssetName",
    "walletAddress",
    "collateral",
    "changeAddress",
  ];

  for (const field of requiredFields) {
    if (
      body[field] === undefined ||
      body[field] === null ||
      body[field] === ""
    ) {
      throw new ActionExecutionError(
        `Missing required field: ${field}`,
        "INVALID_REQUEST"
      );
    }
  }

  // Special handling for actionIndex since 0 is a valid value
  if (body.actionIndex === undefined || body.actionIndex === null) {
    throw new ActionExecutionError(
      "Missing required field: actionIndex",
      "INVALID_REQUEST"
    );
  }

  if (!Array.isArray(body.collateral) || body.collateral.length === 0) {
    throw new ActionExecutionError(
      "Collateral must be a non-empty array",
      "INVALID_COLLATERAL"
    );
  }

  const actionIndex = Number(body.actionIndex);
  if (isNaN(actionIndex) || actionIndex < 0 || !Number.isInteger(actionIndex)) {
    throw new ActionExecutionError(
      "Action index must be a non-negative integer",
      "INVALID_ACTION_INDEX"
    );
  }

  return {
    ...body,
    actionIndex,
  } as ExecuteActionRequest;
}

async function findActionUtxo(
  actionPolicyId: string,
  actionAssetName: string,
  daoPolicyId: string,
  daoKey: string
): Promise<Core.TransactionUnspentOutput> {
  const actionScript = createParameterizedScript(
    "action_send_funds.action_send_funds.spend",
    [daoPolicyId, daoKey]
  );
  const actionAddress = addressFromScript(actionScript);
  const actionUtxos = await getUTXOsWithFallback(actionAddress);

  const actionUtxo = findUTXOWithAsset(
    actionUtxos,
    actionPolicyId,
    actionAssetName,
    1n
  );

  if (!actionUtxo) {
    throw new ActionExecutionError(
      "Action UTXO not found or already executed",
      "ACTION_UTXO_NOT_FOUND"
    );
  }

  return actionUtxo;
}

async function findTreasuryUtxos(
  daoPolicyId: string,
  daoKey: string
): Promise<Core.TransactionUnspentOutput[]> {
  const treasuryScript = createParameterizedScript("treasury.treasury.spend", [
    daoPolicyId,
    daoKey,
  ]);
  const treasuryAddress = addressFromScript(treasuryScript);
  const treasuryUtxos = await getUTXOsWithFallback(treasuryAddress);

  if (treasuryUtxos.length === 0) {
    throw new ActionExecutionError(
      "No treasury UTXOs found",
      "TREASURY_UTXOS_NOT_FOUND"
    );
  }

  return treasuryUtxos;
}

async function getScriptReferences(
  daoPolicyId: string,
  daoKey: string
): Promise<{
  actionRefUtxo: Core.TransactionUnspentOutput;
  treasuryRefUtxo: Core.TransactionUnspentOutput;
}> {
  const actionScript = createParameterizedScript(
    "action_send_funds.action_send_funds.spend",
    [daoPolicyId, daoKey]
  );
  const treasuryScript = createParameterizedScript("treasury.treasury.spend", [
    daoPolicyId,
    daoKey,
  ]);

  const [actionScriptRef, treasuryScriptRef] = await Promise.all([
    findDeployedScriptUtxoViaMaestro(actionScript.hash()),
    findDeployedScriptUtxoViaMaestro(treasuryScript.hash()),
  ]);

  if (!actionScriptRef || !treasuryScriptRef) {
    throw new ActionExecutionError(
      "Required script references not found",
      "SCRIPT_REFS_NOT_FOUND"
    );
  }

  const referenceInputs = [
    new Core.TransactionInput(
      Core.TransactionId(actionScriptRef.txHash),
      BigInt(actionScriptRef.outputIndex)
    ),
    new Core.TransactionInput(
      Core.TransactionId(treasuryScriptRef.txHash),
      BigInt(treasuryScriptRef.outputIndex)
    ),
  ];

  const [actionRefUtxo, treasuryRefUtxo] =
    await blazeMaestroProvider.resolveUnspentOutputs(referenceInputs);

  return { actionRefUtxo, treasuryRefUtxo };
}

function validateProposalStatus(
  proposalDatum: any,
  actionDatum: ParsedActionDatum
): void {
  if (proposalDatum.status !== "Passed") {
    throw new ActionExecutionError(
      `Proposal has not passed. Current status: ${proposalDatum.status}`,
      "PROPOSAL_NOT_PASSED"
    );
  }

  if (proposalDatum.winningOption !== actionDatum.option) {
    throw new ActionExecutionError(
      `Proposal passed with option ${proposalDatum.winningOption}, but action requires option ${actionDatum.option}`,
      "OPTION_MISMATCH"
    );
  }

  console.log("✅ Proposal validation passed");
}

function validateTreasuryFunds(
  treasuryUtxos: Core.TransactionUnspentOutput[],
  actionDatum: ParsedActionDatum
): void {
  const totalCoinsNeeded = actionDatum.targets.reduce(
    (sum, target) => sum + target.coins,
    0
  );
  const totalAvailable = treasuryUtxos.reduce(
    (sum, utxo) => sum + Number(utxo.output().amount().coin()),
    0
  );

  if (totalAvailable < totalCoinsNeeded) {
    throw new ActionExecutionError(
      `Insufficient treasury funds: need ${
        totalCoinsNeeded / 1_000_000
      } ADA, have ${totalAvailable / 1_000_000} ADA`,
      "INSUFFICIENT_TREASURY_FUNDS"
    );
  }

  console.log(
    `💰 Treasury validation passed: ${
      totalAvailable / 1_000_000
    } ADA available, ${totalCoinsNeeded / 1_000_000} ADA needed`
  );
}

async function buildExecutionTransaction(context: {
  requestData: ExecuteActionRequest;
  blaze: Blaze<Provider, Wallet>;
  daoInfo: any;
  actionUtxo: Core.TransactionUnspentOutput;
  proposalUtxo: Core.TransactionUnspentOutput;
  treasuryUtxos: Core.TransactionUnspentOutput[];
  actionDatum: ParsedActionDatum;
  scriptRefs: {
    actionRefUtxo: Core.TransactionUnspentOutput;
    treasuryRefUtxo: Core.TransactionUnspentOutput;
  };
  actionPolicyId: string;
  actionAssetName: string;
}): Promise<Core.Transaction> {
  console.log("🔧 Building execution transaction...");

  const actionSpendRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, new Core.PlutusList())
  );

  const treasurySpendRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, new Core.PlutusList())
  );

  // The burn redeemer should be "Execute", not empty constructor
  const burnRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(1n, new Core.PlutusList()) // Execute = constructor 1
  );

  const { selectedTreasuryUtxos, treasuryChange } = selectTreasuryUtxos(
    context.treasuryUtxos,
    context.actionDatum.targets
  );

  // Get the MINT policy ID (not spend policy ID)
  const actionMintScript = createParameterizedScript(
    "action_send_funds.action_send_funds.mint",
    [context.requestData.daoPolicyId, context.requestData.daoKey]
  );
  const actionMintPolicyId = actionMintScript.hash();

  let txBuilder = context.blaze
    .newTransaction()
    .addInput(context.actionUtxo, actionSpendRedeemer)
    .addReferenceInput(context.daoInfo.utxo)
    .addReferenceInput(context.proposalUtxo)
    .addReferenceInput(context.scriptRefs.actionRefUtxo)
    .addReferenceInput(context.scriptRefs.treasuryRefUtxo);

  for (const treasuryUtxo of selectedTreasuryUtxos) {
    txBuilder = txBuilder.addInput(treasuryUtxo, treasurySpendRedeemer);
  }

  for (const target of context.actionDatum.targets) {
    const targetAddress = Core.addressFromBech32(target.address);

    const assets = new Map<Core.AssetId, bigint>();
    for (const token of target.tokens) {
      const assetId = Core.AssetId.fromParts(
        Core.PolicyId(token.policyId),
        Core.AssetName(token.assetName)
      );
      assets.set(assetId, BigInt(token.quantity));
    }

    const targetValue = Core.Value.fromCore({
      coins: BigInt(target.coins),
      assets,
    });
    txBuilder = txBuilder.payAssets(targetAddress, targetValue);
  }

  if (treasuryChange > 0n) {
    const treasuryAddress = Core.addressFromBech32(
      context.actionDatum.treasuryAddress
    );
    const treasuryChangeValue = Core.Value.fromCore({
      coins: treasuryChange,
      assets: new Map(),
    });

    // Treasury outputs use NoDatum, not InlineDatum
    const treasuryOutput = new Core.TransactionOutput(
      treasuryAddress,
      treasuryChangeValue
      // No datum parameter = NoDatum
    );

    txBuilder = txBuilder.addOutput(treasuryOutput);
  }

  // Burn the action token using the MINT policy ID
  const burnMap = new Map();
  burnMap.set(Core.AssetName(context.actionAssetName), -1n);
  txBuilder = txBuilder.addMint(
    Core.PolicyId(actionMintPolicyId),
    burnMap,
    burnRedeemer
  );

  const currentSlot = getCurrentSlot();
  const validityStart = Core.Slot(Number(currentSlot));
  const validityEnd = Core.Slot(Number(currentSlot) + 300);

  // Set change address to prevent automatic change outputs
  txBuilder = txBuilder.setChangeAddress(
    Core.addressFromBech32(context.requestData.changeAddress)
  );

  // Parse collateral correctly
  const collateralInputs = context.requestData.collateral.map(
    (collateralItem) => {
      return new Core.TransactionInput(
        Core.TransactionId(collateralItem.input.txHash),
        BigInt(collateralItem.input.outputIndex)
      );
    }
  );

  // Resolve collateral UTxOs
  const collateralUtxos = await blazeMaestroProvider.resolveUnspentOutputs(
    collateralInputs
  );
  txBuilder = txBuilder.provideCollateral(collateralUtxos);

  console.log(`🔧 Transaction Summary:`);
  console.log(
    `  - Action datum targets: ${context.actionDatum.targets.length}`
  );
  console.log(`  - Treasury change: ${treasuryChange} lovelace`);
  console.log(`  - Will create treasury output: ${treasuryChange > 0n}`);
  console.log(
    `  - Expected total outputs: ${
      context.actionDatum.targets.length + (treasuryChange > 0n ? 1 : 0)
    }`
  );

  // Check the transaction state before completion
  console.log(
    `🔧 TxBuilder outputs before complete: ${txBuilder.outputsCount}`
  );

  const transaction = await txBuilder
    .setValidFrom(validityStart)
    .setValidUntil(validityEnd)
    .setFeePadding(500_000n)
    .complete({ useCoinSelection: false });

  // Debug the actual transaction outputs
  const outputs = transaction.body().outputs();
  console.log(`🔧 Final transaction outputs: ${outputs.length}`);
  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    console.log(
      `  Output ${i}: ${output.address().toBech32()}, ${output
        .amount()
        .coin()} lovelace`
    );
  }

  return transaction;
}

function selectTreasuryUtxos(
  treasuryUtxos: Core.TransactionUnspentOutput[],
  targets: ActionTarget[]
): {
  selectedTreasuryUtxos: Core.TransactionUnspentOutput[];
  treasuryChange: bigint;
  totalCoinsAvailable: bigint;
} {
  const totalCoinsNeeded = BigInt(
    targets.reduce((sum, target) => sum + target.coins, 0)
  );

  let selectedTreasuryUtxos: Core.TransactionUnspentOutput[] = [];
  let totalAvailable = 0n;

  for (const utxo of treasuryUtxos) {
    selectedTreasuryUtxos.push(utxo);
    totalAvailable += utxo.output().amount().coin();
    if (totalAvailable >= totalCoinsNeeded) break;
  }

  const treasuryChange = totalAvailable - totalCoinsNeeded;

  return {
    selectedTreasuryUtxos,
    treasuryChange,
    totalCoinsAvailable: totalAvailable,
  };
}

function calculateTotalAmount(targets: ActionTarget[]): number {
  return targets.reduce((sum, target) => sum + target.coins, 0);
}
