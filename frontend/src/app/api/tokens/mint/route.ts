import { NextRequest, NextResponse } from "next/server";
import { stringToHex } from "@meshsdk/core";
import { CIP68_LABELS, generateCip67Label } from "@/lib/cip67-labels";
import {
  Cip68FungibleMetadata,
  Cip68NftMetadata,
  createFungibleDatum,
  createNftDatum,
} from "@/lib/cip68-metadata";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import plutusJson from "@/lib/scripts/plutus.json";
import { applyParamsToScript, cborToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";
import { TokenFormData } from "@/components/forms/token-mint-form";

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

    // Validate collateral availability, and throw a good error if not
    if (!collateral?.length) {
      throw new Error("No collateral available, please set it in your wallet");
    }

    console.debug(`📝 Minting token: ${formData.name} (${formData.symbol})`);
    console.debug(
      `💰 Supply: ${formData.supply}, Decimals: ${formData.decimals}`
    );

    // Create token name and auth token name
    const tokenName = formData.symbol;
    const tokenNameHex = stringToHex(tokenName);
    const authTokenNameHex = stringToHex("AUTH_" + formData.symbol);

    console.debug(`🏷️  Token name hex: ${tokenNameHex}`);
    console.debug(`🔐 Auth token name hex: ${authTokenNameHex}`);

    // Create CIP-68 metadata
    const fungibleMetadata: Cip68FungibleMetadata = {
      name: formData.name,
      description: formData.description,
      ticker: formData.symbol,
      decimals: formData.decimals,
      ...(formData.url && { url: formData.url }),
      ...(formData.logo && { logo: formData.logo }),
    };
    const authNftMetadata: Cip68NftMetadata = {
      name: `${formData.name} Minting Authority`,
      image: formData.logo ?? "", // Use logo as image for auth NFT
      description: `Minting authority token for ${formData.name} (${formData.symbol})`,
    };

    // Generate CIP-68 asset names
    const referenceAssetName =
      generateCip67Label(CIP68_LABELS.REFERENCE_NFT) + tokenNameHex; // 100
    const fungibleAssetName =
      generateCip67Label(CIP68_LABELS.FUNGIBLE_TOKEN) + tokenNameHex; // 333
    const authTokenAssetName =
      generateCip67Label(CIP68_LABELS.NFT) + authTokenNameHex; // 222

    console.debug(`📋 Reference asset name: ${referenceAssetName}`);
    console.debug(`🪙 Fungible asset name: ${fungibleAssetName}`);
    console.debug(`📝 Auth NFT asset name: ${authTokenAssetName}`);

    // Setup addresses and wallet
    const receiveAddress = Core.addressFromBech32(changeAddress);
    const sendAddress = Core.addressFromBech32(walletAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    // Get UTXOs from wallet
    const utxos = await blazeMaestroProvider.getUnspentOutputs(sendAddress);

    if (!utxos?.length) {
      throw new Error(
        "No UTXOs found in wallet. Please add some ADA to your wallet first - you need ADA to pay transaction fees and meet minimum UTxO requirements for minting."
      );
    }

    const firstUtxo = utxos[0];
    console.debug(
      `📦 Using UTxO: ${firstUtxo.input().transactionId()}#${firstUtxo
        .input()
        .index()}`
    );

    // Load validators from plutus.json
    const authTokenValidator = plutusJson.validators.find(
      (v) => v.title === "auth_token_policy.auth_token_policy.mint"
    );
    const tokenMintingValidator = plutusJson.validators.find(
      (v) => v.title === "token_minting_policy.token_minting_policy.mint"
    );

    if (!authTokenValidator || !tokenMintingValidator) {
      throw new Error(
        "Validators not found in plutus.json, please contact support."
      );
    }

    console.debug("🔧 Parameterizing auth token script");

    // Parameterize auth token policy with OutputReference
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

    console.debug(`🔑 Auth policy ID: ${authPolicyId}`);
    console.debug("🔧 Parameterizing token minting script");

    // For token minting policy (expects PolicyId and AssetName parameters)
    const parameterizedTokenScript = (applyParamsToScript as any)(
      tokenMintingValidator.compiledCode,
      Type.Tuple([
        Type.String(), // PolicyId as hex string
        Type.String(), // AssetName as hex string
      ]),
      [authPolicyId, authTokenAssetName]
    );

    const tokenScript = cborToScript(parameterizedTokenScript, "PlutusV3");

    console.debug("📋 Creating CIP-68 datum");
    // Create CIP-68 datum
    // const cip68Datum = createFungibleDatum(fungibleMetadata);

    // const plutusMap = new Core.PlutusMap();
    // Object.entries(cip68Datum.metadata).forEach(([key, value]) => {
    //   console.log(
    //     `📝 Adding metadata field: ${key} = ${value} (type: ${typeof value})`
    //   );
    //   const keyData = Core.PlutusData.newBytes(new TextEncoder().encode(key));

    //   let valueData;
    //   if (typeof value === "string") {
    //     valueData = Core.PlutusData.newBytes(new TextEncoder().encode(value));
    //   } else if (typeof value === "number") {
    //     valueData = Core.PlutusData.newInteger(BigInt(value));
    //   } else if (Array.isArray(value)) {
    //     valueData = Core.PlutusData.newBytes(
    //       new TextEncoder().encode(JSON.stringify(value))
    //     );
    //   }

    //   plutusMap.insert(keyData, valueData!);
    // });

    // // Build the constructor fields list
    // const fieldsList = new Core.PlutusList();
    // fieldsList.add(Core.PlutusData.newMap(plutusMap)); // metadata map
    // fieldsList.add(Core.PlutusData.newInteger(BigInt(cip68Datum.version))); // version
    // fieldsList.add(Core.PlutusData.newBytes(new Uint8Array(0))); // null/empty for extra

    // // Create the constructor
    // const constrData = new Core.ConstrPlutusData(0n, fieldsList); // Constructor 0
    // const datumCore = Core.PlutusData.newConstrPlutusData(constrData);

    const fungibleDatum = createCip68Datum(fungibleMetadata);
    const authNftDatum = createCip68NftDatum(authNftMetadata);

    // Create mint maps
    const authMintMap: Map<Core.AssetName, bigint> = new Map();
    authMintMap.set(Core.AssetName(authTokenAssetName), 1n);

    const tokenMintMap: Map<Core.AssetName, bigint> = new Map();
    tokenMintMap.set(Core.AssetName(referenceAssetName), 1n);
    tokenMintMap.set(
      Core.AssetName(fungibleAssetName),
      BigInt(formData.supply)
    );

    console.debug("🎭 Creating redeemers");

    // Create redeemers
    const authRedeemer = Core.PlutusData.newBytes(new Uint8Array(0)); // Empty for one-shot

    const tokenRedeemer = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(0n, new Core.PlutusList())
    );

    const tokenPolicyId = tokenScript.hash();

    console.debug(`🪙 Token policy ID: ${tokenPolicyId}`);

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

    const authNftValue = Core.Value.fromCore({
      coins: 0n,
      assets: new Map([
        [
          Core.AssetId.fromParts(
            Core.PolicyId(authPolicyId),
            Core.AssetName(authTokenAssetName)
          ),
          1n,
        ],
      ]),
    });

    const fungibleValue = Core.Value.fromCore({
      coins: 0n,
      assets: new Map([
        [
          Core.AssetId.fromParts(
            Core.PolicyId(tokenPolicyId),
            Core.AssetName(fungibleAssetName)
          ),
          BigInt(formData.supply),
        ],
      ]),
    });

    console.debug("🏗️  Building transaction");

    console.log("Token validator expecting auth_policy_id:", authPolicyId);
    console.log(
      "Token validator expecting auth_token_name:",
      authTokenAssetName
    );
    console.log("Actually minting with policy:", authPolicyId);
    console.log("Actually minting asset name:", authTokenAssetName);

    // Build transaction with proper UTxO handling
    const tx = await blaze
      .newTransaction()
      .addInput(firstUtxo)
      .provideScript(authTokenScript)
      .provideScript(tokenScript)
      .addMint(Core.PolicyId(authPolicyId), authMintMap, authRedeemer)
      .addMint(Core.PolicyId(tokenPolicyId), tokenMintMap, tokenRedeemer)
      .lockAssets(
        Core.getBurnAddress(walletAddress.startsWith("addr_test") ? 0 : 1),
        referenceNftValue,
        fungibleDatum
      ) // Reference NFT with metadata
      .payAssets(receiveAddress, authNftValue, authNftDatum) // Auth NFT to user
      .payAssets(receiveAddress, fungibleValue) // Fungible tokens to user
      .complete();

    console.debug("✅ Transaction built successfully with CIP-68 datum");

    return NextResponse.json({
      unsignedTx: tx.toCbor(),
      tokenInfo: {
        policyId: tokenPolicyId,
        referenceAssetName,
        fungibleAssetName,
        metadata: fungibleMetadata,
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

function createCip68Datum(metadata: Cip68FungibleMetadata) {
  console.debug("📋 Creating CIP-68 datum");

  const cip68Datum = createFungibleDatum(metadata);

  const plutusMap = new Core.PlutusMap();
  Object.entries(cip68Datum.metadata).forEach(([key, value]) => {
    console.log(
      `📝 Adding metadata field: ${key} = ${value} (type: ${typeof value})`
    );
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
  return Core.PlutusData.newConstrPlutusData(constrData);
}

function createCip68NftDatum(metadata: Cip68NftMetadata) {
  console.debug("📋 Creating CIP-68 NFT datum");

  const cip68Datum = createNftDatum(metadata);

  const plutusMap = new Core.PlutusMap();
  Object.entries(cip68Datum.metadata).forEach(([key, value]) => {
    console.log(
      `📝 Adding metadata field: ${key} = ${value} (type: ${typeof value})`
    );
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

  const fieldsList = new Core.PlutusList();
  fieldsList.add(Core.PlutusData.newMap(plutusMap));
  fieldsList.add(Core.PlutusData.newInteger(BigInt(cip68Datum.version)));
  fieldsList.add(Core.PlutusData.newBytes(new Uint8Array(0)));

  const constrData = new Core.ConstrPlutusData(0n, fieldsList);
  return Core.PlutusData.newConstrPlutusData(constrData);
}
