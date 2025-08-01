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
  parseProposalDatum,
  parseRawProposalDatum,
} from "@/lib/server/helpers/proposal-helpers";
import { getVotePolicyId } from "@/lib/server/helpers/vote-helpers";
import { getCachedUtxos } from "@/lib/server/helpers/utxo-cache";

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
    }: // changeAddress,
    EvaluateProposalRequest = await request.json();

    if (!collateral?.length) {
      throw new Error("No collateral available, please set it in your wallet");
    }

    const sendAddress = Core.addressFromBech32(walletAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    // Fetch DAO info
    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);

    // Find the specific proposal UTXO using the working batch logic
    const votePolicyId = await getVotePolicyId(daoPolicyId, daoKey);
    const proposalScript = createParameterizedScript(
      "proposal.proposal.spend",
      [daoPolicyId, daoKey, votePolicyId]
    );
    const proposalScriptAddress = addressFromScript(proposalScript);
    const proposalUtxos = await getCachedUtxos(proposalScriptAddress);

    // Find the specific proposal UTXO
    let proposalUtxo: Core.TransactionUnspentOutput | null = null;
    let currentProposal: any = null;
    let newStatus: any = null;

    for (const utxo of proposalUtxos) {
      const { policyId, assetName } = getProposalTokenInfo(utxo);
      if (policyId === proposalPolicyId && assetName === proposalAssetName) {
        const datum = utxo.output().datum()?.asInlineData();
        if (datum) {
          const rawProposal = parseRawProposalDatum(datum);
          if (rawProposal) {
            const statusConstr = rawProposal.status.asConstrPlutusData();
            const isActive = statusConstr?.getAlternative() === 0n;

            const now = Date.now();
            if (isActive && now > rawProposal.end_time) {
              currentProposal = parseProposalDatum(datum, daoInfo);
              if (currentProposal) {
                proposalUtxo = utxo;

                const totalVotes = currentProposal.tally.reduce(
                  (sum: number, votes: number) => sum + votes,
                  0
                );
                newStatus = calculateProposalOutcome(
                  currentProposal.tally,
                  totalVotes,
                  daoInfo.quorum,
                  daoInfo.threshold
                );
                break;
              }
            }
          }
        }
      }
    }

    if (!proposalUtxo || !currentProposal || !newStatus) {
      throw new Error("Proposal UTXO not found or not ready for evaluation");
    }

    console.log("📊 EVALUATION CALCULATION:");
    console.log(
      "Total votes:",
      currentProposal.tally.reduce(
        (sum: number, votes: number) => sum + votes,
        0
      )
    );
    console.log("Required quorum:", daoInfo.quorum);
    console.log("Required threshold:", daoInfo.threshold);
    console.log("Vote tally:", currentProposal.tally);
    console.log("Calculated status:", newStatus);

    // Build evaluation transaction using the working batch logic
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
      totalVotes: currentProposal.tally.reduce(
        (sum: number, votes: number) => sum + votes,
        0
      ),
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

function getProposalTokenInfo(utxo: Core.TransactionUnspentOutput): {
  policyId: string;
  assetName: string;
} {
  const assets = utxo.output().amount().toCore().assets;
  if (!assets) return { policyId: "", assetName: "" };

  for (const [assetId, amount] of assets) {
    if (amount === 1n) {
      const policyId = Core.AssetId.getPolicyId(assetId);
      const assetName = Core.AssetId.getAssetName(assetId);
      return { policyId, assetName };
    }
  }

  return { policyId: "", assetName: "" };
}

function calculateProposalOutcome(
  tally: number[],
  totalVotes: number,
  requiredQuorum: number,
  requiredThreshold: number
): { type: "FailedQuorum" | "FailedThreshold" | "Passed"; option?: number } {
  if (totalVotes < requiredQuorum) {
    return { type: "FailedQuorum" };
  }

  const maxVotes = Math.max(...tally);
  const winningIndex = tally.findIndex((votes) => votes === maxVotes);
  const winningPercentage = (maxVotes / totalVotes) * 100;

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

  // Create scripts - using the working batch logic
  const votePolicyId = await getVotePolicyId(daoPolicyId, daoKey);
  const proposalScript = createParameterizedScript("proposal.proposal.spend", [
    daoPolicyId,
    daoKey,
    votePolicyId,
  ]);

  // Get DAO UTXO for reference - using cached UTXOs like the batch version
  const daoScript = createParameterizedScript("dao.dao.spend", []);
  const daoAddress = addressFromScript(daoScript);
  const daoUtxos = await getCachedUtxos(daoAddress);

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
    proposalUtxo.output().datum()!.asInlineData()!,
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

  // Use the exact same transaction building pattern as the working batch version
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
        new Core.ConstrPlutusData(3n, passedFields) // Passed = Constructor 3
      );
      break;
    default:
      throw new Error(`Invalid status type: ${newStatus.type}`);
  }

  // Use the exact same datum rebuilding logic as the working batch version
  const newFields = new Core.PlutusList();
  for (let i = 0; i < originalFields.getLength(); i++) {
    if (i === 4) {
      newFields.add(statusDatum);
    } else {
      newFields.add(originalFields.get(i));
    }
  }

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, newFields)
  );
}
