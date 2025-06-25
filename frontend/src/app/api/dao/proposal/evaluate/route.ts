import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  createParameterizedScript,
  getCurrentSlot,
  addressFromScript,
} from "@/lib/server/helpers/script-helpers";
import { fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";
import {
  getProposalUtxo,
  parseProposalDatum,
} from "@/lib/server/helpers/proposal-helpers";
import { getVotePolicyId } from "@/lib/server/helpers/vote-helpers";

interface EvaluateProposalRequest {
  daoPolicyId: string;
  daoKey: string;
  proposalPolicyId: string;
  proposalAssetName: string;
  walletAddress: string;
  collateral: any[];
  changeAddress: string;
}

export async function POST(request: NextRequest) {
  try {
    const {
      daoPolicyId,
      daoKey,
      proposalPolicyId,
      proposalAssetName,
      walletAddress,
      collateral,
      changeAddress,
    }: EvaluateProposalRequest = await request.json();

    if (!collateral?.length) {
      throw new Error("No collateral available, please set it in your wallet");
    }

    const sendAddress = Core.addressFromBech32(walletAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    // Fetch DAO info and proposal
    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    const proposalUtxo = await getProposalUtxo(
      proposalPolicyId,
      proposalAssetName,
      daoPolicyId,
      daoKey
    );

    if (!proposalUtxo) {
      throw new Error("Proposal UTXO not found");
    }

    // Parse current proposal state
    const currentDatum = proposalUtxo.output().datum()?.asInlineData();
    if (!currentDatum) {
      throw new Error("Proposal UTXO missing datum");
    }

    const currentProposal = parseProposalDatum(currentDatum, daoInfo);
    if (!currentProposal) {
      throw new Error("Failed to parse proposal datum");
    }

    // Validate proposal can be evaluated
    if (currentProposal.status !== "Active") {
      throw new Error(
        `Proposal already evaluated with status: ${currentProposal.status}`
      );
    }

    const now = Date.now();
    if (now <= currentProposal.endTime) {
      throw new Error(
        `Proposal voting is still active until ${new Date(
          currentProposal.endTime
        ).toISOString()}`
      );
    }

    // Calculate final status
    const totalVotes = currentProposal.tally.reduce(
      (sum, votes) => sum + votes,
      0
    );
    const newStatus = calculateProposalOutcome(
      currentProposal.tally,
      totalVotes,
      daoInfo.quorum,
      daoInfo.threshold
    );

    console.log("📊 EVALUATION CALCULATION:");
    console.log("Total votes:", totalVotes);
    console.log("Required quorum:", daoInfo.quorum);
    console.log("Required threshold:", daoInfo.threshold);
    console.log("Vote tally:", currentProposal.tally);
    console.log("Calculated status:", newStatus);

    // Build evaluation transaction
    const tx = await buildEvaluationTransaction(blaze, {
      proposalUtxo,
      currentProposal,
      newStatus,
      daoPolicyId,
      daoKey,
      daoInfo,
    });

    return NextResponse.json({
      unsignedTx: tx.toCbor(),
      newStatus,
      totalVotes,
      winningOption: newStatus.type === "Passed" ? newStatus.option : null,
    });
  } catch (error) {
    console.error("❌ Proposal evaluation error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build evaluation transaction",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

function calculateProposalOutcome(
  tally: number[],
  totalVotes: number,
  requiredQuorum: number,
  requiredThreshold: number
): { type: "FailedQuorum" | "FailedThreshold" | "Passed"; option?: number } {
  // Check quorum first
  if (totalVotes < requiredQuorum) {
    return { type: "FailedQuorum" };
  }

  // Find option with most votes
  const maxVotes = Math.max(...tally);
  const winningIndex = tally.findIndex((votes) => votes === maxVotes);
  const winningPercentage = (maxVotes / totalVotes) * 100;

  // Check if winning option meets threshold
  if (winningPercentage >= requiredThreshold) {
    return { type: "Passed", option: winningIndex };
  }

  return { type: "FailedThreshold" };
}

async function buildEvaluationTransaction(
  blaze: Blaze<any, any>,
  params: {
    proposalUtxo: Core.TransactionUnspentOutput;
    currentProposal: any;
    newStatus: any;
    daoPolicyId: string;
    daoKey: string;
    daoInfo: any;
  }
): Promise<Core.Transaction> {
  const {
    proposalUtxo,
    currentProposal,
    newStatus,
    daoPolicyId,
    daoKey,
    daoInfo,
  } = params;

  // Create scripts
  const votePolicyId = await getVotePolicyId(daoPolicyId, daoKey);
  const proposalScript = createParameterizedScript("proposal.proposal.spend", [
    daoPolicyId,
    daoKey,
    votePolicyId,
  ]);

  // Get DAO UTXO for reference
  const daoScript = createParameterizedScript("dao.dao.spend", []);
  const daoAddress = addressFromScript(daoScript);
  const daoUtxos = await blaze.provider.getUnspentOutputs(daoAddress);

  const daoAssetId = Core.AssetId.fromParts(
    Core.PolicyId(daoPolicyId),
    Core.AssetName(daoInfo.key)
  );

  const daoUtxo = daoUtxos.find(
    (utxo: Core.TransactionUnspentOutput) =>
      utxo.output().amount().toCore().assets?.has(daoAssetId) ?? false
  );

  if (!daoUtxo) {
    throw new Error("DAO UTXO not found");
  }

  // Create updated proposal datum with new status
  const updatedDatum = createUpdatedProposalDatum(
    proposalUtxo.output().datum()?.asInlineData()!,
    newStatus
  );

  // Create EvaluateProposal redeemer
  const evaluateRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(3n, new Core.PlutusList()) // EvaluateProposal = Constructor 3
  );

  const currentSlot = getCurrentSlot();
  const validityStart = Core.Slot(Number(currentSlot));
  const validityEnd = Core.Slot(Number(currentSlot) + 3600);

  console.log("🔍 EVALUATION TRANSACTION DEBUG:");
  console.log("Proposal UTXO:", {
    txHash: proposalUtxo.input().transactionId(),
    outputIndex: proposalUtxo.input().index(),
  });
  console.log("Current status:", currentProposal.status);
  console.log("New status:", newStatus);
  console.log("Using redeemer:", "EvaluateProposal (Constructor 3)");

  return blaze
    .newTransaction()
    .addInput(proposalUtxo, evaluateRedeemer)
    .addReferenceInput(daoUtxo)
    .provideScript(proposalScript)
    .lockAssets(
      proposalUtxo.output().address(),
      proposalUtxo.output().amount(),
      updatedDatum
    )
    .setValidFrom(validityStart)
    .setValidUntil(validityEnd)
    .complete();
}

function createUpdatedProposalDatum(
  originalDatum: Core.PlutusData,
  newStatus: { type: string; option?: number }
): Core.PlutusData {
  const constr = originalDatum.asConstrPlutusData()!;
  const originalFields = constr.getData();

  // Create new status based on evaluation result
  let statusDatum: Core.PlutusData;
  switch (newStatus.type) {
    case "FailedQuorum":
      statusDatum = Core.PlutusData.newConstrPlutusData(
        new Core.ConstrPlutusData(2n, new Core.PlutusList()) // FailedQuorum = Constructor 2
      );
      break;
    case "FailedThreshold":
      statusDatum = Core.PlutusData.newConstrPlutusData(
        new Core.ConstrPlutusData(1n, new Core.PlutusList()) // FailedThreshold = Constructor 1
      );
      break;
    case "Passed":
      const passedFields = new Core.PlutusList();
      passedFields.add(Core.PlutusData.newInteger(BigInt(newStatus.option!)));
      statusDatum = Core.PlutusData.newConstrPlutusData(
        new Core.ConstrPlutusData(3n, passedFields) // Passed(Int) = Constructor 3
      );
      break;
    default:
      throw new Error(`Unknown status type: ${newStatus.type}`);
  }

  // Rebuild datum with new status
  const updatedFields = new Core.PlutusList();
  updatedFields.add(originalFields.get(0)); // name
  updatedFields.add(originalFields.get(1)); // description
  updatedFields.add(originalFields.get(2)); // tally
  updatedFields.add(originalFields.get(3)); // end_time
  updatedFields.add(statusDatum); // status - updated
  updatedFields.add(originalFields.get(5)); // identifier

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(constr.getAlternative(), updatedFields)
  );
}
