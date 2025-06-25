import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript } from "@blaze-cardano/uplc";
import { getNetworkId } from "@/lib/server/helpers/script-helpers";
import plutusJson from "@/lib/scripts/plutus.json";

export const scriptConfigs = [
  {
    name: "actionSendFunds",
    title: "action_send_funds.action_send_funds.spend", // or .mint - they're the same
  },
  {
    name: "authTokenPolicy",
    title: "auth_token_policy.auth_token_policy.mint",
  },
  {
    name: "dao",
    title: "dao.dao.spend", // or .mint - they're the same
  },
  {
    name: "proposal",
    title: "proposal.proposal.spend", // or .mint - they're the same
  },
  {
    name: "tokenMintingPolicy",
    title: "token_minting_policy.token_minting_policy.mint",
  },
  {
    name: "treasury",
    title: "treasury.treasury.spend",
  },
  {
    name: "vote",
    title: "vote.vote.spend", // or .mint - they're the same
  },
];

export async function POST(request: NextRequest) {
  try {
    const {
      network,
      walletAddress,
      collateral,
      changeAddress,
      scriptIndex = 0,
    } = await request.json();

    if (scriptIndex >= scriptConfigs.length) {
      return NextResponse.json(
        { error: "Invalid script index" },
        { status: 400 }
      );
    }

    const config = scriptConfigs[scriptIndex];
    const validator = plutusJson.validators.find(
      (v) => v.title === config.title
    );

    if (!validator) {
      throw new Error(`Script not found: ${config.title}`);
    }

    const sendAddress = Core.addressFromBech32(walletAddress);
    const wallet = new ColdWallet(
      sendAddress,
      getNetworkId(),
      blazeMaestroProvider
    );
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    const script = cborToScript(validator.compiledCode, "PlutusV3");
    console.log(`📝 Deploying ${config.name} with hash: ${script.hash()}`);
    const scriptSize = validator.compiledCode.length / 2;

    console.log(
      `📦 Deploying ${config.name} (${(scriptSize / 1024).toFixed(1)}KB)`
    );

    const unsignedTx = await blaze
      .newTransaction()
      .deployScript(script)
      .complete();

    return NextResponse.json({
      unsignedTx: unsignedTx.toCbor(),
      script: {
        name: config.name,
        scriptHash: script.hash(),
        size: scriptSize,
        title: config.title,
      },
      scriptIndex,
      totalScripts: scriptConfigs.length,
      isLast: scriptIndex === scriptConfigs.length - 1,
      network,
    });
  } catch (error) {
    console.error("❌ Script deployment failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to deploy script",
      },
      { status: 500 }
    );
  }
}
