import { NextRequest, NextResponse } from "next/server";
import { getUserVoteStatus } from "@/lib/server/helpers/vote-helpers";
import {
  ActionTarget,
  findProposalActions,
  getProposalUtxo,
  parseProposalDatum,
} from "@/lib/server/helpers/proposal-helpers";
import { fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";

export interface ProposalDetails {
  policyId: string;
  assetName: string;
  name: string;
  description: string;
  tally: number[];
  endTime: number;
  status:
    | "Active"
    | "FailedThreshold"
    | "FailedQuorum"
    | "Passed"
    | "ReadyForEvaluation";
  winningOption?: number;
  identifier: {
    txHash: string;
    outputIndex: number;
  };
  totalVotes: number;
  actions: Array<{
    index: number;
    name: string;
    description: string;
    targets: ActionTarget[];
  }>;
  userVoteInfo?: {
    hasVoted: boolean;
    votedOption?: number;
    votedAmount?: number;
    canVote: boolean;
    votePower: number; // Always full registered amount
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

    // Get proposal UTXO using the proper helper function
    const proposalUtxo = await getProposalUtxo(
      proposalPolicyId,
      proposalAssetName,
      daoPolicyId,
      daoKey
    );

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

    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);

    const proposalData = parseProposalDatum(datum, daoInfo);
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
      endTime: proposalData.endTime,
      status: proposalData.status,
      winningOption: proposalData.winningOption,
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
