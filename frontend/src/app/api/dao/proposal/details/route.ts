import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  addressFromScript,
  createParameterizedScript,
  getScriptPolicyId,
} from "@/lib/server/helpers/script-helpers";
import {
  findUserVoteUtxo,
  getUserVoteStatus,
  getVotePolicyId,
} from "@/lib/server/helpers/vote-helpers";
import { findProposalActions } from "@/lib/server/helpers/proposal-helpers";

export interface ProposalDetails {
  policyId: string;
  assetName: string;
  name: string;
  description: string;
  tally: number[];
  endTime: number;
  status: "Active" | "FailedThreshold" | "FailedQuorum" | "Passed";
  winningOption?: number;
  identifier: {
    txHash: string;
    outputIndex: number;
  };
  totalVotes: number;
  actions: Array<{
    index: number;
    name?: string;
    description?: string;
    targets?: Array<{
      address: string;
      assets: Array<{
        unit: string;
        quantity: string;
      }>;
    }>;
  }>;
  userVoteInfo?: {
    hasVoted: boolean;
    votedOption?: number;
    votePower?: number;
    canVote: boolean;
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const proposalPolicyId = searchParams.get("proposalPolicyId");
    const proposalAssetName = searchParams.get("proposalAssetName");
    const daoPolicyId = searchParams.get("daoPolicyId");
    const daoKey = searchParams.get("daoKey");
    const walletAddress = searchParams.get("walletAddress");

    if (!proposalPolicyId || !proposalAssetName || !daoPolicyId || !daoKey) {
      return NextResponse.json(
        {
          error:
            "proposalPolicyId, proposalAssetName, daoPolicyId, and daoKey are required",
        },
        { status: 400 }
      );
    }

    // Get proposal UTXO
    const votePolicyId = await getVotePolicyId(daoPolicyId, daoKey);
    const proposalScript = createParameterizedScript(
      "proposal.proposal.spend",
      [daoPolicyId, daoKey, votePolicyId]
    );
    const proposalScriptAddress = addressFromScript(proposalScript);

    const utxos = await blazeMaestroProvider.getUnspentOutputs(
      proposalScriptAddress
    );

    let proposalUtxo = null;
    for (const utxo of utxos) {
      const value = utxo.output().amount().toCore();
      if (value.assets) {
        for (const [assetId, quantity] of value.assets) {
          if (quantity === 1n) {
            const utxoPolicyId = Core.AssetId.getPolicyId(assetId);
            const utxoAssetName = Core.AssetId.getAssetName(assetId);
            if (
              utxoPolicyId === proposalPolicyId &&
              utxoAssetName === proposalAssetName
            ) {
              proposalUtxo = utxo;
              break;
            }
          }
        }
      }
      if (proposalUtxo) break;
    }

    if (!proposalUtxo) {
      return NextResponse.json(
        { error: "Proposal not found" },
        { status: 404 }
      );
    }

    const datum = proposalUtxo.output().datum()?.asInlineData();
    if (!datum) {
      throw new Error("Proposal UTXO missing datum");
    }

    const proposalData = parseProposalDatum(datum);
    if (!proposalData) {
      throw new Error("Failed to parse proposal datum");
    }

    // Look for action UTXOs related to this proposal
    const actions = await findProposalActions(
      proposalPolicyId,
      proposalAssetName,
      daoPolicyId,
      daoKey
    );

    // Check user vote status if wallet address provided
    let userVoteInfo;
    if (walletAddress) {
      userVoteInfo = await getUserVoteStatus(
        walletAddress,
        proposalPolicyId,
        proposalAssetName,
        daoPolicyId,
        daoKey
      );
    }

    const totalVotes = proposalData.tally.reduce(
      (sum, votes) => sum + votes,
      0
    );

    const proposalDetails: ProposalDetails = {
      policyId: proposalPolicyId,
      assetName: proposalAssetName,
      name: proposalData.name,
      description: proposalData.description,
      tally: proposalData.tally,
      endTime: proposalData.end_time,
      status: proposalData.status,
      winningOption:
        proposalData.status === "Passed"
          ? proposalData.winning_option
          : undefined,
      identifier: proposalData.identifier,
      totalVotes,
      actions,
      userVoteInfo,
    };

    return NextResponse.json(proposalDetails);
  } catch (error) {
    console.error("Error fetching proposal details:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch proposal details",
      },
      { status: 500 }
    );
  }
}

function parseProposalDatum(datum: Core.PlutusData): {
  name: string;
  description: string;
  tally: number[];
  end_time: number;
  status: "Active" | "FailedThreshold" | "FailedQuorum" | "Passed";
  winning_option?: number;
  identifier: {
    txHash: string;
    outputIndex: number;
  };
} | null {
  try {
    const constr = datum.asConstrPlutusData();
    if (!constr || constr.getAlternative() !== 0n) return null;

    const fields = constr.getData();
    if (fields.getLength() < 6) return null;

    const name = new TextDecoder().decode(
      fields.get(0).asBoundedBytes() ?? new Uint8Array()
    );

    const description = new TextDecoder().decode(
      fields.get(1).asBoundedBytes() ?? new Uint8Array()
    );

    const tallyList = fields.get(2).asList();
    const tally: number[] = [];
    if (tallyList) {
      for (let i = 0; i < tallyList.getLength(); i++) {
        tally.push(Number(tallyList.get(i).asInteger() ?? 0n));
      }
    }

    const end_time = Number(fields.get(3).asInteger() ?? 0n);

    const statusConstr = fields.get(4).asConstrPlutusData();
    let status: "Active" | "FailedThreshold" | "FailedQuorum" | "Passed" =
      "Active";
    let winning_option: number | undefined;

    if (statusConstr) {
      const statusAlt = Number(statusConstr.getAlternative());
      switch (statusAlt) {
        case 0:
          status = "Active";
          break;
        case 1:
          status = "FailedThreshold";
          break;
        case 2:
          status = "FailedQuorum";
          break;
        case 3:
          status = "Passed";
          const passedFields = statusConstr.getData();
          if (passedFields.getLength() > 0) {
            winning_option = Number(passedFields.get(0).asInteger() ?? 0n);
          }
          break;
      }
    }

    const identifierConstr = fields.get(5).asConstrPlutusData();
    let identifier = { txHash: "", outputIndex: 0 };
    if (identifierConstr) {
      const idFields = identifierConstr.getData();
      if (idFields.getLength() >= 2) {
        const txHashBytes = idFields.get(0).asBoundedBytes();
        const outputIndex = Number(idFields.get(1).asInteger() ?? 0n);

        if (txHashBytes) {
          identifier = {
            txHash: Core.toHex(txHashBytes),
            outputIndex,
          };
        }
      }
    }

    return {
      name,
      description,
      tally,
      end_time,
      status,
      winning_option,
      identifier,
    };
  } catch (error) {
    console.error("Error parsing proposal datum:", error);
    return null;
  }
}
