import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { cborToScript } from "@blaze-cardano/uplc";
import plutusJson from "@/lib/scripts/plutus.json";
import { timestampToSlot } from "@/lib/server/helpers/script-helpers";
import { scriptConfigs } from "@/lib/scripts/script-configs";

interface MaestroUtxo {
  tx_hash: string;
  index: number;
  slot: number;
  assets: Array<{ unit: string; amount: number }>;
  address: string;
  datum: any;
  reference_script: {
    hash: string;
    type: string;
    bytes: string;
    json: any;
  } | null;
  txout_cbor: string | null;
}

interface MaestroResponse {
  data: MaestroUtxo[];
  last_updated: {
    timestamp: string;
    block_hash: string;
    block_slot: number;
  };
  next_cursor: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const { network } = await request.json();

    const networkId = network === "mainnet" ? 1 : 0;
    const burnAddress = Core.getBurnAddress(networkId);

    console.log(`🔍 Scanning burn address: ${burnAddress.toBech32()}`);

    const maestroApiKey = process.env.MAESTRO_API_KEY!;
    const maestroNetwork = network === "mainnet" ? "mainnet" : "preview";
    const burnAddressBech32 = burnAddress.toBech32();

    const allUtxos: any[] = [];
    let nextCursor: string | undefined;

    do {
      const fromDate = new Date("2025-06-24T00:00:00Z");
      const fromTimestamp = fromDate.getTime(); // milliseconds
      const fromSlot = timestampToSlot(fromTimestamp);

      const url = `https://${maestroNetwork}.gomaestro-api.org/v1/addresses/${burnAddressBech32}/utxos?from=${fromSlot}&order=desc&count=100`;

      const response = await fetch(url, {
        headers: {
          "api-key": maestroApiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Maestro API error: ${response.status}`);
      }

      const data = await response.json();

      console.log(data);
      allUtxos.push(...data.data);
      nextCursor = data.next_cursor;

      console.log(
        `📦 Fetched ${data.data.length} UTXOs, total so far: ${allUtxos.length}`
      );
    } while (nextCursor);

    console.log(`📦 Total UTXOs found: ${allUtxos.length}`);

    const deployedScripts: Record<string, any> = {};

    for (const config of scriptConfigs) {
      const validator = plutusJson.validators.find(
        (v) => v.title === config.title
      );
      if (!validator) continue;

      const script = cborToScript(validator.compiledCode, "PlutusV3");
      const expectedScriptHash = script.hash();

      console.log(
        `🔍 Looking for ${config.name} with hash: ${expectedScriptHash}`
      );

      const deploymentUtxo = allUtxos.find(
        (utxo) => utxo.reference_script?.hash === expectedScriptHash
      );

      if (deploymentUtxo) {
        deployedScripts[config.name] = {
          txHash: deploymentUtxo.tx_hash,
          outputIndex: deploymentUtxo.index,
          scriptHash: expectedScriptHash,
          size: validator.compiledCode.length / 2,
        };
        console.log(`✅ Found and added ${config.name} to deployed scripts`);
      } else {
        console.log(`❌ No deployment found for ${config.name}`);
      }
    }

    console.log(`📋 Final deployed scripts:`, Object.keys(deployedScripts));

    return NextResponse.json({ deployedScripts });
  } catch (error) {
    console.error("Scan deployment error:", error);
    return NextResponse.json({ deployedScripts: {} });
  }
}
