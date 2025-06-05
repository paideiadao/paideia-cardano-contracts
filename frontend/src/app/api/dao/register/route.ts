import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core, Provider, Wallet } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript, applyParamsToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";
import plutusJson from "@/lib/scripts/plutus.json";
import { fetchDAOInfo, parseDAODatum } from "@/lib/server/helpers/dao-helpers";
import {
  addressFromScript,
  getNetworkId,
} from "@/lib/server/helpers/script-helpers";
import { createVoteScript } from "@/lib/server/helpers/vote-helpers";

interface RegisterRequest {
  daoPolicyId: string;
  daoKey: string;
  governanceTokenAmount: number;
  walletAddress: string;
  collateral: any[];
  changeAddress: string;
}

interface DAOInfo {
  governance_token: string;
  min_gov_proposal_create: number;
  name: string;
}

interface GovernanceTokenUTxO {
  utxo: Core.TransactionUnspentOutput;
  amount: bigint;
}

export async function POST(request: NextRequest) {
  try {
    const {
      daoPolicyId,
      daoKey,
      governanceTokenAmount,
      walletAddress,
      collateral,
      changeAddress,
    }: RegisterRequest = await request.json();

    if (!collateral?.length) {
      throw new Error("No collateral available, please set it in your wallet");
    }

    if (governanceTokenAmount <= 0) {
      throw new Error("Governance token amount must be greater than 0");
    }

    console.debug(`📝 Registering for DAO: ${daoPolicyId}`);
    console.debug(`🪙 Amount requested: ${governanceTokenAmount}`);

    const sendAddress = Core.addressFromBech32(walletAddress);
    const receiveAddress = Core.addressFromBech32(changeAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    // Get DAO info and validate it exists
    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    console.debug(`✅ Found DAO: ${daoInfo.name}`);

    // Extract governance token details
    const govTokenHex = daoInfo.governance_token;
    const govPolicyId = govTokenHex.slice(0, 56);
    const govAssetName = govTokenHex.slice(56);

    // Validate minimum amount
    if (governanceTokenAmount < daoInfo.min_gov_proposal_create) {
      throw new Error(
        `Amount too low. Minimum required: ${daoInfo.min_gov_proposal_create}, requested: ${governanceTokenAmount}`
      );
    }

    // Get user's UTXOs and find governance tokens
    const userUtxos = await blazeMaestroProvider.getUnspentOutputs(sendAddress);
    if (!userUtxos?.length) {
      throw new Error(
        "No UTXOs found in wallet. Please add some ADA to your wallet first."
      );
    }

    const { governanceUtxos, totalAvailable, seedUtxo } =
      await analyzeUserUTxOs(
        userUtxos,
        govPolicyId,
        govAssetName,
        BigInt(governanceTokenAmount)
      );

    if (totalAvailable < BigInt(governanceTokenAmount)) {
      throw new Error(
        `Insufficient governance tokens. Required: ${governanceTokenAmount}, available: ${totalAvailable}`
      );
    }

    console.debug(
      `✅ Found ${totalAvailable} governance tokens across ${governanceUtxos.length} UTXOs`
    );

    // Create vote script
    const voteScript = await createVoteScript(daoPolicyId, daoKey);
    const votePolicyId = voteScript.hash();

    // Create unique vote identifier
    const uniqueName = createUniqueVoteIdentifier(seedUtxo);
    const referenceAssetName = "0000" + uniqueName;
    const voteNftAssetName = "0001" + uniqueName;

    console.log("🔍 UNIQUE NAME DEBUG:");
    console.log("Unique name:", uniqueName);
    console.log("Unique name length:", uniqueName.length);
    console.log("Expected length: 56");

    console.debug(`🔑 Vote Policy ID: ${votePolicyId}`);
    console.debug(`🎫 Vote NFT: ${voteNftAssetName}`);

    // Create transaction
    const tx = await buildRegistrationTransaction(blaze, {
      seedUtxo,
      governanceUtxos,
      daoUtxo: daoInfo.utxo,
      voteScript,
      votePolicyId,
      referenceAssetName,
      voteNftAssetName,
      govPolicyId,
      govAssetName,
      governanceTokenAmount: BigInt(governanceTokenAmount),
      receiveAddress,
      walletAddress,
    });

    console.debug("✅ Registration transaction built successfully");

    return NextResponse.json({
      unsignedTx: tx.toCbor(),
      votePolicyId,
      voteNftAssetName,
      referenceAssetName,
      governanceTokensLocked: governanceTokenAmount,
      governanceTokensUsed: governanceUtxos.length,
    });
  } catch (error) {
    console.error("❌ Server-side registration error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build registration transaction",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

async function analyzeUserUTxOs(
  utxos: Core.TransactionUnspentOutput[],
  govPolicyId: string,
  govAssetName: string,
  requiredAmount: bigint
): Promise<{
  governanceUtxos: GovernanceTokenUTxO[];
  totalAvailable: bigint;
  seedUtxo: Core.TransactionUnspentOutput;
}> {
  const governanceUtxos: GovernanceTokenUTxO[] = [];
  let totalAvailable = 0n;
  let seedUtxo: Core.TransactionUnspentOutput | null = null;

  // Find the largest ADA-only UTXO for seed
  let largestAdaUtxo: Core.TransactionUnspentOutput | null = null;
  let largestAdaAmount = 0n;

  for (const utxo of utxos) {
    const value = utxo.output().amount().toCore();

    // Check for governance tokens
    if (value.assets) {
      for (const [assetId, quantity] of value.assets) {
        const policyId = Core.AssetId.getPolicyId(assetId);
        const assetNameFromId = Core.AssetId.getAssetName(assetId);

        if (policyId === govPolicyId && assetNameFromId === govAssetName) {
          governanceUtxos.push({ utxo, amount: quantity });
          totalAvailable += quantity;
        }
      }
    }

    // Track largest ADA-only UTXO for seed
    if (!value.assets || value.assets.size === 0) {
      if (value.coins > largestAdaAmount) {
        largestAdaAmount = value.coins;
        largestAdaUtxo = utxo;
      }
    }
  }

  // Use largest ADA UTXO as seed, or first governance UTXO if no ADA-only exists
  seedUtxo = largestAdaUtxo ?? governanceUtxos[0]?.utxo ?? utxos[0];

  if (!seedUtxo) {
    throw new Error("No suitable UTXOs found in wallet");
  }

  // Sort governance UTXOs by amount (largest first) for efficient selection
  governanceUtxos.sort((a, b) => (a.amount > b.amount ? -1 : 1));

  return { governanceUtxos, totalAvailable, seedUtxo };
}

function createUniqueVoteIdentifier(
  seedUtxo: Core.TransactionUnspentOutput
): string {
  const outputRefData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(
          Core.PlutusData.newBytes(
            Core.fromHex(seedUtxo.input().transactionId())
          )
        );
        list.add(Core.PlutusData.newInteger(BigInt(seedUtxo.input().index())));
        return list;
      })()
    )
  );

  const outputRefCbor = outputRefData.toCbor();
  return Core.blake2b_256(outputRefCbor).slice(0, 56); // First 28 bytes
}

