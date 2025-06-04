import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript, applyParamsToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";
import plutusJson from "@/lib/scripts/plutus.json";
import {
  findUserVoteUtxo,
  getVotePolicyId,
} from "@/lib/server/helpers/vote-helpers";
import { parseDAODatum } from "@/lib/server/helpers/dao-helpers";
import {
  addressFromScript,
  getNetworkId,
} from "@/lib/server/helpers/script-helpers";

interface UnregisterAnalysisRequest {
  daoPolicyId: string;
  daoKey: string;
  walletAddress: string;
}

export interface VoteReceiptInfo {
  proposalId: string;
  optionIndex: number;
  amount: number;
  proposalName?: string;
  proposalStatus?: "Active" | "Passed" | "FailedThreshold" | "FailedQuorum";
  endTime?: number;
}

export interface UnregisterAnalysis {
  canUnregister: boolean;
  voteUtxo?: {
    utxo: any;
    lockedGovernanceTokens: number;
    voteNftAssetName: string;
    referenceAssetName: string;
  };
  activeVotes: VoteReceiptInfo[];
  endedVotes: VoteReceiptInfo[];
  votePolicyId: string;
  blockingMessage?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { daoPolicyId, daoKey, walletAddress }: UnregisterAnalysisRequest =
      await request.json();

    if (!daoPolicyId || !daoKey || !walletAddress) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    console.debug(
      `🔍 Analyzing unregister eligibility for DAO: ${daoPolicyId}`
    );

    // Get vote policy ID and user's vote NFT
    const votePolicyId = await getVotePolicyId(daoPolicyId, daoKey);
    const userVoteInfo = await findUserVoteUtxo(
      walletAddress,
      votePolicyId,
      daoPolicyId,
      daoKey
    );

    if (!userVoteInfo) {
      return NextResponse.json({
        canUnregister: false,
        activeVotes: [],
        endedVotes: [],
        votePolicyId,
        blockingMessage: "No vote registration found",
      });
    }

    // Analyze vote receipts
    const voteReceipts = await analyzeVoteReceipts(
      userVoteInfo.utxo,
      daoPolicyId,
      daoKey,
      votePolicyId
    );

    const activeVotes = voteReceipts.filter(
      (vote) => vote.proposalStatus === "Active"
    );
    const endedVotes = voteReceipts.filter(
      (vote) => vote.proposalStatus !== "Active"
    );

    const canUnregister = activeVotes.length === 0;
    const blockingMessage =
      activeVotes.length > 0
        ? `You have ${activeVotes.length} active vote(s). Wait for proposals to end before unregistering.`
        : undefined;

    const analysis: UnregisterAnalysis = {
      canUnregister,
      voteUtxo: userVoteInfo,
      activeVotes,
      endedVotes,
      votePolicyId,
      blockingMessage,
    };

    console.debug(`✅ Analysis complete:`, {
      canUnregister,
      activeVotes: activeVotes.length,
      endedVotes: endedVotes.length,
    });

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("❌ Unregister analysis error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Analysis failed",
        canUnregister: false,
        activeVotes: [],
        endedVotes: [],
        votePolicyId: "",
      },
      { status: 500 }
    );
  }
}

async function analyzeVoteReceipts(
  voteUtxoRef: any,
  daoPolicyId: string,
  daoKey: string,
  votePolicyId: string
): Promise<VoteReceiptInfo[]> {
  // Get the actual Vote UTXO to examine its assets
  const voteValidator = plutusJson.validators.find(
    (v) => v.title === "vote.vote.spend"
  );

  if (!voteValidator) {
    throw new Error("Vote spend validator not found");
  }

  const parameterizedVoteScript = (applyParamsToScript as any)(
    voteValidator.compiledCode,
    Type.Tuple([Type.String(), Type.String()]),
    [daoPolicyId, daoKey]
  );

  const voteScript = cborToScript(parameterizedVoteScript, "PlutusV3");
  const voteScriptAddress = addressFromScript(voteScript);

  const voteUtxos = await blazeMaestroProvider.getUnspentOutputs(
    voteScriptAddress
  );

  // Find our specific Vote UTXO
  const ourVoteUtxo = voteUtxos.find(
    (utxo) =>
      utxo.input().transactionId() === voteUtxoRef.txHash &&
      utxo.input().index() === voteUtxoRef.outputIndex
  );

  if (!ourVoteUtxo) {
    return [];
  }

  // Extract vote receipt tokens (anything that's not reference NFT or governance tokens)
  const voteReceipts: VoteReceiptInfo[] = [];
  const value = ourVoteUtxo.output().amount().toCore();

  if (value.assets) {
    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    const govTokenHex = daoInfo.governance_token;
    const govPolicyId = govTokenHex.slice(0, 56);
    const govAssetName = govTokenHex.slice(56);

    for (const [assetId, quantity] of value.assets) {
      const policyId = Core.AssetId.getPolicyId(assetId);
      const assetName = Core.AssetId.getAssetName(assetId);

      // Skip reference NFT and governance tokens
      if (policyId === votePolicyId && assetName.startsWith("0000")) continue;
      if (policyId === govPolicyId && assetName === govAssetName) continue;

      // This should be a vote receipt token
      // Vote receipts are minted by proposal policies
      if (daoInfo.whitelisted_proposals.includes(policyId)) {
        const proposalInfo = await getProposalInfo(policyId, assetName);
        voteReceipts.push({
          proposalId: assetName,
          optionIndex: await extractOptionIndex(assetName),
          amount: Number(quantity),
          proposalName: proposalInfo?.name,
          proposalStatus: proposalInfo?.status,
          endTime: proposalInfo?.endTime,
        });
      }
    }
  }

  return voteReceipts;
}

async function fetchDAOInfo(
  daoPolicyId: string,
  daoKey: string
): Promise<{
  governance_token: string;
  whitelisted_proposals: string[];
}> {
  const daoValidator = plutusJson.validators.find(
    (v) => v.title === "dao.dao.spend"
  );

  if (!daoValidator) {
    throw new Error("DAO validator not found");
  }

  const daoScript = cborToScript(daoValidator.compiledCode, "PlutusV3");
  const daoScriptAddress = addressFromScript(daoScript);

  const utxos = await blazeMaestroProvider.getUnspentOutputs(daoScriptAddress);

  for (const utxo of utxos) {
    const value = utxo.output().amount().toCore();
    if (value.assets) {
      for (const [assetId, quantity] of value.assets) {
        if (quantity === 1n) {
          const utxoPolicyId = Core.AssetId.getPolicyId(assetId);
          const utxoAssetName = Core.AssetId.getAssetName(assetId);
          if (utxoPolicyId === daoPolicyId && utxoAssetName === daoKey) {
            const datum = utxo.output().datum()?.asInlineData();
            if (!datum) {
              throw new Error("DAO UTXO missing datum");
            }
            return parseDAODatum(datum);
          }
        }
      }
    }
  }

  throw new Error("DAO not found");
}

async function getProposalInfo(
  proposalPolicyId: string,
  proposalIdentifier: string
): Promise<{
  name?: string;
  status?: "Active" | "Passed" | "FailedThreshold" | "FailedQuorum";
  endTime?: number;
} | null> {
  try {
    // This would query proposal UTXOs to get current status
    // For now, return null since proposal querying is complex
    return null;
  } catch (error) {
    return null;
  }
}

async function extractOptionIndex(receiptAssetName: string): Promise<number> {
  // Vote receipt asset names encode the option index
  // This would need to match the encoding from get_vote_receipt_identifier
  // For now, return 0 as placeholder
  return 0;
}
