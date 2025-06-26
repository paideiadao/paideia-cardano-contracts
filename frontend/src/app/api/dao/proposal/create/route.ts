import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core, Provider, Wallet } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  fetchDAOInfo,
  findDeployedScriptUtxoViaMaestro,
  FullDAODatum,
  getVoteScriptHashFromDAO,
} from "@/lib/server/helpers/dao-helpers";
import {
  findUserVoteUtxo,
  getVoteUtxo,
} from "@/lib/server/helpers/vote-helpers";
import {
  addressFromScript,
  createParameterizedScript,
  getCurrentSlot,
  getScriptPolicyId,
} from "@/lib/server/helpers/script-helpers";
import {
  AssetId,
  Datum,
  Transaction,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import {
  validateProposalData,
  validateActionData,
  validateProposalTiming,
  validateActionTiming,
} from "./_helpers/validators";
import { findSuitableSeedUtxoAvoidingVoteNft } from "@/lib/server/helpers/utxo-helpers";

interface ProposalAsset {
  unit: string;
  quantity: string;
}

interface ProposalTarget {
  address: string;
  assets: ProposalAsset[];
}

export interface ProposalData {
  name: string;
  description: string;
  startTime: string;
  endTime: string;
}

export interface ActionData {
  name: string;
  description: string;
  activationTime: string;
  targets: ProposalTarget[];
}

interface CreateProposalRequest {
  daoPolicyId: string;
  daoKey: string;
  walletAddress: string;
  collateral: unknown[];
  changeAddress: string;
  proposal: ProposalData;
  action?: ActionData;
}

interface UserVoteInfo {
  utxo: {
    txHash: string;
    outputIndex: number;
  };
  lockedGovernanceTokens: number;
  voteNftAssetName: string;
  referenceAssetName: string;
}

export interface ExtendedDAOInfo extends FullDAODatum {
  policyId: string;
  key: string;
  utxo: Core.TransactionUnspentOutput;
}

interface SeedUTXOInfo {
  utxo: TransactionUnspentOutput;
  containsVoteNft: boolean;
  assets: {
    policyId: string;
    assetName: string;
    assetId: AssetId;
    quantity: bigint;
  }[];
}

interface BuildProposalParams {
  seedUtxo: Core.TransactionUnspentOutput;
  daoInfo: ExtendedDAOInfo;
  userVoteInfo: UserVoteInfo;
  proposal: ProposalData;
  action?: ActionData;
  votePolicyId: string;
  sendAddress: Core.Address;
  seedUtxoInfo: SeedUTXOInfo;
}

interface TokenGroup {
  name: string;
  amount: bigint;
}

type TransactionBuilder = ReturnType<Blaze<any, any>["newTransaction"]>;

export async function POST(request: NextRequest) {
  try {
    const {
      daoPolicyId,
      daoKey,
      walletAddress,
      collateral,
      changeAddress,
      proposal,
      action,
    }: CreateProposalRequest = await request.json();

    if (!collateral?.length) {
      throw new Error("No collateral available, please set it in your wallet");
    }

    console.debug(`📝 Creating proposal: ${proposal.name}`);

    validateProposalData(proposal);
    if (action) {
      validateActionData(action);
    }

    const sendAddress = Core.addressFromBech32(walletAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    console.debug(`✅ Found DAO: ${daoInfo.name}`);

    // Get script references from DAO whitelist
    const proposalScriptHash = daoInfo.whitelisted_proposals[0];
    if (!proposalScriptHash) {
      throw new Error("No proposal scripts whitelisted in DAO");
    }

    const proposalScriptRef = await findDeployedScriptUtxoViaMaestro(
      proposalScriptHash
    );
    if (!proposalScriptRef) {
      throw new Error("Proposal script reference not found");
    }

    let actionScriptRef = null;
    if (action) {
      const actionScriptHash = daoInfo.whitelisted_actions[0];
      if (!actionScriptHash) {
        throw new Error("No action scripts whitelisted in DAO");
      }

      actionScriptRef = await findDeployedScriptUtxoViaMaestro(
        actionScriptHash
      );
      if (!actionScriptRef) {
        throw new Error("Action script reference not found");
      }
    }

    // Get vote script reference for user validation
    const voteScriptHash = getVoteScriptHashFromDAO(daoPolicyId, daoKey);
    const voteScriptRef = await findDeployedScriptUtxoViaMaestro(
      voteScriptHash
    );
    if (!voteScriptRef) {
      throw new Error("Vote script reference not found");
    }

    const userVoteInfo = await findUserVoteUtxo(
      walletAddress,
      voteScriptHash,
      daoPolicyId,
      daoKey
    );

    if (!userVoteInfo) {
      throw new Error("You must be registered to vote to create proposals");
    }

    if (userVoteInfo.lockedGovernanceTokens < daoInfo.min_gov_proposal_create) {
      throw new Error(
        `Insufficient governance tokens. Required: ${daoInfo.min_gov_proposal_create}, you have: ${userVoteInfo.lockedGovernanceTokens}`
      );
    }

    await validateProposalTiming(proposal, daoInfo);
    if (action) {
      await validateActionTiming(action.activationTime, proposal);
    }

    const userUtxos = await blazeMaestroProvider.getUnspentOutputs(sendAddress);
    if (!userUtxos?.length) {
      throw new Error("No UTXOs found in wallet");
    }

    const seedUtxoInfo = findSuitableSeedUtxoAvoidingVoteNft(
      userUtxos,
      voteScriptHash,
      userVoteInfo.voteNftAssetName
    );
    const seedUtxo = seedUtxoInfo.utxo;

    let tx: Transaction | null = null;
    try {
      tx = await buildProposalTransactionWithRefs(blaze, {
        seedUtxo,
        daoInfo,
        userVoteInfo,
        proposal,
        action,
        proposalScriptRef,
        actionScriptRef,
        voteScriptRef,
        sendAddress,
        seedUtxoInfo,
      });
      console.log("✅ Transaction built successfully");
    } catch (buildError: any) {
      console.error("❌ Transaction building failed:", buildError);
      throw buildError;
    }

    const proposalIdentifier = getProposalIdentifier(seedUtxo);

    return NextResponse.json({
      unsignedTx: tx.toCbor(),
      proposalIdentifier,
      proposalName: proposal.name,
    });
  } catch (error) {
    console.error("❌ Server-side proposal creation error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build proposal transaction",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

async function buildProposalTransactionWithRefs(
  blaze: Blaze<Provider, Wallet>,
  params: {
    seedUtxo: Core.TransactionUnspentOutput;
    daoInfo: ExtendedDAOInfo;
    userVoteInfo: UserVoteInfo;
    proposal: ProposalData;
    action?: ActionData;
    proposalScriptRef: {
      txHash: string;
      outputIndex: number;
      scriptHash: string;
    };
    actionScriptRef?: {
      txHash: string;
      outputIndex: number;
      scriptHash: string;
    } | null;
    voteScriptRef: { txHash: string; outputIndex: number; scriptHash: string };
    sendAddress: Core.Address;
    seedUtxoInfo: SeedUTXOInfo;
  }
): Promise<Core.Transaction> {
  const {
    seedUtxo,
    daoInfo,
    userVoteInfo,
    proposal,
    action,
    proposalScriptRef,
    actionScriptRef,
    voteScriptRef,
    sendAddress,
    seedUtxoInfo,
  } = params;

  console.log("🔨 Building proposal transaction with reference scripts...");

  // Create reference inputs for scripts
  const referenceInputs = [
    new Core.TransactionInput(
      Core.TransactionId(proposalScriptRef.txHash),
      BigInt(proposalScriptRef.outputIndex)
    ),
    new Core.TransactionInput(
      Core.TransactionId(voteScriptRef.txHash),
      BigInt(voteScriptRef.outputIndex)
    ),
  ];

  if (action && actionScriptRef) {
    referenceInputs.push(
      new Core.TransactionInput(
        Core.TransactionId(actionScriptRef.txHash),
        BigInt(actionScriptRef.outputIndex)
      )
    );
  }

  const resolvedReferenceUtxos =
    await blazeMaestroProvider.resolveUnspentOutputs(referenceInputs);
  const [proposalRefUtxo, voteRefUtxo, actionRefUtxo] = resolvedReferenceUtxos;

  const proposalIdentifier = getProposalIdentifier(seedUtxo);
  const proposalDatum = await createProposalDatum(proposal, seedUtxo);

  // Get vote UTXO for reference
  const voteUtxo = await getVoteUtxo(
    daoInfo.policyId,
    daoInfo.key,
    userVoteInfo.utxo
  );
  if (!voteUtxo) {
    throw new Error("Vote UTXO not found or already spent");
  }

  // Create proposal script and value
  const proposalScript = createParameterizedScript("proposal.proposal.spend", [
    daoInfo.policyId,
    daoInfo.key,
    voteScriptRef.scriptHash, // Use the vote policy ID
  ]);
  const proposalScriptAddress = addressFromScript(proposalScript);

  const proposalMintMap: Map<Core.AssetName, bigint> = new Map();
  proposalMintMap.set(Core.AssetName(proposalIdentifier), 1n);

  const proposalValue = Core.Value.fromCore({
    coins: 0n,
    assets: new Map([
      [
        Core.AssetId.fromParts(
          Core.PolicyId(proposalScriptRef.scriptHash),
          Core.AssetName(proposalIdentifier)
        ),
        1n,
      ],
    ]),
  });

  // Create proposal redeemer
  const voteKeyHex = userVoteInfo.referenceAssetName.slice(4);
  const proposalRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(Core.PlutusData.newBytes(Core.fromHex(voteKeyHex)));
        return list;
      })()
    )
  );

  console.log("🔧 Building transaction...");
  let txBuilder = blaze
    .newTransaction()
    .addInput(seedUtxo)
    .addReferenceInput(daoInfo.utxo)
    .addReferenceInput(voteUtxo)
    .addReferenceInput(proposalRefUtxo) // Proposal script reference
    .addReferenceInput(voteRefUtxo) // Vote script reference
    .addMint(
      Core.PolicyId(proposalScriptRef.scriptHash),
      proposalMintMap,
      proposalRedeemer
    )
    .lockAssets(proposalScriptAddress, proposalValue, proposalDatum);

  // Handle Vote NFT return if needed
  if (seedUtxoInfo.containsVoteNft) {
    console.log("🎫 Seed UTXO contains Vote NFT - sending it back to user");
    const sendBackAssets = new Map<AssetId, bigint>();
    for (const asset of seedUtxoInfo.assets) {
      sendBackAssets.set(asset.assetId, asset.quantity);
    }
    const sendBackValue = Core.Value.fromCore({
      coins: 0n,
      assets: sendBackAssets,
    });
    txBuilder = txBuilder.payAssets(sendAddress, sendBackValue);
  }

  // Add action if present
  if (action && actionScriptRef && actionRefUtxo) {
    console.log("📋 Adding treasury action...");
    txBuilder = await addActionToTransactionWithRefs(
      txBuilder,
      action,
      proposalScriptRef.scriptHash,
      proposalIdentifier,
      daoInfo,
      seedUtxo,
      actionScriptRef,
      actionRefUtxo
    );
  }

  const currentSlot = getCurrentSlot();
  const validityStart = Core.Slot(Number(currentSlot));
  const validityEnd = Core.Slot(Number(currentSlot) + 300);

  console.log("✅ Transaction building complete, adding fee padding...");

  return txBuilder
    .setValidFrom(validityStart)
    .setValidUntil(validityEnd)
    .setFeePadding(500_000n) // Extra padding for reference script complexity
    .complete();
}

async function addActionToTransactionWithRefs(
  txBuilder: TransactionBuilder,
  action: ActionData,
  proposalPolicyId: string,
  proposalIdentifier: string,
  daoInfo: ExtendedDAOInfo,
  seedUtxo: Core.TransactionUnspentOutput,
  actionScriptRef: { txHash: string; outputIndex: number; scriptHash: string },
  actionRefUtxo: Core.TransactionUnspentOutput
): Promise<TransactionBuilder> {
  const actionScript = createParameterizedScript(
    "action_send_funds.action_send_funds.spend",
    [daoInfo.policyId, daoInfo.key]
  );

  const actionIdentifier = getActionIdentifier(
    proposalPolicyId,
    proposalIdentifier,
    0
  );

  const actionDatum = await createActionDatum(
    action,
    proposalPolicyId,
    proposalIdentifier,
    daoInfo,
    seedUtxo
  );

  const actionRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalPolicyId)));

        const outputRefData = Core.PlutusData.newConstrPlutusData(
          new Core.ConstrPlutusData(
            0n,
            (() => {
              const refList = new Core.PlutusList();
              refList.add(
                Core.PlutusData.newBytes(
                  Core.fromHex(seedUtxo.input().transactionId())
                )
              );
              refList.add(
                Core.PlutusData.newInteger(BigInt(seedUtxo.input().index()))
              );
              return refList;
            })()
          )
        );

        list.add(outputRefData);
        return list;
      })()
    )
  );

  const actionMintMap: Map<Core.AssetName, bigint> = new Map();
  actionMintMap.set(Core.AssetName(actionIdentifier), 1n);

  const actionValue = Core.Value.fromCore({
    coins: 0n,
    assets: new Map([
      [
        Core.AssetId.fromParts(
          Core.PolicyId(actionScriptRef.scriptHash),
          Core.AssetName(actionIdentifier)
        ),
        1n,
      ],
    ]),
  });

  const actionScriptAddress = addressFromScript(actionScript);

  return txBuilder
    .addReferenceInput(actionRefUtxo) // Action script reference
    .addMint(
      Core.PolicyId(actionScriptRef.scriptHash),
      actionMintMap,
      actionRedeemer
    )
    .lockAssets(actionScriptAddress, actionValue, actionDatum);
}

