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
