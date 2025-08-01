import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core, Provider, Wallet } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  fetchDAOInfo,
  findDeployedScriptUtxoViaMaestro,
  getVoteScriptHashFromDAO,
} from "@/lib/server/helpers/dao-helpers";
import {
  addressFromScript,
  createParameterizedScript,
  getCurrentSlot,
} from "@/lib/server/helpers/script-helpers";

interface RegisterRequest {
  daoPolicyId: string;
  daoKey: string;
  governanceTokenAmount: number;
  walletAddress: string;
  collateral: any[];
  changeAddress: string;
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

    console.log(collateral);

    if (!collateral?.length) {
      throw new Error("No collateral available, please set it in your wallet");
    }

    if (governanceTokenAmount <= 0) {
      throw new Error("Governance token amount must be greater than 0");
    }

    console.debug(`📝 Registering for DAO: ${daoPolicyId}`);

    const sendAddress = Core.addressFromBech32(walletAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    // Get DAO info
    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    console.debug(`✅ Found DAO: ${daoInfo.name}`);

    // Get vote script reference
    const voteScriptHash = getVoteScriptHashFromDAO(daoPolicyId, daoKey);
    const voteScriptRef = await findDeployedScriptUtxoViaMaestro(
      voteScriptHash
    );

    if (!voteScriptRef) {
      throw new Error("Vote script reference not found");
    }

    console.debug(
      `✅ Found vote script at: ${voteScriptRef.txHash}#${voteScriptRef.outputIndex}`
    );

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

    // Get user's UTXOs and analyze them
    const userUtxos = await blazeMaestroProvider.getUnspentOutputs(sendAddress);
    if (!userUtxos?.length) {
      throw new Error("No UTXOs found in wallet");
    }

    const { governanceUtxos, totalAvailable, seedUtxo } =
      await analyzeUserUTxOs(
        userUtxos,
        govPolicyId,
        govAssetName
        // BigInt(governanceTokenAmount)
      );

    if (totalAvailable < BigInt(governanceTokenAmount)) {
      throw new Error(
        `Insufficient governance tokens. Required: ${governanceTokenAmount}, available: ${totalAvailable}`
      );
    }

    // Create vote script reference input
    const voteScriptRefInput = new Core.TransactionInput(
      Core.TransactionId(voteScriptRef.txHash),
      BigInt(voteScriptRef.outputIndex)
    );

    const resolvedVoteRefUtxo =
      await blazeMaestroProvider.resolveUnspentOutputs([voteScriptRefInput]);

    // Build and execute transaction
    const tx = await buildRegistrationTransaction(blaze, {
      seedUtxo,
      governanceUtxos,
      daoUtxo: daoInfo.utxo,
      voteScriptRefUtxo: resolvedVoteRefUtxo[0],
      voteScriptHash,
      daoPolicyId,
      daoKey,
      govPolicyId,
      govAssetName,
      governanceTokenAmount: BigInt(governanceTokenAmount),
      receiveAddress: Core.addressFromBech32(changeAddress),
    });

    return NextResponse.json({
      unsignedTx: tx.toCbor(),
      voteScriptHash,
      governanceTokensLocked: governanceTokenAmount,
    });
  } catch (error) {
    console.error("❌ Registration error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Registration failed",
      },
      { status: 500 }
    );
  }
}