async function buildRegistrationTransaction(
  blaze: Blaze<Provider, Wallet>,
  params: {
    seedUtxo: Core.TransactionUnspentOutput;
    governanceUtxos: GovernanceTokenUTxO[];
    daoUtxo: Core.TransactionUnspentOutput;
    voteScript: Core.Script;
    votePolicyId: string;
    referenceAssetName: string;
    voteNftAssetName: string;
    govPolicyId: string;
    govAssetName: string;
    governanceTokenAmount: bigint;
    receiveAddress: Core.Address;
    walletAddress: string;
  }
): Promise<Core.Transaction> {
  const {
    seedUtxo,
    governanceUtxos,
    daoUtxo,
    voteScript,
    votePolicyId,
    referenceAssetName,
    voteNftAssetName,
    govPolicyId,
    govAssetName,
    governanceTokenAmount,
    receiveAddress,
    walletAddress,
  } = params;

  // Create vote datum
  const voteDatum = createVoteDatum();

  // Create redeemer
  const outputRefData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(
          Core.PlutusData.newBytes(
            Core.fromHex(seedUtxo.input().transactionId())
          )
        );
        list.add(Core.PlutusData.newInteger(BigInt(seedUtxo.input().index())));
        return list;
      })()
    )
  );

  const voteRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(outputRefData);
        return list;
      })()
    )
  );

  // Create mint map
  const mintMap: Map<Core.AssetName, bigint> = new Map();
  mintMap.set(Core.AssetName(referenceAssetName), 1n);
  mintMap.set(Core.AssetName(voteNftAssetName), 1n);

  // Vote script address
  const voteScriptAddress = addressFromScript(voteScript);

  // Vote UTXO value (reference NFT + governance tokens)
  const voteValue = Core.Value.fromCore({
    coins: 0n,
    assets: new Map([
      [
        Core.AssetId.fromParts(
          Core.PolicyId(votePolicyId),
          Core.AssetName(referenceAssetName)
        ),
        1n,
      ],
      [
        Core.AssetId.fromParts(
          Core.PolicyId(govPolicyId),
          Core.AssetName(govAssetName)
        ),
        governanceTokenAmount,
      ],
    ]),
  });

  // User NFT value
  const userNftValue = Core.Value.fromCore({
    coins: 0n,
    assets: new Map([
      [
        Core.AssetId.fromParts(
          Core.PolicyId(votePolicyId),
          Core.AssetName(voteNftAssetName)
        ),
        1n,
      ],
    ]),
  });

  // Build transaction
  let txBuilder = blaze
    .newTransaction()
    .addInput(seedUtxo)
    .addReferenceInput(daoUtxo)
    .provideScript(voteScript);

  // Add governance token inputs (selecting just enough)
  let remainingNeeded = governanceTokenAmount;
  for (const govUtxo of governanceUtxos) {
    if (remainingNeeded <= 0n) break;

    txBuilder = txBuilder.addInput(govUtxo.utxo);
    remainingNeeded -= govUtxo.amount;
  }

  return txBuilder
    .addMint(Core.PolicyId(votePolicyId), mintMap, voteRedeemer)
    .lockAssets(voteScriptAddress, voteValue, voteDatum)
    .payAssets(receiveAddress, userNftValue)
    .complete();
}

function createVoteDatum(): Core.PlutusData {
  const fieldsList = new Core.PlutusList();

  // metadata: empty map
  const metadataMap = new Core.PlutusMap();
  fieldsList.add(Core.PlutusData.newMap(metadataMap));

  // version: 1
  fieldsList.add(Core.PlutusData.newInteger(1n));

  // extra: None (empty bytes)
  fieldsList.add(Core.PlutusData.newBytes(new Uint8Array(0)));

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, fieldsList)
  );
}