async function getVotePolicyId(
  daoPolicyId: string,
  daoKey: string
): Promise<string> {
  return getScriptPolicyId("vote.vote.mint", [daoPolicyId, daoKey]);
}

function getProposalIdentifier(
  seedUtxo: Core.TransactionUnspentOutput
): string {
  console.log("🔍 IDENTIFIER CALCULATION:");

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

  console.log("  OutputReference CBOR:", outputRefData.toCbor());

  const proposalIdentifierData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(outputRefData);
        list.add(Core.PlutusData.newInteger(-1n));
        return list;
      })()
    )
  );

  console.log("  ProposalIdentifier CBOR:", proposalIdentifierData.toCbor());

  const hash = Core.blake2b_256(proposalIdentifierData.toCbor());
  console.log("  Final hash:", hash);

  return hash;
}

async function addActionToTransaction(
  txBuilder: TransactionBuilder,
  action: ActionData,
  proposalPolicyId: string,
  proposalIdentifier: string,
  daoInfo: ExtendedDAOInfo,
  seedUtxo: Core.TransactionUnspentOutput
): Promise<TransactionBuilder> {
  const actionScript = createParameterizedScript(
    "action_send_funds.action_send_funds.mint",
    [daoInfo.policyId, daoInfo.key]
  );
  const actionPolicyId = actionScript.hash();

  // Verify action policy is whitelisted
  if (!daoInfo.whitelisted_actions.includes(actionPolicyId)) {
    throw new Error("Action policy not whitelisted in DAO");
  }

  const actionIdentifier = getActionIdentifier(
    proposalPolicyId,
    proposalIdentifier,
    0
  );

  const actionDatum = await createActionDatum(
    action,
    proposalPolicyId,
    proposalIdentifier,
    daoInfo,
    seedUtxo
  );

  // Add this right after the action validation debug:
  console.log("🔍 ACTION IDENTIFIER VERIFICATION:");
  console.log("Our calculation:");
  console.log(`  proposal_policy_id: ${proposalPolicyId}`);
  console.log(`  proposal_identifier: ${proposalIdentifier}`);
  console.log(`  action_index: 0`);
  console.log(`  Generated identifier: ${actionIdentifier}`);

  // Calculate what the contract would generate from the action datum
  const contractCalcData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalPolicyId)));
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalIdentifier)));
        list.add(Core.PlutusData.newInteger(0n));
        return list;
      })()
    )
  );
  const contractCalcIdentifier = Core.blake2b_256(contractCalcData.toCbor());

  console.log("Contract calculation (should match):");
  console.log(`  CBOR: ${contractCalcData.toCbor()}`);
  console.log(`  Hash: ${contractCalcIdentifier}`);
  console.log(`  Match: ${actionIdentifier === contractCalcIdentifier}`);

  // Also check what we're actually minting
  console.log("Transaction minting:");
  console.log(`  Minting: ${actionPolicyId}.${actionIdentifier} = 1`);
  console.log(
    `  Action output will contain: ${actionPolicyId}.${actionIdentifier} = 1`
  );

  console.log("🔍 ACTION DATUM DEBUG:");
  // const parsedActionDatum = await parseActionDatumForDebug(actionDatum);
  // console.log("  Name:", parsedActionDatum.name);
  // console.log("  Description:", parsedActionDatum.description);
  // console.log("  Activation time:", parsedActionDatum.activationTime);
  // console.log("  Option:", parsedActionDatum.option);
  // console.log("  Action identifier in datum:");
  // console.log(
  //   "    proposal_policy_id:",
  //   parsedActionDatum.actionIdentifier.proposal_policy_id
  // );
  // console.log(
  //   "    proposal_identifier:",
  //   parsedActionDatum.actionIdentifier.proposal_identifier
  // );
  // console.log(
  //   "    action_index:",
  //   parsedActionDatum.actionIdentifier.action_index
  // );
  // console.log("  Targets count:", parsedActionDatum.targets.length);
  // console.log("  Treasury address:", parsedActionDatum.treasury);

  const actionRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalPolicyId)));

        const outputRefData = Core.PlutusData.newConstrPlutusData(
          new Core.ConstrPlutusData(
            0n,
            (() => {
              const refList = new Core.PlutusList();
              refList.add(
                Core.PlutusData.newBytes(
                  Core.fromHex(seedUtxo.input().transactionId())
                )
              );
              refList.add(
                Core.PlutusData.newInteger(BigInt(seedUtxo.input().index()))
              );
              return refList;
            })()
          )
        );

        list.add(outputRefData);
        return list;
      })()
    )
  );

  console.log("🔍 ACTION VALIDATION DEBUG:");
  console.log(`  Proposal policy ID: ${proposalPolicyId}`);
  console.log(`  Proposal identifier: ${proposalIdentifier}`);
  console.log(`  Action index: 0`);
  console.log(`  Generated action identifier: ${actionIdentifier}`);
  console.log(`  Action policy ID: ${actionPolicyId}`);
  console.log(`  DAO whitelisted actions: ${daoInfo.whitelisted_actions}`);
  console.log(
    `  Action whitelisted: ${daoInfo.whitelisted_actions.includes(
      actionPolicyId
    )}`
  );

  // Also debug the action redeemer structure
  console.log("Action redeemer structure:");
  console.log(`  proposal_policy_id: ${proposalPolicyId}`);
  console.log(
    `  proposal_identifier: ${seedUtxo.input().transactionId()}#${seedUtxo
      .input()
      .index()}`
  );
  console.log(`  Redeemer CBOR: ${actionRedeemer.toCbor()}`);

  const actionMintMap: Map<Core.AssetName, bigint> = new Map();
  actionMintMap.set(Core.AssetName(actionIdentifier), 1n);

  const actionValue = Core.Value.fromCore({
    coins: 0n,
    assets: new Map([
      [
        Core.AssetId.fromParts(
          Core.PolicyId(actionPolicyId),
          Core.AssetName(actionIdentifier)
        ),
        1n,
      ],
    ]),
  });

  const actionScriptAddress = addressFromScript(actionScript);

  console.log("🔍 ACTION DATUM CBOR:", actionDatum.toCbor());
  console.log("🔍 ACTION DATUM STRUCTURE:");
  console.log("  Fields count:", 7);
  console.log("  Targets count:", action.targets.length);
  if (action.targets.length > 0) {
    console.log(
      "  Target 0 - Address length:",
      Core.addressFromBech32(action.targets[0].address).toBytes().length
    );
    console.log(
      "  Target 0 - ADA amount:",
      action.targets[0].assets.find((a) => a.unit === "lovelace")?.quantity
    );
  }

  return txBuilder
    .provideScript(actionScript)
    .addMint(Core.PolicyId(actionPolicyId), actionMintMap, actionRedeemer)
    .lockAssets(actionScriptAddress, actionValue, actionDatum);
}

