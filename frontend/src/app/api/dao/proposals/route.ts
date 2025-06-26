import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript } from "@blaze-cardano/uplc";
import plutusJson from "@/lib/scripts/plutus.json";
import {
  addressFromScript,
  createParameterizedScript,
  getScriptPolicyId,
} from "@/lib/server/helpers/script-helpers";
import {
  parseProposalDatum,
  ProposalStatus,
} from "@/lib/server/helpers/proposal-helpers";
import { fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";

export interface ProposalInfo {
  policyId: string;
  assetName: string;
  name: string;
  description: string;
  tally: number[];
  endTime: number;
  status: ProposalStatus;
  winningOption?: number;
  identifier: {
    txHash: string;
    outputIndex: number;
  };
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
  totalVotes: number;
  createdAt?: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const daoPolicyId = searchParams.get("daoPolicyId");
    const daoKey = searchParams.get("daoKey");

    if (!daoPolicyId || !daoKey) {
      return NextResponse.json(
        { error: "daoPolicyId and daoKey are required" },
        { status: 400 }
      );
    }

    // Get proposal script address
    const proposalValidator = plutusJson.validators.find(
      (v) => v.title === "proposal.proposal.spend"
    );

    if (!proposalValidator) {
      throw new Error("Proposal validator not found");
    }

    const votePolicyId = getScriptPolicyId("vote.vote.mint", [
      daoPolicyId,
      daoKey,
    ]);

    const proposalScript = createParameterizedScript(
      "proposal.proposal.spend",
      [daoPolicyId, daoKey, votePolicyId]
    );
    const proposalScriptAddress = addressFromScript(proposalScript);

    // Get all proposal UTXOs
    const utxos = await blazeMaestroProvider.getUnspentOutputs(
      proposalScriptAddress
    );

    const proposals: ProposalInfo[] = [];

    for (const utxo of utxos) {
      try {
        const value = utxo.output().amount().toCore();
        if (!value.assets) continue;

        // Find proposal NFT (quantity = 1)
        let proposalPolicyId = "";
        let proposalAssetName = "";

        for (const [assetId, quantity] of value.assets) {
          if (quantity === 1n) {
            proposalPolicyId = Core.AssetId.getPolicyId(assetId);
            proposalAssetName = Core.AssetId.getAssetName(assetId);
            break;
          }
        }

        if (!proposalPolicyId || !proposalAssetName) continue;

        const datum = utxo.output().datum()?.asInlineData();
        if (!datum) continue;

        const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);

        const proposalData = parseProposalDatum(datum, daoInfo);
        if (!proposalData) continue;

        const totalVotes = proposalData.tally.reduce(
          (sum, votes) => sum + votes,
          0
        );

        proposals.push({
          policyId: proposalPolicyId,
          assetName: proposalAssetName,
          name: proposalData.name,
          description: proposalData.description,
          tally: proposalData.tally,
          endTime: proposalData.endTime,
          status: proposalData.status,
          winningOption: proposalData.winningOption,
          identifier: proposalData.identifier,
          utxoRef: {
            txHash: utxo.input().transactionId(),
            outputIndex: Number(utxo.input().index()),
          },
          totalVotes,
        });
      } catch (error) {
        console.error("Error processing proposal UTXO:", error);
        continue;
      }
    }

    // Sort by end time (newest first)
    proposals.sort((a, b) => b.endTime - a.endTime);

    return NextResponse.json({
      proposals,
      count: proposals.length,
    });
  } catch (error) {
    console.error("Error fetching proposals:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch proposals",
      },
      { status: 500 }
    );
  }
}
