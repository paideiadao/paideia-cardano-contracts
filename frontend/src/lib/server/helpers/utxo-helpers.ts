import { AssetId } from "@blaze-cardano/core";
import { Core } from "@blaze-cardano/sdk";

export function findUTXOWithAsset(
  utxos: Core.TransactionUnspentOutput[],
  policyId: string,
  assetName: string,
  expectedQuantity: bigint = 1n
): Core.TransactionUnspentOutput | null {
  for (const utxo of utxos) {
    const value = utxo.output().amount().toCore();
    if (value.assets) {
      for (const [assetId, quantity] of value.assets) {
        const utxoPolicyId = Core.AssetId.getPolicyId(assetId);
        const utxoAssetName = Core.AssetId.getAssetName(assetId);
        if (
          utxoPolicyId === policyId &&
          utxoAssetName === assetName &&
          quantity === expectedQuantity
        ) {
          return utxo;
        }
      }
    }
  }
  return null;
}

// use like this:
// const seedUtxo = findSuitableSeedUtxoAvoidingVoteNft(userUtxos, votePolicyId, userVoteInfo.voteNftAssetName);

export const findSuitableSeedUtxoAvoidingVoteNft = (
  utxos: Core.TransactionUnspentOutput[],
  votePolicyId: string,
  voteNftAssetName: string
) => {
  // Sort by ADA amount descending to pick the largest UTXO
  const sortedUtxos = utxos
    .filter((utxo) => utxo.output().amount().toCore().coins >= 2_000_000n)
    .sort((a, b) =>
      Number(
        b.output().amount().toCore().coins - a.output().amount().toCore().coins
      )
    );

  if (sortedUtxos.length === 0) {
    throw new Error("No UTXOs with sufficient ADA (2+ ADA) found");
  }

  const selectedUtxo = sortedUtxos[0];
  const value = selectedUtxo.output().amount().toCore();

  // Analyze what's in this UTXO
  const assets: Array<{
    policyId: string;
    assetName: string;
    assetId: AssetId;
    quantity: bigint;
  }> = [];
  let containsVoteNft = false;

  if (value.assets) {
    for (const [assetId, quantity] of value.assets) {
      const policyId = Core.AssetId.getPolicyId(assetId);
      const assetName = Core.AssetId.getAssetName(assetId);
      assets.push({ policyId, assetName, assetId, quantity });

      // Check if this is the Vote NFT
      if (policyId === votePolicyId && assetName === voteNftAssetName) {
        containsVoteNft = true;
      }
    }
  }

  console.log(
    `📦 Selected seed UTXO: ${selectedUtxo
      .input()
      .transactionId()}#${selectedUtxo.input().index()}`
  );
  console.log(`   ADA: ${Number(value.coins) / 1_000_000}`);
  console.log(`   Assets: ${assets.length}`);
  console.log(`   Contains Vote NFT: ${containsVoteNft}`);

  return { utxo: selectedUtxo, containsVoteNft, assets };
};