async function createActionDatum(
  action: ActionData,
  proposalPolicyId: string,
  proposalIdentifier: string,
  daoInfo: ExtendedDAOInfo,
  seedUtxo: TransactionUnspentOutput
): Promise<Core.PlutusData> {
  const fields = new Core.PlutusList();

  // Field 0: name (String - not bytes!)
  fields.add(Core.PlutusData.newBytes(new TextEncoder().encode(action.name)));

  // Field 1: description (String - not bytes!)
  fields.add(
    Core.PlutusData.newBytes(new TextEncoder().encode(action.description))
  );

  // Field 2: activation_time (BigInt)
  const activationTimeMs = new Date(action.activationTime).getTime();
  fields.add(Core.PlutusData.newInteger(BigInt(activationTimeMs)));

  // Field 3: action_identifier
  const actionIdentifierFields = new Core.PlutusList();
  actionIdentifierFields.add(
    Core.PlutusData.newBytes(Core.fromHex(proposalPolicyId))
  );
  actionIdentifierFields.add(
    Core.PlutusData.newBytes(Core.fromHex(proposalIdentifier))
  );
  actionIdentifierFields.add(Core.PlutusData.newInteger(0n));
  fields.add(
    Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(0n, actionIdentifierFields)
    )
  );

  // Field 4: option (BigInt)
  fields.add(Core.PlutusData.newInteger(1n));

  // Field 5: targets
  const targetsList = new Core.PlutusList();
  for (const target of action.targets) {
    const targetFields = new Core.PlutusList();

    // Address
    const address = Core.addressFromBech32(target.address);
    const addressBytes = address.toBytes();
    const headerByte = parseInt(addressBytes.slice(0, 2), 16);
    const addressType = headerByte & 0x0f;
    const paymentCredHash = addressBytes.slice(2, 58);
    const isScript = (addressType & 0x01) === 0x01;

    const addressData = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(
        0n,
        (() => {
          const addrList = new Core.PlutusList();

          // payment_credential
          const paymentCred = Core.PlutusData.newConstrPlutusData(
            new Core.ConstrPlutusData(
              isScript ? 1n : 0n,
              (() => {
                const credList = new Core.PlutusList();
                credList.add(
                  Core.PlutusData.newBytes(Core.fromHex(paymentCredHash))
                );
                return credList;
              })()
            )
          );
          addrList.add(paymentCred);

          // stake_credential - None
          const stakeCredNone = Core.PlutusData.newConstrPlutusData(
            new Core.ConstrPlutusData(1n, new Core.PlutusList())
          );
          addrList.add(stakeCredNone);

          return addrList;
        })()
      )
    );
    targetFields.add(addressData);

    // Coins
    const adaAsset = target.assets.find((a) => a.unit === "lovelace");
    const lovelaceAmount = adaAsset
      ? BigInt(parseFloat(adaAsset.quantity) * 1_000_000)
      : 0n;
    targetFields.add(Core.PlutusData.newInteger(lovelaceAmount));

    // Tokens - Record(String, Record(String, BigInt)) - empty record
    const emptyTokensRecord = new Core.PlutusMap();
    targetFields.add(Core.PlutusData.newMap(emptyTokensRecord));

    // Datum - NoDatum literal
    const noDatum = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(0n, new Core.PlutusList())
    );
    targetFields.add(noDatum);

    const targetData = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(0n, targetFields)
    );
    targetsList.add(targetData);
  }
  fields.add(Core.PlutusData.newList(targetsList));

  // Field 6: treasury
  const treasuryScript = createParameterizedScript("treasury.treasury.spend", [
    daoInfo.policyId,
    daoInfo.key,
  ]);

  const treasuryAddressData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const addrList = new Core.PlutusList();

        // payment_credential - Script
        const paymentCred = Core.PlutusData.newConstrPlutusData(
          new Core.ConstrPlutusData(
            1n,
            (() => {
              const credList = new Core.PlutusList();
              credList.add(
                Core.PlutusData.newBytes(Core.fromHex(treasuryScript.hash()))
              );
              return credList;
            })()
          )
        );
        addrList.add(paymentCred);

        // stake_credential - None
        const stakeCredNone = Core.PlutusData.newConstrPlutusData(
          new Core.ConstrPlutusData(1n, new Core.PlutusList())
        );
        addrList.add(stakeCredNone);

        return addrList;
      })()
    )
  );
  fields.add(treasuryAddressData);

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, fields)
  );
}

