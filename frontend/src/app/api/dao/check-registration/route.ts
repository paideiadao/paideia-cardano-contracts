import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript, applyParamsToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";
import plutusJson from "@/lib/scripts/plutus.json";
import { parseDAODatum } from "@/lib/server/helpers/dao-helpers";
import {
  addressFromScript,
  getScriptAddress,
  getScriptPolicyId,
} from "@/lib/server/helpers/script-helpers";

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
    const userUtxos = await blazeMaestroProvider.getUnspentOutputs(userAddress);

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

async function checkVoteUtxo(
  votePolicyId: string,
  uniqueIdentifier: string,
  daoPolicyId: string,
  daoKey: string
): Promise<{ exists: boolean; lockedTokens?: number }> {
  try {
    // Get vote script address
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

    // Get all vote UTXOs
    const voteUtxos = await blazeMaestroProvider.getUnspentOutputs(
      voteScriptAddress
    );

    // Look for UTXO with reference NFT matching our identifier
    const referenceAssetName = "0000" + uniqueIdentifier;

    for (const utxo of voteUtxos) {
      const value = utxo.output().amount().toCore();
      if (value.assets) {
        for (const [assetId, quantity] of value.assets) {
          const policyId = Core.AssetId.getPolicyId(assetId);
          const assetName = Core.AssetId.getAssetName(assetId);

          if (
            policyId === votePolicyId &&
            assetName === referenceAssetName &&
            quantity === 1n
          ) {
            // Found the vote UTXO, now count governance tokens
            const lockedTokens = await countGovernanceTokens(
              utxo,
              daoPolicyId,
              daoKey
            );
            console.debug(
              `📊 Found vote UTXO with ${lockedTokens} locked governance tokens`
            );

            return { exists: true, lockedTokens };
          }
        }
      }
    }

    console.debug(`⚠️ Vote NFT found in wallet but no corresponding vote UTXO`);
    return { exists: false };
  } catch (error) {
    console.error("Error checking vote UTXO:", error);
    return { exists: false };
  }
}

async function countGovernanceTokens(
  voteUtxo: Core.TransactionUnspentOutput,
  daoPolicyId: string,
  daoKey: string
): Promise<number> {
  try {
    // Get DAO info to know what governance token to look for
    const daoInfo = await fetchDAOGovernanceToken(daoPolicyId, daoKey);
    const govTokenHex = daoInfo.governance_token;
    const govPolicyId = govTokenHex.slice(0, 56);
    const govAssetName = govTokenHex.slice(56);

    // Count governance tokens in this vote UTXO
    const value = voteUtxo.output().amount().toCore();
    if (value.assets) {
      for (const [assetId, quantity] of value.assets) {
        const policyId = Core.AssetId.getPolicyId(assetId);
        const assetName = Core.AssetId.getAssetName(assetId);

        if (policyId === govPolicyId && assetName === govAssetName) {
          return Number(quantity);
        }
      }
    }

    return 0;
  } catch (error) {
    console.error("Error counting governance tokens:", error);
    return 0;
  }
}

async function fetchDAOGovernanceToken(
  daoPolicyId: string,
  daoKey: string
): Promise<{ governance_token: string }> {
  const daoScriptAddress = getScriptAddress("dao.dao.spend");
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
