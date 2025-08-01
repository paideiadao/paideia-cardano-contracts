import { NextRequest, NextResponse } from "next/server";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import plutusJson from "@/lib/scripts/plutus.json";
import { cborToScript, applyParamsToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";
import { addressFromScript } from "@/lib/server/helpers/script-helpers";

export async function POST(request: NextRequest) {
  try {
    const { daoPolicyId, daoKey } = await request.json();

    if (!daoPolicyId || !daoKey) {
      return NextResponse.json(
        { error: "DAO Policy ID and DAO Key are required" },
        { status: 400 }
      );
    }

    // Load treasury validator
    const treasuryValidator = plutusJson.validators.find(
      (v) => v.title === "treasury.treasury.spend"
    );

    if (!treasuryValidator) {
      throw new Error("Treasury validator not found in plutus.json");
    }

    // Parameterize treasury script with DAO policy ID and key
    const parameterizedTreasuryScript = (applyParamsToScript as any)(
      treasuryValidator.compiledCode,
      Type.Tuple([
        Type.String(), // PolicyId as hex string
        Type.String(), // AssetName as hex string
      ]),
      [daoPolicyId, daoKey]
    );

    const treasuryScript = cborToScript(
      parameterizedTreasuryScript,
      "PlutusV3"
    );

    // Get treasury address (script address)
    const treasuryAddress = addressFromScript(treasuryScript);

    // Get treasury UTXOs and extract assets
    let assets: any[] = [];
    try {
      const utxos = await blazeMaestroProvider.getUnspentOutputs(
        treasuryAddress
      );

      // Aggregate all assets in treasury
      const assetMap = new Map<string, bigint>();

      for (const utxo of utxos) {
        const value = utxo.output().amount();

        // Add ADA
        const ada = value.coin();
        assetMap.set("lovelace", (assetMap.get("lovelace") ?? 0n) + ada);

        // Add other assets from multiasset
        const coreValue = value.toCore();
        if (coreValue.assets) {
          for (const [assetId, quantity] of coreValue.assets) {
            assetMap.set(assetId, (assetMap.get(assetId) ?? 0n) + quantity);
          }
        }
      }

      // Convert to array format
      assets = Array.from(assetMap.entries()).map(([unit, quantity]) => ({
        unit,
        quantity: quantity.toString(),
      }));
    } catch {
      console.error("Treasury has no UTXOs yet (empty treasury)");
      assets = [];
    }

    return NextResponse.json({
      address: treasuryAddress.toBech32(),
      assets,
      network: process.env.NETWORK,
    });
  } catch (error) {
    console.error("Treasury info error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to get treasury info",
      },
      { status: 500 }
    );
  }
}