async function createProposalDatum(
  proposal: ProposalData,
  seedUtxo: Core.TransactionUnspentOutput
): Promise<Core.PlutusData> {
  const fieldsList = new Core.PlutusList();

  fieldsList.add(
    Core.PlutusData.newBytes(new TextEncoder().encode(proposal.name))
  );

  fieldsList.add(
    Core.PlutusData.newBytes(new TextEncoder().encode(proposal.description))
  );

  const tallyList = new Core.PlutusList();
  tallyList.add(Core.PlutusData.newInteger(0n));
  tallyList.add(Core.PlutusData.newInteger(0n));
  fieldsList.add(Core.PlutusData.newList(tallyList));

  const endTimeMs = new Date(proposal.endTime).getTime();
  fieldsList.add(Core.PlutusData.newInteger(BigInt(endTimeMs)));

  const statusData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, new Core.PlutusList())
  );
  fieldsList.add(statusData);

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
  fieldsList.add(outputRefData);

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, fieldsList)
  );
}

function getActionIdentifier(
  proposalPolicyId: string,
  proposalIdentifier: string,
  actionIndex: number
): string {
  const actionIdentifierData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalPolicyId)));
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalIdentifier)));
        list.add(Core.PlutusData.newInteger(BigInt(actionIndex)));
        return list;
      })()
    )
  );

  return Core.blake2b_256(actionIdentifierData.toCbor());
}

