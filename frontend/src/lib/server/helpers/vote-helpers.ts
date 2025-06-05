import { Core } from "@blaze-cardano/sdk";
import { cborToScript, applyParamsToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";
import plutusJson from "@/lib/scripts/plutus.json";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { countGovernanceTokens, fetchDAOInfo } from "./dao-helpers";
import { addressFromScript, createParameterizedScript } from "./script-helpers";

export async function getVotePolicyId(
  daoPolicyId: string,
  daoKey: string
): Promise<string> {
  const voteScript = createParameterizedScript("vote.vote.mint", [
    daoPolicyId,
    daoKey,
  ]);

  return voteScript.hash();
}

export async function createVoteScript(
  daoPolicyId: string,
  daoKey: string
): Promise<Core.Script> {
  const voteScript = createParameterizedScript("vote.vote.mint", [
    daoPolicyId,
    daoKey,
  ]);

  return voteScript;
}

export function findVoteNftUtxo(
  utxos: Core.TransactionUnspentOutput[],
  voteNftAssetName: string
): Core.TransactionUnspentOutput | null {
  for (const utxo of utxos) {
    const value = utxo.output().amount().toCore();
    if (value.assets) {
      for (const [assetId, quantity] of value.assets) {
        const assetName = Core.AssetId.getAssetName(assetId);
        if (assetName === voteNftAssetName && quantity === 1n) {
          return utxo;
        }
      }
    }
  }
  return null;
}

export async function countGovernanceTokensInVoteUtxo(
  voteUtxo: Core.TransactionUnspentOutput,
  govPolicyId: string,
  govAssetName: string
): Promise<number> {
  const value = voteUtxo.output().amount().toCore();
  if (value.assets) {
    for (const [assetId, quantity] of value.assets) {
      const policyId = Core.AssetId.getPolicyId(assetId);
      const assetNameFromId = Core.AssetId.getAssetName(assetId);

      if (policyId === govPolicyId && assetNameFromId === govAssetName) {
        return Number(quantity);
      }
    }
  }
  return 0;
}

export async function getVoteUtxo(
  daoPolicyId: string,
  daoKey: string,
  voteUtxoRef: { txHash: string; outputIndex: number },
  options?: { enableLogging?: boolean }
): Promise<Core.TransactionUnspentOutput | null> {
  try {
    const voteScript = createParameterizedScript("vote.vote.spend", [
      daoPolicyId,
      daoKey,
    ]);
    const voteScriptAddress = addressFromScript(voteScript);

    if (options?.enableLogging) {
      console.log("🔍 VOTE UTXO SEARCH:");
      console.log("Vote script address:", voteScriptAddress.toBech32());
      console.log("Looking for UTXO:", voteUtxoRef);
      console.log("DAO Policy ID:", daoPolicyId);
    }

    const voteUtxos = await blazeMaestroProvider.getUnspentOutputs(
      voteScriptAddress
    );

    if (options?.enableLogging) {
      console.log("Found vote UTXOs:", voteUtxos.length);
      voteUtxos.forEach((utxo, i) => {
        console.log(`Vote UTXO ${i}:`, {
          txHash: utxo.input().transactionId(),
          outputIndex: utxo.input().index(),
          value: utxo.output().amount().toCore(),
        });
      });
    }

    const foundUtxo = voteUtxos.find(
      (utxo) =>
        utxo.input().transactionId() === voteUtxoRef.txHash &&
        Number(utxo.input().index()) === voteUtxoRef.outputIndex
    );

    if (options?.enableLogging) {
      console.log("Vote UTXO found:", !!foundUtxo);
    }

    return foundUtxo ?? null;
  } catch (error) {
    if (options?.enableLogging) {
      console.error("Error fetching vote UTXO:", error);
    }
    throw new Error(
      `Failed to fetch vote UTXO: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function findUserVoteUtxo(
  walletAddress: string,
  votePolicyId: string,
  daoPolicyId: string,
  daoKey: string
) {
  const userAddress = Core.addressFromBech32(walletAddress);
  const userUtxos = await blazeMaestroProvider.getUnspentOutputs(userAddress);

  // Collect ALL Vote NFTs the user has
  const userVoteNfts: Array<{ assetName: string; uniqueId: string }> = [];

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
          userVoteNfts.push({
            assetName,
            uniqueId: assetName.slice(4),
          });
        }
      }
    }
  }

  if (userVoteNfts.length === 0) {
    return null;
  }

  // Get Vote UTXOs
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

  // Try to find a matching Vote UTXO for each Vote NFT the user has
  for (const voteNft of userVoteNfts) {
    const referenceAssetName = "0000" + voteNft.uniqueId;

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
            // Found matching pair! Check if it has governance tokens
            const lockedTokens = await countGovernanceTokens(
              utxo,
              daoPolicyId,
              daoKey
            );

            if (lockedTokens > 0) {
              return {
                utxo: {
                  txHash: utxo.input().transactionId(),
                  outputIndex: Number(utxo.input().index()),
                },
                lockedGovernanceTokens: lockedTokens,
                voteNftAssetName: voteNft.assetName,
                referenceAssetName,
              };
            }
          }
        }
      }
    }
  }

  return null;
}

export async function checkVoteUtxo(
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
