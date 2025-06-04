import { Core } from "@blaze-cardano/sdk";
import { cborToScript, applyParamsToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";
import plutusJson from "@/lib/scripts/plutus.json";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { fetchDAOInfo } from "./dao-helpers";
import { addressFromScript, getNetworkId } from "./script-helpers";

export async function getVotePolicyId(
  daoPolicyId: string,
  daoKey: string
): Promise<string> {
  const voteValidator = plutusJson.validators.find(
    (v) => v.title === "vote.vote.mint"
  );

  if (!voteValidator) {
    throw new Error("Vote validator not found");
  }

  const parameterizedVoteScript = (applyParamsToScript as any)(
    voteValidator.compiledCode,
    Type.Tuple([Type.String(), Type.String()]),
    [daoPolicyId, daoKey]
  );

  const voteScript = cborToScript(parameterizedVoteScript, "PlutusV3");
  return voteScript.hash();
}

export async function createVoteScript(
  daoPolicyId: string,
  daoKey: string
): Promise<Core.Script> {
  const voteValidator = plutusJson.validators.find(
    (v) => v.title === "vote.vote.mint"
  );

  if (!voteValidator) {
    throw new Error("Vote validator not found");
  }

  const parameterizedVoteScript = (applyParamsToScript as any)(
    voteValidator.compiledCode,
    Type.Tuple([Type.String(), Type.String()]),
    [daoPolicyId, daoKey]
  );

  return cborToScript(parameterizedVoteScript, "PlutusV3");
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
  voteUtxoRef: { txHash: string; outputIndex: number }
): Promise<Core.TransactionUnspentOutput | null> {
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

  return (
    voteUtxos.find(
      (utxo) =>
        utxo.input().transactionId() === voteUtxoRef.txHash &&
        Number(utxo.input().index()) === voteUtxoRef.outputIndex
    ) ?? null
  );
}

export async function findUserVoteUtxo(
  walletAddress: string,
  votePolicyId: string,
  daoPolicyId: string,
  daoKey: string
) {
  // First find user's Vote NFT to get unique identifier
  const userAddress = Core.addressFromBech32(walletAddress);
  const userUtxos = await blazeMaestroProvider.getUnspentOutputs(userAddress);

  let voteNftAssetName: string | undefined;
  let uniqueIdentifier: string | undefined;

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
          uniqueIdentifier = assetName.slice(4);
          break;
        }
      }
    }
    if (voteNftAssetName) break;
  }

  if (!voteNftAssetName || !uniqueIdentifier) {
    return null;
  }

  // Find corresponding Vote UTXO
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
          const lockedTokens = await countGovernanceTokens(
            utxo,
            daoPolicyId,
            daoKey
          );

          return {
            utxo: {
              txHash: utxo.input().transactionId(),
              outputIndex: Number(utxo.input().index()),
            },
            lockedGovernanceTokens: lockedTokens,
            voteNftAssetName,
            referenceAssetName,
          };
        }
      }
    }
  }

  return null;
}

export async function countGovernanceTokens(
  voteUtxo: Core.TransactionUnspentOutput,
  daoPolicyId: string,
  daoKey: string
): Promise<number> {
  try {
    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    const govTokenHex = daoInfo.governance_token;
    const govPolicyId = govTokenHex.slice(0, 56);
    const govAssetName = govTokenHex.slice(56);

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
  } catch (error) {
    console.error("Error counting governance tokens:", error);
    return 0;
  }
}