async function parseActionDatumForDebug(datum: Core.PlutusData) {
  const constr = datum.asConstrPlutusData()!;
  const fields = constr.getData();

  // Field 0: name (String)
  const name = new TextDecoder().decode(fields.get(0).asBoundedBytes()!);

  // Field 1: description (String)
  const description = new TextDecoder().decode(fields.get(1).asBoundedBytes()!);

  // Field 2: activation_time (BigInt)
  const activationTime = Number(fields.get(2).asInteger()!);

  // Field 3: action_identifier
  const actionIdConstr = fields.get(3).asConstrPlutusData()!;
  const actionIdFields = actionIdConstr.getData();
  const actionIdentifier = {
    proposal_policy_id: Core.toHex(actionIdFields.get(0).asBoundedBytes()!),
    proposal_identifier: Core.toHex(actionIdFields.get(1).asBoundedBytes()!),
    action_index: Number(actionIdFields.get(2).asInteger()!),
  };

  // Field 4: option (BigInt)
  const option = Number(fields.get(4).asInteger()!);

  // Field 5: targets (Array of Target)
  const targetsList = fields.get(5).asList()!;
  const targets = [];
  for (let i = 0; i < targetsList.getLength(); i++) {
    const targetConstr = targetsList.get(i).asConstrPlutusData()!;
    const targetFields = targetConstr.getData();

    // Parse target address
    const addressConstr = targetFields.get(0).asConstrPlutusData()!;
    const addressFields = addressConstr.getData();

    // Payment credential
    const paymentCredConstr = addressFields.get(0).asConstrPlutusData()!;
    const paymentCredType = Number(paymentCredConstr.getAlternative());
    const paymentCredFields = paymentCredConstr.getData();
    const paymentCredHash = Core.toHex(
      paymentCredFields.get(0).asBoundedBytes()!
    );

    // Stake credential (Optional)
    const stakeCredConstr = addressFields.get(1).asConstrPlutusData()!;
    const hasStakeCred = Number(stakeCredConstr.getAlternative()) === 0;

    let stakeCredInfo = "None";
    if (hasStakeCred) {
      const stakeCredFields = stakeCredConstr.getData();
      const innerStakeCredConstr = stakeCredFields.get(0).asConstrPlutusData()!;
      const stakeCredType = Number(innerStakeCredConstr.getAlternative());
      const innerStakeCredFields = innerStakeCredConstr.getData();
      const stakeCredHash = Core.toHex(
        innerStakeCredFields.get(0).asBoundedBytes()!
      );
      stakeCredInfo = `${
        stakeCredType === 0 ? "Key" : "Script"
      }:${stakeCredHash}`;
    }

    const coins = Number(targetFields.get(1).asInteger()!);

    // Tokens list
    const tokensList = targetFields.get(2).asList()!;
    const tokensCount = tokensList.getLength();

    // Datum
    const datumConstr = targetFields.get(3).asConstrPlutusData()!;
    const datumType = Number(datumConstr.getAlternative());
    const datumInfo = datumType === 0 ? "NoDatum" : `SomeData(${datumType})`;

    targets.push({
      address: {
        payment_credential: `${
          paymentCredType === 0 ? "Key" : "Script"
        }:${paymentCredHash}`,
        stake_credential: stakeCredInfo,
      },
      coins,
      tokens_count: tokensCount,
      datum: datumInfo,
    });
  }

  // Field 6: treasury (Address)
  const treasuryConstr = fields.get(6).asConstrPlutusData()!;
  const treasuryFields = treasuryConstr.getData();

  // Treasury payment credential
  const treasuryPaymentCredConstr = treasuryFields.get(0).asConstrPlutusData()!;
  const treasuryPaymentCredType = Number(
    treasuryPaymentCredConstr.getAlternative()
  );
  const treasuryPaymentCredFields = treasuryPaymentCredConstr.getData();
  const treasuryPaymentCredHash = Core.toHex(
    treasuryPaymentCredFields.get(0).asBoundedBytes()!
  );

  // Treasury stake credential
  const treasuryStakeCredConstr = treasuryFields.get(1).asConstrPlutusData()!;
  const treasuryHasStakeCred =
    Number(treasuryStakeCredConstr.getAlternative()) === 0;

  let treasuryStakeCredInfo = "None";
  if (treasuryHasStakeCred) {
    const treasuryStakeCredFields = treasuryStakeCredConstr.getData();
    const innerTreasuryStakeCredConstr = treasuryStakeCredFields
      .get(0)
      .asConstrPlutusData()!;
    const treasuryStakeCredType = Number(
      innerTreasuryStakeCredConstr.getAlternative()
    );
    const innerTreasuryStakeCredFields = innerTreasuryStakeCredConstr.getData();
    const treasuryStakeCredHash = Core.toHex(
      innerTreasuryStakeCredFields.get(0).asBoundedBytes()!
    );
    treasuryStakeCredInfo = `${
      treasuryStakeCredType === 0 ? "Key" : "Script"
    }:${treasuryStakeCredHash}`;
  }

  const treasury = {
    payment_credential: `${
      treasuryPaymentCredType === 0 ? "Key" : "Script"
    }:${treasuryPaymentCredHash}`,
    stake_credential: treasuryStakeCredInfo,
  };

  return {
    name,
    description,
    activationTime,
    actionIdentifier,
    option,
    targets,
    treasury,
  };
}
