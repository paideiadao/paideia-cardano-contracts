import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import {
  timestampToSlot,
  getNetworkId,
} from "@/lib/server/helpers/script-helpers";

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

interface ScriptToScan {
  name: string;
  scriptHash: string;
  parameters: string[];
}

export async function POST(request: NextRequest) {
  try {
    const { scriptsToScan }: { scriptsToScan: ScriptToScan[] } =
      await request.json();

    if (!scriptsToScan?.length) {
      throw new Error("No scripts provided to scan");
    }

    const networkId = getNetworkId();
    const burnAddress = Core.getBurnAddress(networkId);

    console.log(`🔍 Scanning burn address: ${burnAddress.toBech32()}`);
    console.log(`📋 Looking for ${scriptsToScan.length} scripts`);

    const maestroApiKey = process.env.MAESTRO_API_KEY!;
    const network = process.env.NETWORK!;
    const maestroNetwork = network === "mainnet" ? "mainnet" : "preview";
    const burnAddressBech32 = burnAddress.toBech32();

    let allUtxos: MaestroUtxo[] = [];
    let nextCursor: string | undefined;

    // Fetch UTXOs from burn address (scripts deployed in last few months)
    do {
      const fromDate = new Date("2025-06-23T00:00:00Z");
      const fromTimestamp = fromDate.getTime();
      const fromSlot = timestampToSlot(fromTimestamp);

      let url = `https://${maestroNetwork}.gomaestro-api.org/v1/addresses/${burnAddressBech32}/utxos?from=${fromSlot}&order=desc&count=100`;
      if (nextCursor) {
        url += `&cursor=${nextCursor}`;
      }

      const response = await fetch(url, {
        headers: {
          "api-key": maestroApiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Maestro API error: ${response.status}`);
      }

      const data = await response.json();
      allUtxos.push(...data.data);
      nextCursor = data.next_cursor;

      console.log(
        `📦 Fetched ${data.data.length} UTXOs, total so far: ${allUtxos.length}`
      );
    } while (nextCursor);

    console.log(`📦 Total UTXOs found at burn address: ${allUtxos.length}`);

    const deployedScripts: Record<string, any> = {};

    // Check each script we're looking for
    for (const scriptToScan of scriptsToScan) {
      console.log(
        `🔍 Looking for ${scriptToScan.name} with hash: ${scriptToScan.scriptHash}`
      );

      const deploymentUtxo = allUtxos.find(
        (utxo) => utxo.reference_script?.hash === scriptToScan.scriptHash
      );

      if (deploymentUtxo) {
        deployedScripts[scriptToScan.name] = {
          txHash: deploymentUtxo.tx_hash,
          outputIndex: deploymentUtxo.index,
          scriptHash: scriptToScan.scriptHash,
          size: deploymentUtxo.reference_script?.bytes
            ? deploymentUtxo.reference_script.bytes.length / 2
            : 0,
          parameters: scriptToScan.parameters,
        };
        console.log(
          `✅ Found ${scriptToScan.name} deployed at ${deploymentUtxo.tx_hash}#${deploymentUtxo.index}`
        );
      } else {
        console.log(`❌ No deployment found for ${scriptToScan.name}`);
      }
    }

    console.log(`📋 Deployed scripts found:`, Object.keys(deployedScripts));

    return NextResponse.json({
      deployedScripts,
      totalScanned: allUtxos.length,
      foundCount: Object.keys(deployedScripts).length,
    });
  } catch (error) {
    console.error("❌ Scan deployed scripts error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to scan deployed scripts",
        deployedScripts: {},
      },
      { status: 500 }
    );
  }
}
