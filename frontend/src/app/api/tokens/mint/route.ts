import { NextRequest, NextResponse } from "next/server";
import {
  MeshTxBuilder,
  stringToHex,
  resolveScriptHash,
  metadataToCip68,
  mConStr0,
} from "@meshsdk/core";
import { createTokenMintingScript } from "@/lib/token-minting-script";
import { CIP68_LABELS, fromHex, generateCip67Label } from "@/lib/cip67-labels";
import {
  Cip68FungibleMetadata,
  createFungibleDatum,
  metadataToPlutusCbor,
} from "@/lib/cip68-metadata";
import { maestroProvider } from "@/lib/server/maestro";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import plutusJson from "@/lib/scripts/plutus.json";
import { applyParamsToScript, cborToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";

interface TokenFormData {
  name: string;
  symbol: string;
  description: string;
  supply: number;
  decimals: number;
  ticker: string;
  url: string;
  logo: string;
  mintingPeriodDays: number;
}

interface MintTokenRequest {
  formData: TokenFormData;
  walletAddress: string;
  utxos: any[];
  collateral: any[];
  changeAddress: string;
  wallet: any;
}
export async function POST(request: NextRequest) {
  try {
    const {
      formData,
      walletAddress,
      collateral,
      changeAddress,
    }: MintTokenRequest = await request.json();

    if (!collateral?.length) {
      throw new Error("No collateral available");
    }

    // Create token name
    const tokenName = formData.symbol;
    const tokenNameHex = stringToHex(tokenName);

    // Create auth token name (add this)
    const authTokenName = stringToHex("AUTH_" + formData.symbol);

    // Create CIP-68 metadata
    const fungibleMetadata: Cip68FungibleMetadata = {
      name: formData.name,
      description: formData.description,
      ticker: formData.ticker,
      decimals: formData.decimals,
      ...(formData.url && { url: formData.url }),
      ...(formData.logo && { logo: formData.logo }),
    };

    const referenceAssetName =
      generateCip67Label(CIP68_LABELS.REFERENCE_NFT) + tokenNameHex; // 100
    const fungibleAssetName =
      generateCip67Label(CIP68_LABELS.FUNGIBLE_TOKEN) + tokenNameHex; // 333

    const receiveAddress = Core.addressFromBech32(changeAddress);
    const sendAddress = Core.addressFromBech32(walletAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);
    const address = Core.addressFromBech32(walletAddress);
    const utxos = await blazeMaestroProvider.getUnspentOutputs(address);
    const firstUtxo = utxos[0];

    const authTokenValidator = plutusJson.validators.find(
      (v) => v.title === "auth_token_policy.auth_token_policy.mint"
    );
    const tokenMintingValidator = plutusJson.validators.find(
      (v) => v.title === "token_minting_policy.token_minting_policy.mint"
    );

    if (!authTokenValidator || !tokenMintingValidator) {
      throw new Error("Validators not found in plutus.json");
    }

    // For auth token policy (expects OutputReference parameter)
    const parameterizedAuthTokenScript = (applyParamsToScript as any)(
      authTokenValidator.compiledCode,
      Type.Tuple([
        Type.Object(
          {
            transaction_id: Type.String(),
            output_index: Type.BigInt(),
          },
          { ctor: 0n }
        ),
      ]),
      [
        {
          transaction_id: firstUtxo.input().transactionId(),
          output_index: BigInt(firstUtxo.input().index()),
        },
      ]
    );

    const authTokenScript = cborToScript(
      parameterizedAuthTokenScript,
      "PlutusV3"
    );
    const authPolicyId = authTokenScript.hash();

    // For token minting policy (expects PolicyId and AssetName parameters)
    const parameterizedTokenScript = (applyParamsToScript as any)(
      tokenMintingValidator.compiledCode,
      Type.Tuple([
        Type.String(), // PolicyId as hex string
        Type.String(), // AssetName as hex string
      ]),
      [authPolicyId, authTokenName]
    );

    const tokenScript = cborToScript(parameterizedTokenScript, "PlutusV3");

    // Get the base script
    const baseScriptHex = tokenMintingValidator.compiledCode;

    // Create the parameterized script
    const plutusV3Script = new Core.PlutusV3Script(Core.HexBlob(baseScriptHex));
    const script = Core.Script.newPlutusV3Script(plutusV3Script);

    const cip68Datum = createFungibleDatum(fungibleMetadata);

    const plutusMap = new Core.PlutusMap();
    Object.entries(cip68Datum.metadata).forEach(([key, value]) => {
      const keyData = Core.PlutusData.newBytes(new TextEncoder().encode(key));

      let valueData;
      if (typeof value === "string") {
        valueData = Core.PlutusData.newBytes(new TextEncoder().encode(value));
      } else if (typeof value === "number") {
        valueData = Core.PlutusData.newInteger(BigInt(value));
      } else if (Array.isArray(value)) {
        valueData = Core.PlutusData.newBytes(
          new TextEncoder().encode(JSON.stringify(value))
        );
      }

      plutusMap.insert(keyData, valueData!);
    });

    // Build the constructor fields list
    const fieldsList = new Core.PlutusList();
    fieldsList.add(Core.PlutusData.newMap(plutusMap)); // metadata map
    fieldsList.add(Core.PlutusData.newInteger(BigInt(cip68Datum.version))); // version
    fieldsList.add(Core.PlutusData.newBytes(new Uint8Array(0))); // null/empty for extra

    // Create the constructor
    const constrData = new Core.ConstrPlutusData(0n, fieldsList); // Constructor 0
    const datumCore = Core.PlutusData.newConstrPlutusData(constrData);

    console.log(Object.getOwnPropertyNames(Core.PlutusData));

    const blazePolicyId = script.hash();

    const mintMap: Map<Core.AssetName, bigint> = new Map();
    // Mint auth token
    mintMap.set(Core.AssetName(authTokenName), 1n);

    const authMintMap: Map<Core.AssetName, bigint> = new Map();
    authMintMap.set(Core.AssetName(authTokenName), 1n);

    const tokenMintMap: Map<Core.AssetName, bigint> = new Map();
    tokenMintMap.set(Core.AssetName(referenceAssetName), 1n);
    tokenMintMap.set(
      Core.AssetName(fungibleAssetName),
      BigInt(formData.supply)
    );

    // Create redeemers
    const authRedeemer = Core.PlutusData.newBytes(new Uint8Array(0)); // Empty for one-shot

    const tokenRedeemer = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(0n, new Core.PlutusList())
    );

    const tokenPolicyId = tokenScript.hash();

    const referenceNftValue = Core.Value.fromCore({
      coins: 0n, // Let Blaze calculate minimum ADA
      assets: new Map([
        [
          Core.AssetId.fromParts(
            Core.PolicyId(tokenPolicyId),
            Core.AssetName(referenceAssetName)
          ),
          1n,
        ],
      ]),
    });

    const fungibleAndAuthValue = Core.Value.fromCore({
      coins: 0n, // Let Blaze calculate minimum ADA
      assets: new Map([
        [
          Core.AssetId.fromParts(
            Core.PolicyId(tokenPolicyId),
            Core.AssetName(fungibleAssetName)
          ),
          BigInt(formData.supply),
        ],
        [
          Core.AssetId.fromParts(
            Core.PolicyId(authPolicyId),
            Core.AssetName(authTokenName)
          ),
          1n,
        ],
      ]),
    });

    // Build transaction with proper UTxO handling
    const tx = await blaze
      .newTransaction()
      .addInput(firstUtxo)
      .provideScript(authTokenScript)
      .provideScript(tokenScript)
      .addMint(Core.PolicyId(authPolicyId), authMintMap, authRedeemer)
      .addMint(Core.PolicyId(tokenPolicyId), tokenMintMap, tokenRedeemer)
      .payAssets(receiveAddress, referenceNftValue, datumCore) // Reference NFT with metadata
      .payAssets(receiveAddress, fungibleAndAuthValue) // Fungible tokens + auth token
      .complete();

    console.log("✓ Transaction built successfully with CIP-68 datum");

    return NextResponse.json({
      unsignedTx: tx.toCbor(),
      tokenInfo: {
        policyId: blazePolicyId,
        referenceAssetName,
        fungibleAssetName,
        metadata: fungibleMetadata,
        // datum: cip68Datum,
      },
    });
  } catch (error) {
    console.error("❌ Server-side minting error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build transaction",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
