import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript, applyParamsToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";
import plutusJson from "@/lib/scripts/plutus.json";
import {
  createVoteReceiptIdentifier,
  findUserVoteUtxo,
  getVotePolicyId,
} from "@/lib/server/helpers/vote-helpers";
import { fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";
import { addressFromScript } from "@/lib/server/helpers/script-helpers";
import { parseRawProposalDatum } from "@/lib/server/helpers/proposal-helpers";

export interface UnregisterAnalysisRequest {
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
          optionIndex: await extractOptionIndex(assetName, assetName),
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

async function getProposalInfo(
  proposalPolicyId: string,
  proposalIdentifier: string
): Promise<{
  name?: string;
  status?: "Active" | "Passed" | "FailedThreshold" | "FailedQuorum";
  endTime?: number;
} | null> {
  try {
    const proposalValidator = plutusJson.validators.find(
      (v) => v.title === "proposal.proposal.spend"
    );

    if (!proposalValidator) {
      return null;
    }

    const proposalScript = cborToScript(
      proposalValidator.compiledCode,
      "PlutusV3"
    );
    const proposalScriptAddress = addressFromScript(proposalScript);

    const proposalUtxos = await blazeMaestroProvider.getUnspentOutputs(
      proposalScriptAddress
    );

    // Find the specific proposal UTXO by looking for the proposal identifier asset
    for (const utxo of proposalUtxos) {
      const value = utxo.output().amount().toCore();
      if (value.assets) {
        for (const [assetId, quantity] of value.assets) {
          const policyId = Core.AssetId.getPolicyId(assetId);
          const assetName = Core.AssetId.getAssetName(assetId);

          if (
            policyId === proposalPolicyId &&
            assetName === proposalIdentifier &&
            quantity === 1n
          ) {
            // Found the proposal UTXO, parse its datum
            const datum = utxo.output().datum()?.asInlineData();
            if (!datum) continue;

            const proposal = parseRawProposalDatum(datum);
            if (!proposal) continue;

            // Determine actual status
            const statusConstr = proposal.status.asConstrPlutusData();
            let status:
              | "Active"
              | "Passed"
              | "FailedThreshold"
              | "FailedQuorum" = "Active";

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
                  break;
              }
            }

            return {
              name: proposal.name,
              status,
              endTime: proposal.end_time,
            };
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error getting proposal info:", error);
    return null;
  }
}

async function extractOptionIndex(
  receiptAssetName: string,
  proposalIdentifier: string
): Promise<number> {
  // Try each possible option index to find which one matches this receipt
  for (let optionIndex = 0; optionIndex < 20; optionIndex++) {
    // Check up to 20 options
    const expectedReceiptIdentifier = createVoteReceiptIdentifier(
      proposalIdentifier,
      optionIndex
    );

    if (expectedReceiptIdentifier === receiptAssetName) {
      return optionIndex;
    }
  }

  console.warn(
    `Could not determine option index for receipt: ${receiptAssetName}`
  );
  return 0;
}