async function buildRegistrationTransaction(
  blaze: Blaze<Provider, Wallet>,
  params: {
    seedUtxo: Core.TransactionUnspentOutput;
    governanceUtxos: GovernanceTokenUTxO[];
    daoUtxo: Core.TransactionUnspentOutput;
    voteScriptRefUtxo: Core.TransactionUnspentOutput;
    voteScriptHash: string;
    daoPolicyId: string;
    daoKey: string;
    govPolicyId: string;
    govAssetName: string;
    governanceTokenAmount: bigint;
    receiveAddress: Core.Address;
  }
): Promise<Core.Transaction> {
  const {
    seedUtxo,

    governanceUtxos,
    daoUtxo,
    voteScriptRefUtxo,
    voteScriptHash,
    daoPolicyId,
    daoKey,
    govPolicyId,
    govAssetName,
    governanceTokenAmount,
    receiveAddress,
  } = params;

  console.debug(
    "🔨 Building registration transaction with reference scripts..."
  );

  // Create unique vote identifier from seed UTXO
  const uniqueName = createUniqueVoteIdentifier(seedUtxo);
  const referenceAssetName = "0000" + uniqueName;
  const voteNftAssetName = "0001" + uniqueName;

  console.debug(`🎫 Vote NFT: ${voteNftAssetName}`);
  console.debug(`📋 Reference Asset: ${referenceAssetName}`);

  // Create vote datum (CIP-68 metadata structure)
  const voteDatum = createVoteDatum();

  // Create vote creation redeemer
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

  // Create mint map for CIP-68 tokens
  const mintMap: Map<Core.AssetName, bigint> = new Map();
  mintMap.set(Core.AssetName(referenceAssetName), 1n);
  mintMap.set(Core.AssetName(voteNftAssetName), 1n);

  // Get vote script address for the reference NFT
  const voteScript = createParameterizedScript("vote.vote.spend", [
    daoPolicyId,
    daoKey,
  ]);
  const voteScriptAddress = addressFromScript(voteScript);

  // Create vote UTXO value (reference NFT + governance tokens)
  const voteValue = Core.Value.fromCore({
    coins: 0n, // Blaze will calculate minimum ADA
    assets: new Map([
      [
        Core.AssetId.fromParts(
          Core.PolicyId(voteScriptHash),
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

  // Create user NFT value (what goes back to user's wallet)
  const userNftValue = Core.Value.fromCore({
    coins: 0n,
    assets: new Map([
      [
        Core.AssetId.fromParts(
          Core.PolicyId(voteScriptHash),
          Core.AssetName(voteNftAssetName)
        ),
        1n,
      ],
    ]),
  });

  console.debug("🎯 Transaction structure:");
  console.debug("  Inputs: seed UTXO + governance token UTXOs");
  console.debug("  Reference inputs: DAO UTXO + vote script reference");
  console.debug("  Outputs: vote UTXO (at script) + user NFT (back to wallet)");
  console.debug(
    `  Minting: ${voteScriptHash}.${referenceAssetName} + ${voteScriptHash}.${voteNftAssetName}`
  );

  // const collateralInputs = params.collateral.map(
  //   (col: any) =>
  //     new Core.TransactionInput(
  //       Core.TransactionId(col.input.txHash),
  //       BigInt(col.input.outputIndex)
  //     )
  // );

  // const collateralUtxos = await blazeMaestroProvider.resolveUnspentOutputs(
  //   collateralInputs
  // );

  // Build transaction
  let txBuilder = blaze
    .newTransaction()
    // .provideCollateral(collateralUtxos)
    .addInput(seedUtxo)
    .addReferenceInput(daoUtxo) // DAO reference for validation
    .addReferenceInput(voteScriptRefUtxo) // Vote script reference
    .addMint(Core.PolicyId(voteScriptHash), mintMap, voteRedeemer)
    .lockAssets(voteScriptAddress, voteValue, voteDatum)
    .payAssets(receiveAddress, userNftValue);

  // Add governance token inputs (selecting just enough)
  let remainingNeeded = governanceTokenAmount;
  const usedGovUtxos: GovernanceTokenUTxO[] = [];

  for (const govUtxo of governanceUtxos) {
    if (remainingNeeded <= 0n) break;

    txBuilder = txBuilder.addInput(govUtxo.utxo);
    usedGovUtxos.push(govUtxo);
    remainingNeeded -= govUtxo.amount;

    console.debug(`  Adding gov token UTXO: ${govUtxo.amount} tokens`);
  }

  // If we have excess governance tokens, send them back
  const totalGovTokensUsed = usedGovUtxos.reduce(
    (sum, utxo) => sum + utxo.amount,
    0n
  );
  const excessGovTokens = totalGovTokensUsed - governanceTokenAmount;

  if (excessGovTokens > 0n) {
    console.debug(
      `  Returning ${excessGovTokens} excess governance tokens to wallet`
    );

    const excessValue = Core.Value.fromCore({
      coins: 0n,
      assets: new Map([
        [
          Core.AssetId.fromParts(
            Core.PolicyId(govPolicyId),
            Core.AssetName(govAssetName)
          ),
          excessGovTokens,
        ],
      ]),
    });

    txBuilder = txBuilder.payAssets(receiveAddress, excessValue);
  }

  const currentSlot = getCurrentSlot();
  const validityStart = Core.Slot(Number(currentSlot));
  const validityEnd = Core.Slot(Number(currentSlot) + 3600);

  console.debug("✅ Completing registration transaction...");

  return txBuilder
    .setValidFrom(validityStart)
    .setValidUntil(validityEnd)
    .setFeePadding(100_000n) // Add 0.1 ADA padding for reference script complexity
    .complete();
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
  return Core.blake2b_256(outputRefCbor).slice(0, 56); // First 28 bytes as hex (56 chars)
}

function createVoteDatum(): Core.PlutusData {
  const fieldsList = new Core.PlutusList();

  // metadata: empty map for CIP-68
  const metadataMap = new Core.PlutusMap();
  fieldsList.add(Core.PlutusData.newMap(metadataMap));

  // version: 1 (CIP-68 standard)
  fieldsList.add(Core.PlutusData.newInteger(1n));

  // extra: empty bytes (no extra data)
  fieldsList.add(Core.PlutusData.newBytes(new Uint8Array(0)));

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, fieldsList)
  );
}

// Add these interfaces if not already present
interface GovernanceTokenUTxO {
  utxo: Core.TransactionUnspentOutput;
  amount: bigint;
}

async function analyzeUserUTxOs(
  utxos: Core.TransactionUnspentOutput[],
  govPolicyId: string,
  govAssetName: string
  // requiredAmount: bigint
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
