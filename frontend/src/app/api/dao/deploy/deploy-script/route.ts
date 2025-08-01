import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  createParameterizedScript,
  getNetworkId,
  addressFromScript,
  getCurrentSlot,
} from "@/lib/server/helpers/script-helpers";

interface DeployScriptRequest {
  scriptName: string;
  scriptTitle: string;
  parameters: string[];
  walletAddress: string;
  collateral: any[];
  changeAddress: string;
  scriptIndex: number;
  totalScripts: number;
}

interface DeployedScriptInfo {
  name: string;
  scriptHash: string;
  address: string;
  deploymentTx: string; // txHash#outputIndex for reference
  size: number;
  parameters: string[];
}

export async function POST(request: NextRequest) {
  try {
    const {
      scriptName,
      scriptTitle,
      parameters,
      walletAddress,
      collateral,
      // changeAddress,
      scriptIndex,
      totalScripts,
    }: DeployScriptRequest = await request.json();

    if (!collateral?.length) {
      throw new Error("No collateral available");
    }

    console.log(
      `📦 Deploying ${scriptName} (${scriptIndex + 1}/${totalScripts})`
    );
    console.log(`🔧 Parameters: [${parameters.join(", ")}]`);

    const sendAddress = Core.addressFromBech32(walletAddress);
    const wallet = new ColdWallet(
      sendAddress,
      getNetworkId(),
      blazeMaestroProvider
    );
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    // Create the parameterized script
    const script = createParameterizedScript(scriptTitle, parameters);
    const scriptAddress = addressFromScript(script);
    const scriptSize = script.toCbor().length / 2; // Convert hex length to bytes

    console.log(`📋 Script Hash: ${script.hash()}`);
    console.log(`🏠 Script Address: ${scriptAddress.toBech32()}`);
    console.log(`📏 Script Size: ${(scriptSize / 1024).toFixed(1)}KB`);

    const currentSlot = getCurrentSlot();
    const validityStart = Core.Slot(Number(currentSlot));
    const validityEnd = Core.Slot(Number(currentSlot) + 3600); // 1 hour validity

    // Deploy the script using Blaze's deployScript method
    const transaction = await blaze
      .newTransaction()
      .deployScript(script)
      .setValidFrom(validityStart)
      .setValidUntil(validityEnd)
      .complete();

    // Get the transaction hash for reference purposes
    const txHash = transaction.toCore().id;

    // The deployScript method creates a UTXO at output index 0 typically
    const deploymentTx = `${txHash}#0`;

    const deployedScriptInfo: DeployedScriptInfo = {
      name: scriptName,
      scriptHash: script.hash(),
      address: scriptAddress.toBech32(),
      deploymentTx,
      size: scriptSize,
      parameters,
    };

    console.log(`✅ ${scriptName} deployment transaction prepared`);

    return NextResponse.json({
      unsignedTx: transaction.toCbor(),
      script: deployedScriptInfo,
      progress: {
        current: scriptIndex + 1,
        total: totalScripts,
        isLast: scriptIndex === totalScripts - 1,
      },
    });
  } catch (error) {
    const { scriptName } = await request.json();
    console.error(`❌ Script deployment failed for ${scriptName}:`, error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : `Failed to deploy ${scriptName}`,
        scriptName,
      },
      { status: 500 }
    );
  }
}
