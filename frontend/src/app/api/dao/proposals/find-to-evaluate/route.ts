import { NextRequest, NextResponse } from "next/server";
import { fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";
import {
  parseProposalDatum,
  parseRawProposalDatum,
} from "@/lib/server/helpers/proposal-helpers";
import { getVotePolicyId } from "@/lib/server/helpers/vote-helpers";
import { getCachedUtxos } from "@/lib/server/helpers/utxo-cache";
import {
  createParameterizedScript,
  addressFromScript,
} from "@/lib/server/helpers/script-helpers";
import { Core } from "@blaze-cardano/sdk";

interface FindProposalsRequest {
  daoPolicyId: string;
  daoKey: string;
}

export async function POST(request: NextRequest) {
  try {
    const { daoPolicyId, daoKey }: FindProposalsRequest = await request.json();

    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    const proposalsToEvaluate = await findProposalsToEvaluate(
      daoPolicyId,
      daoKey,
      daoInfo
    );

    return NextResponse.json({
      proposals: proposalsToEvaluate,
      count: proposalsToEvaluate.length,
    });
  } catch (error) {
    console.error("❌ Find proposals error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to find proposals to evaluate",
      },
      { status: 500 }
    );
  }
}

async function findProposalsToEvaluate(
  daoPolicyId: string,
  daoKey: string,
  daoInfo: any
) {
  const votePolicyId = await getVotePolicyId(daoPolicyId, daoKey);
  const proposalScript = createParameterizedScript("proposal.proposal.spend", [
    daoPolicyId,
    daoKey,
    votePolicyId,
  ]);
  const proposalScriptAddress = addressFromScript(proposalScript);

  const proposalUtxos = await getCachedUtxos(proposalScriptAddress);
  const proposalsToEvaluate = [];
  const now = Date.now();

  for (const utxo of proposalUtxos) {
    try {
      const datum = utxo.output().datum()?.asInlineData();
      if (!datum) continue;

      const rawProposal = parseRawProposalDatum(datum);
      if (!rawProposal) continue;

      const statusConstr = rawProposal.status.asConstrPlutusData();
      const isActive = statusConstr?.getAlternative() === 0n;

      if (isActive && now > rawProposal.end_time) {
        const proposal = parseProposalDatum(datum, daoInfo);
        if (!proposal) continue;

        const { policyId, assetName } = getProposalTokenInfo(utxo);
        if (!policyId || !assetName) continue;

        const totalVotes = proposal.tally.reduce(
          (sum: number, votes: number) => sum + votes,
          0
        );
        const predictedStatus = calculateProposalOutcome(
          proposal.tally,
          totalVotes,
          daoInfo.quorum,
          daoInfo.threshold
        );

        proposalsToEvaluate.push({
          policyId,
          assetName,
          name: proposal.name,
          description: proposal.description,
          endTime: proposal.endTime,
          tally: proposal.tally,
          totalVotes,
          predictedStatus,
        });
      }
    } catch (error) {
      console.warn("Failed to parse proposal UTXO, skipping:", error);
      continue;
    }
  }

  return proposalsToEvaluate;
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
