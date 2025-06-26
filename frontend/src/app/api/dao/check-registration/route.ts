import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { getScriptPolicyId } from "@/lib/server/helpers/script-helpers";
import { checkVoteUtxo } from "@/lib/server/helpers/vote-helpers";
import { getCachedUtxos } from "@/lib/server/helpers/utxo-cache";

interface CheckRegistrationRequest {
  daoPolicyId: string;
  daoKey: string;
  walletAddress: string;
}

export interface RegistrationStatus {
  isRegistered: boolean;
  voteNftAssetName?: string;
  lockedGovernanceTokens?: number;
  votePolicyId?: string;
  voteUtxoExists?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const { daoPolicyId, daoKey, walletAddress }: CheckRegistrationRequest =
      await request.json();

    if (!daoPolicyId || !daoKey || !walletAddress) {
      return NextResponse.json(
        { error: "DAO Policy ID, DAO Key, and wallet address are required" },
        { status: 400 }
      );
    }

    console.debug(`🔍 Checking registration for DAO: ${daoPolicyId}`);
    console.debug(`👛 Wallet: ${walletAddress}`);

    // Get vote policy ID for this DAO
    const votePolicyId = getScriptPolicyId("vote.vote.mint", [
      daoPolicyId,
      daoKey,
    ]);
    console.debug(`🗳️ Vote Policy ID: ${votePolicyId}`);

    // Check user's wallet for vote NFT
    const userAddress = Core.addressFromBech32(walletAddress);
    const userUtxos = await getCachedUtxos(userAddress);

    let voteNftAssetName: string | undefined;
    let uniqueIdentifier: string | undefined;

    // Look for vote NFT (prefix 0001) in user's wallet
    for (const utxo of userUtxos) {
      const value = utxo.output().amount().toCore();
      if (value.assets) {
        for (const [assetId, quantity] of value.assets) {
          const policyId = Core.AssetId.getPolicyId(assetId);
          const assetName = Core.AssetId.getAssetName(assetId);

          if (
            policyId === votePolicyId &&
            assetName.startsWith("0001") &&
            quantity === 1n
          ) {
            voteNftAssetName = assetName;
            uniqueIdentifier = assetName.slice(4); // Remove 0001 prefix
            console.debug(`✅ Found vote NFT: ${voteNftAssetName}`);
            break;
          }
        }
      }
      if (voteNftAssetName) break;
    }

    if (!voteNftAssetName || !uniqueIdentifier) {
      console.debug(`❌ No vote NFT found for user`);
      return NextResponse.json({
        isRegistered: false,
        votePolicyId,
      });
    }

    // Check if corresponding vote UTXO exists and get locked tokens
    const voteUtxoInfo = await checkVoteUtxo(
      votePolicyId,
      uniqueIdentifier,
      daoPolicyId,
      daoKey
    );

    const response: RegistrationStatus = {
      isRegistered: true,
      voteNftAssetName,
      votePolicyId,
      voteUtxoExists: voteUtxoInfo.exists,
      lockedGovernanceTokens: voteUtxoInfo.lockedTokens,
    };

    console.debug(`✅ Registration check complete:`, response);
    return NextResponse.json(response);
  } catch (error) {
    console.error("❌ Registration check error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to check registration",
        isRegistered: false,
      },
      { status: 500 }
    );
  }
}
