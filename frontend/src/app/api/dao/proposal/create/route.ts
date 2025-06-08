import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core, Provider, Wallet } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  fetchDAOInfo,
  FullDAODatum,
  parseDAODatum,
} from "@/lib/server/helpers/dao-helpers";
import {
  createVoteScript,
  findUserVoteUtxo,
  getVoteUtxo,
} from "@/lib/server/helpers/vote-helpers";
import {
  addressFromScript,
  createParameterizedScript,
  getCurrentSlot,
  getScriptPolicyId,
  timestampToSlot,
} from "@/lib/server/helpers/script-helpers";
import { Datum, Transaction } from "@blaze-cardano/core";
import {
  validateProposalData,
  validateActionData,
  validateProposalTiming,
  validateActionTiming,
} from "./_helpers/validators";

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

interface BuildProposalParams {
  seedUtxo: Core.TransactionUnspentOutput;
  daoInfo: ExtendedDAOInfo;
  userVoteInfo: UserVoteInfo;
  proposal: ProposalData;
  action?: ActionData;
  votePolicyId: string;
  receiveAddress: Core.Address;
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
    const receiveAddress = Core.addressFromBech32(changeAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    console.debug(`✅ Found DAO: ${daoInfo.name}`);

    const votePolicyId = await getVotePolicyId(daoPolicyId, daoKey);
    const userVoteInfo = await findUserVoteUtxo(
      walletAddress,
      votePolicyId,
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

    const seedUtxo =
      userUtxos.find((utxo) => {
        const value = utxo.output().amount().toCore();
        if (!value.assets) return true; // ADA-only UTXO is perfect

        // Check if this UTXO contains the user's Vote NFT
        for (const [assetId] of value.assets) {
          const policyId = Core.AssetId.getPolicyId(assetId);
          const assetName = Core.AssetId.getAssetName(assetId);
          if (
            policyId === votePolicyId &&
            assetName === userVoteInfo.voteNftAssetName
          ) {
            return false; // Skip this UTXO - it contains the Vote NFT
          }
        }
        return true;
      }) ?? userUtxos[0];

    console.log("seed utxo: ", seedUtxo);

    let tx: Transaction | null = null;
    try {
      tx = await buildProposalTransaction(blaze, {
        seedUtxo,
        daoInfo,
        userVoteInfo,
        proposal,
        action,
        votePolicyId,
        receiveAddress,
      });
      console.log("✅ Transaction built successfully");
    } catch (buildError: any) {
      console.error("❌ Transaction building failed:", buildError);
      console.error("Error details:", buildError.message);
      console.error("Error stack:", buildError.stack);
      throw buildError;
    }

    console.log("🔍 VOTE KEY DEBUG:");
    console.log("User's Vote NFT asset name:", userVoteInfo.voteNftAssetName);
    console.log("Expected format: 0001 + unique_id");
    console.log("Extracted unique ID:", userVoteInfo.voteNftAssetName.slice(4));
    console.log("Reference asset name:", userVoteInfo.referenceAssetName);
    console.log("Expected format: 0000 + unique_id");

    console.log("🔍 BUILT TRANSACTION:");
    const txCore = tx.toCore();
    console.log("Inputs:", txCore.body.inputs?.length);
    console.log("Reference inputs:", txCore.body.referenceInputs?.length);
    console.log("Outputs:", txCore.body.outputs?.length);
    console.log(
      "Mints:",
      txCore.body.mint ? Array.from(txCore.body.mint.keys()) : "none"
    );

    // try {
    //   await blaze.provider.evaluateTransaction(tx, []);
    //   console.debug("✅ Transaction dry run successful");
    // } catch (dryRunError: any) {
    //   console.error(
    //     "❌ Full error object:",
    //     JSON.stringify(dryRunError, null, 2)
    //   );
    //   console.error("❌ Error response:", dryRunError?.response?.data);
    //   console.error("❌ Error status:", dryRunError?.response?.status);
    //   throw new Error(
    //     `Transaction validation failed: ${
    //       dryRunError instanceof Error ? dryRunError.message : "Unknown error"
    //     }`
    //   );
    // }

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

  console.log("OutputReference CBOR:", outputRefData.toCbor());

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

  console.log("🔍 DETAILED IDENTIFIER DEBUG:");
  console.log("OutputRef CBOR:", outputRefData.toCbor());
  console.log("ProposalIdentifier CBOR:", proposalIdentifierData.toCbor());
  console.log("Final hash:", Core.blake2b_256(proposalIdentifierData.toCbor()));
  console.log("ProposalIdentifier CBOR:", proposalIdentifierData.toCbor());
  console.log("Final Hash:", Core.blake2b_256(proposalIdentifierData.toCbor()));

  const proposalIdentifierCbor = proposalIdentifierData.toCbor();
  return Core.blake2b_256(proposalIdentifierCbor);
}

async function buildProposalTransaction(
  blaze: Blaze<Provider, Wallet>,
  params: BuildProposalParams
): Promise<Core.Transaction> {
  const {
    seedUtxo,
    daoInfo,
    userVoteInfo,
    proposal,
    action,
    votePolicyId,
    receiveAddress,
  } = params;

  console.log("🔍 DAO REFERENCE INPUT:");
  console.log("DAO UTXO:", {
    txHash: daoInfo.utxo?.input()?.transactionId(),
    outputIndex: daoInfo.utxo?.input()?.index(),
    address: daoInfo.utxo?.output()?.address()?.toBech32(),
    hasDAOToken: !!daoInfo.utxo?.output()?.amount()?.toCore(),
  });

  const proposalScript = createParameterizedScript("proposal.proposal.mint", [
    daoInfo.policyId,
    daoInfo.key,
    votePolicyId,
  ]);
  const proposalPolicyId = proposalScript.hash();

  console.log("🔍 DAO WHITELIST CHECK:");
  console.log("DAO whitelisted proposals:", daoInfo.whitelisted_proposals);
  console.log("Current proposal policy:", proposalPolicyId);
  console.log(
    "Is whitelisted:",
    daoInfo.whitelisted_proposals.includes(proposalPolicyId)
  );

  console.log("🔍 PROPOSAL SCRIPT DEBUG:");
  console.log("Proposal policy ID:", proposalPolicyId);
  console.log("DAO policy ID:", daoInfo.policyId);
  console.log("DAO key:", daoInfo.key);
  console.log("Vote policy ID:", votePolicyId);

  console.log("🔍 SEED UTXO DEBUG:");
  console.log("Seed UTXO:", {
    txHash: seedUtxo.input().transactionId(),
    outputIndex: seedUtxo.input().index(),
    address: seedUtxo.output().address().toBech32(),
    value: seedUtxo.output().amount().toCore(),
  });

  const proposalIdentifier = getProposalIdentifier(seedUtxo);
  const proposalDatum = await createProposalDatum(proposal, seedUtxo);

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

  const proposalMintMap: Map<Core.AssetName, bigint> = new Map();
  proposalMintMap.set(Core.AssetName(proposalIdentifier), 1n);

  const mintedAssets = Array.from(proposalMintMap.entries());
  console.log("Minting:", mintedAssets);

  const proposalValue = Core.Value.fromCore({
    coins: 0n,
    assets: new Map([
      [
        Core.AssetId.fromParts(
          Core.PolicyId(proposalPolicyId),
          Core.AssetName(proposalIdentifier)
        ),
        1n,
      ],
    ]),
  });

  const outputAssets = proposalValue.toCore().assets;
  console.log("Output contains:", outputAssets);

  const proposalScriptAddress = addressFromScript(proposalScript);

  const voteUtxo = await getVoteUtxo(
    daoInfo.policyId,
    daoInfo.key,
    userVoteInfo.utxo,
    { enableLogging: true }
  );
  if (!voteUtxo) {
    throw new Error(
      "Vote UTXO not found or already spent. Please refresh and try again."
    );
  }

  console.log("🔍 VOTE REFERENCE ASSET VERIFICATION:");
  const expectedReferenceAsset = `${votePolicyId}0000${voteKeyHex}`;
  console.log("Expected reference asset:", expectedReferenceAsset);
  const voteAssets = voteUtxo.output().amount().toCore().assets;
  let hasReferenceAsset = false;
  if (voteAssets) {
    for (const [assetId, quantity] of voteAssets) {
      console.log(`Vote UTXO asset: ${assetId} = ${quantity}`);
      if (assetId === expectedReferenceAsset && quantity === 1n) {
        hasReferenceAsset = true;
      }
    }
  }
  console.log("Has reference asset:", hasReferenceAsset);
  console.log("🔍 Debug Info:");
  console.log("Vote Key Hex:", voteKeyHex);
  console.log("Proposal Identifier:", proposalIdentifier);
  console.log(
    "Proposal Datum:",
    JSON.stringify(proposalDatum.toCbor(), null, 2)
  );
  console.log(
    "Proposal Redeemer:",
    JSON.stringify(proposalRedeemer.toCbor(), null, 2)
  );
  console.log("DAO Info:", {
    policyId: daoInfo.policyId,
    key: daoInfo.key,
    minGovProposalCreate: daoInfo.min_gov_proposal_create,
  });
  console.log("User Vote Info:", {
    lockedTokens: userVoteInfo.lockedGovernanceTokens,
    utxo: userVoteInfo.utxo,
    referenceAssetName: userVoteInfo.referenceAssetName,
  });

  const currentSlot = getCurrentSlot();
  const currentSlotTyped = Core.Slot(Number(currentSlot));
  const endSlotTyped = Core.Slot(Number(currentSlot + 100n));

  console.log("🔍 TIMING VALIDATION DEBUG:");
  const now = new Date();
  const endTime = new Date(proposal.endTime);

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const endTimeSeconds = Math.floor(endTime.getTime() / 1000);

  console.log("Current time (seconds):", nowSeconds);
  console.log("Proposal end time (seconds):", endTimeSeconds);
  console.log("DAO min proposal time (seconds):", daoInfo.min_proposal_time);
  console.log("DAO max proposal time (seconds):", daoInfo.max_proposal_time);

  const minEndTimeSeconds = nowSeconds + daoInfo.min_proposal_time;
  const maxEndTimeSeconds = nowSeconds + daoInfo.max_proposal_time;

  console.log("Min allowed end time (seconds):", minEndTimeSeconds);
  console.log("Max allowed end time (seconds):", maxEndTimeSeconds);
  console.log(
    "Duration valid:",
    endTimeSeconds >= minEndTimeSeconds && endTimeSeconds <= maxEndTimeSeconds
  );

  console.log("🔍 PROPOSAL IDENTIFIER VALIDATION:");
  console.log("Minting token name:", proposalIdentifier);
  console.log(
    "Token being minted in transaction:",
    Array.from(proposalMintMap.keys())[0]
  );
  console.log(
    "Do they match:",
    proposalIdentifier === Array.from(proposalMintMap.keys())[0]
  );

  console.log("🔍 ON-CHAIN DAO VERIFICATION:");
  const daoUtxo = daoInfo.utxo;
  const onChainDatum = daoUtxo.output().datum()?.asInlineData();
  if (onChainDatum) {
    const parsedOnChainDAO = parseDAODatum(onChainDatum);
    console.log("On-chain DAO datum:");
    console.log("  Name:", parsedOnChainDAO.name);
    console.log(
      "  Whitelisted proposals:",
      parsedOnChainDAO.whitelisted_proposals
    );
    console.log("  Whitelisted actions:", parsedOnChainDAO.whitelisted_actions);
    console.log("  Min proposal time:", parsedOnChainDAO.min_proposal_time);
    console.log("  Max proposal time:", parsedOnChainDAO.max_proposal_time);

    console.log("🔍 WHITELIST VERIFICATION:");
    console.log("Current proposal policy:", proposalPolicyId);
    console.log(
      "Is in on-chain whitelist:",
      parsedOnChainDAO.whitelisted_proposals.includes(proposalPolicyId)
    );

    // Check if any whitelist entries match (in case of case sensitivity issues)
    console.log("Whitelist comparison:");
    parsedOnChainDAO.whitelisted_proposals.forEach((policy, i) => {
      console.log(
        `  [${i}] ${policy} === ${proposalPolicyId} ? ${
          policy === proposalPolicyId
        }`
      );
    });
  } else {
    console.log("❌ Could not extract DAO datum from UTXO");
  }

  // Also verify the DAO UTXO contains the expected DAO NFT
  console.log("🔍 DAO NFT VERIFICATION:");
  const daoValue = daoUtxo.output().amount().toCore();
  console.log("DAO UTXO value:", daoValue);
  if (daoValue.assets) {
    for (const [assetId, quantity] of daoValue.assets) {
      const policyId = Core.AssetId.getPolicyId(assetId);
      const assetName = Core.AssetId.getAssetName(assetId);
      console.log(`DAO asset: ${policyId}.${assetName} = ${quantity}`);
      if (policyId === daoInfo.policyId && assetName === daoInfo.key) {
        console.log("✅ Found expected DAO NFT");
      }
    }
  }

  console.log("🔍 DATUM/REDEEMER VERIFICATION:");
  try {
    const datumCbor = proposalDatum.toCbor();
    console.log("✅ Proposal datum CBOR valid, length:", datumCbor.length);
  } catch (e) {
    console.error("❌ Proposal datum CBOR invalid:", e);
  }

  try {
    const redeemerCbor = proposalRedeemer.toCbor();
    console.log(
      "✅ Proposal redeemer CBOR valid, length:",
      redeemerCbor.length
    );
  } catch (e) {
    console.error("❌ Proposal redeemer CBOR invalid:", e);
  }

  console.log("🔍 SCRIPT VERIFICATION:");
  console.log("Proposal script hash:", proposalScript.hash());
  console.log("Proposal script address:", proposalScriptAddress.toBech32());
  console.log("Proposal script CBOR length:", proposalScript.toCbor().length);

  console.log("🔍 SEED UTXO VERIFICATION:");
  console.log("Seed UTXO being consumed:", {
    txHash: seedUtxo.input().transactionId(),
    outputIndex: seedUtxo.input().index(),
  });
  console.log("Proposal identifier calculation uses:", {
    txHash: seedUtxo.input().transactionId(),
    outputIndex: seedUtxo.input().index(),
  });
  console.log(
    "single_identifier_minted_into_proposal will look for this seed UTXO in tx.inputs"
  );

  console.log("🔍 TRANSACTION REFERENCE INPUTS DEBUG:");
  console.log("Vote policy ID:", votePolicyId);
  console.log("Vote key (from redeemer):", voteKeyHex);
  console.log("Expected reference asset:", `0000${voteKeyHex}`);
  console.log("Vote UTXO reference assets:");
  const voteValue = voteUtxo.output().amount().toCore();
  if (voteValue.assets) {
    for (const [assetId, quantity] of voteValue.assets) {
      const policyId = Core.AssetId.getPolicyId(assetId);
      const assetName = Core.AssetId.getAssetName(assetId);
      console.log(`  ${policyId}.${assetName} = ${quantity}`);
      if (policyId === votePolicyId) {
        console.log(`    -> Vote policy asset: ${assetName}`);
      }
    }
  }

  // Calculate what the contract expects
  const contractExpectedIdentifier = getProposalIdentifier(seedUtxo);

  // What you're actually minting
  const actualMintedIdentifier = Array.from(proposalMintMap.keys())[0];

  // What's in your proposal output value
  let proposalOutputHasToken = false;
  const proposalOutputValue = proposalValue.toCore();
  if (proposalOutputValue.assets) {
    for (const [assetId, quantity] of proposalOutputValue.assets) {
      const assetName = Core.AssetId.getAssetName(assetId);
      const policyId = Core.AssetId.getPolicyId(assetId);
      if (
        policyId === Core.PolicyId(proposalPolicyId) &&
        assetName === contractExpectedIdentifier
      ) {
        proposalOutputHasToken = true;
        console.log(
          `✅ Proposal output contains token: ${assetName} = ${quantity}`
        );
      }
    }
  }

  console.log("🔍 PROPOSAL IDENTIFIER VERIFICATION:");
  console.log("Contract expects:", contractExpectedIdentifier);
  console.log("Actually minting:", actualMintedIdentifier);
  console.log(
    "Do they match:",
    contractExpectedIdentifier === actualMintedIdentifier
  );
  console.log("Proposal output has token:", proposalOutputHasToken);

  // Also verify your proposal datum's identifier field
  console.log("🔍 PROPOSAL DATUM IDENTIFIER:");
  console.log("Seed UTXO ref:", {
    txHash: seedUtxo.input().transactionId(),
    outputIndex: seedUtxo.input().index(),
  });

  console.log("🔍 MINIMUM STAKED VERIFICATION:");
  console.log("User locked tokens:", userVoteInfo.lockedGovernanceTokens);
  console.log("DAO minimum required:", daoInfo.min_gov_proposal_create);
  console.log(
    "Has enough tokens:",
    userVoteInfo.lockedGovernanceTokens >= daoInfo.min_gov_proposal_create
  );

  const voteScript = await createVoteScript(daoInfo.policyId, daoInfo.key);
  const voteRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(1n, new Core.PlutusList()) // CastVote is constructor 1
  );

  console.log("🔍 COMPREHENSIVE CONTRACT VALIDATION DEBUG:");
  console.log("==========================================");

  // 1. Transaction Inputs Analysis
  console.log("\n📥 TRANSACTION INPUTS:");
  console.log("What we're providing:");
  console.log("  - Seed UTXO:", {
    txHash: seedUtxo.input().transactionId(),
    outputIndex: seedUtxo.input().index(),
  });
  console.log("What contract expects:");
  console.log(
    "  - expect Some(_output_ref_present) = find_input(tx.inputs, proposal_datum.identifier)"
  );
  console.log("  - The seed UTXO must be in tx.inputs");

  // 2. Reference Inputs Analysis
  console.log("\n📖 REFERENCE INPUTS:");
  console.log("What we're providing:");
  console.log("  - DAO UTXO:", {
    txHash: daoInfo.utxo.input().transactionId(),
    outputIndex: daoInfo.utxo.input().index(),
    address: daoInfo.utxo.output().address().toBech32(),
  });
  console.log("  - Vote UTXO:", {
    txHash: voteUtxo.input().transactionId(),
    outputIndex: voteUtxo.input().index(),
    address: voteUtxo.output().address().toBech32(),
  });
  console.log("What contract expects:");
  console.log("  - get_dao_datum_from_reference(tx, dao_policy_id, dao_key)");
  console.log("  - get_vote_reference(tx, vote_policy_id, vote_key)");

  // 3. Minting Analysis
  console.log("\n🪙 MINTING:");
  console.log("What we're providing:");
  console.log("  - Policy ID:", proposalPolicyId);
  console.log("  - Asset Name:", proposalIdentifier);
  console.log("  - Quantity:", Array.from(proposalMintMap.values())[0]);
  console.log("What contract expects:");
  console.log("  - single_identifier_minted_into_proposal check");
  console.log(
    "  - Proposal identifier must equal get_proposal_identifier(proposal_datum.identifier)"
  );

  // 4. Redeemer Analysis
  console.log("\n🔧 REDEEMER:");
  console.log("What we're providing:");
  console.log("  - Constructor: 0 (CreateProposal)");
  console.log("  - Vote Key:", voteKeyHex);
  console.log(
    "  - Vote Key Length:",
    voteKeyHex.length,
    "chars =",
    voteKeyHex.length / 2,
    "bytes"
  );
  console.log("What contract expects:");
  console.log("  - CreateProposal { vote_key: ByteArray }");
  console.log("  - vote_key should be the unique identifier (28 bytes)");

  // 5. Vote Reference Validation
  console.log("\n🗳️ VOTE REFERENCE VALIDATION:");
  const expectedAssetName = `0000${voteKeyHex}`;
  console.log(
    "Contract will look for asset:",
    `${votePolicyId}${expectedAssetName}`
  );
  console.log("Vote UTXO actually contains:");
  // const voteAssets = voteUtxo.output().amount().toCore().assets;
  if (voteAssets) {
    for (const [assetId, quantity] of voteAssets) {
      const policyId = Core.AssetId.getPolicyId(assetId);
      const assetName = Core.AssetId.getAssetName(assetId);
      console.log(`  - ${policyId}${assetName} = ${quantity}`);
      if (policyId === votePolicyId && assetName === expectedAssetName) {
        console.log(
          "    ✅ MATCH: This is the reference asset the contract expects"
        );
      }
    }
  }

  // 6. Governance Token Validation
  console.log("\n💰 GOVERNANCE TOKEN VALIDATION:");
  const govTokenHex = daoInfo.governance_token;
  const govPolicyId = govTokenHex.slice(0, 56);
  const govAssetName = govTokenHex.slice(56);
  console.log("DAO governance token:", govTokenHex);
  console.log("  - Policy ID:", govPolicyId);
  console.log("  - Asset Name:", govAssetName);
  console.log("Vote UTXO governance tokens:");
  let foundGovTokens = 0;
  if (voteAssets) {
    for (const [assetId, quantity] of voteAssets) {
      const policyId = Core.AssetId.getPolicyId(assetId);
      const assetName = Core.AssetId.getAssetName(assetId);
      if (policyId === govPolicyId && assetName === govAssetName) {
        foundGovTokens = Number(quantity);
        console.log(`  - Found ${quantity} governance tokens`);
      }
    }
  }
  console.log("Contract validation:");
  console.log(`  - Required: ${daoInfo.min_gov_proposal_create}`);
  console.log(`  - Available: ${foundGovTokens}`);
  console.log(
    `  - Passes: ${foundGovTokens >= daoInfo.min_gov_proposal_create}`
  );

  // 7. Proposal Output Validation
  console.log("\n📄 PROPOSAL OUTPUT VALIDATION:");
  console.log("What we're providing:");
  console.log("  - Address:", proposalScriptAddress.toBech32());
  console.log("  - Value:", proposalValue.toCore());
  console.log("  - Datum structure:", "ProposalDatum with 6 fields");
  console.log("What contract expects:");
  console.log(
    "  - expect [proposal_output] = find_script_outputs(tx.outputs, policy_id)"
  );
  console.log("  - Output must be at proposal script address");
  console.log("  - Must contain exactly 1 proposal identifier token");

  // 8. Datum Field Validation
  console.log("\n📋 PROPOSAL DATUM VALIDATION:");
  console.log("Our datum fields:");
  console.log("  - name:", proposal.name);
  console.log("  - description:", proposal.description);
  console.log("  - tally: [0, 0]");
  console.log(
    "  - end_time:",
    Math.floor(new Date(proposal.endTime).getTime() / 1000)
  );
  console.log("  - status: Active (Constructor 0)");
  console.log("  - identifier: OutputReference {");
  console.log("      transaction_id:", seedUtxo.input().transactionId());
  console.log("      output_index:", seedUtxo.input().index());
  console.log("    }");

  // 9. Timing Validation
  console.log("\n⏰ TIMING VALIDATION:");
  // const nowSeconds = Math.floor(Date.now() / 1000);
  // const endTimeSeconds = Math.floor(new Date(proposal.endTime).getTime() / 1000);
  console.log("Current time:", nowSeconds);
  console.log("Proposal end time:", endTimeSeconds);
  console.log("Duration:", endTimeSeconds - nowSeconds, "seconds");
  console.log("DAO min duration:", daoInfo.min_proposal_time, "seconds");
  console.log("DAO max duration:", daoInfo.max_proposal_time, "seconds");
  console.log(
    "Duration valid:",
    endTimeSeconds - nowSeconds >= daoInfo.min_proposal_time &&
      endTimeSeconds - nowSeconds <= daoInfo.max_proposal_time
  );

  // 10. Final Contract Function Mapping
  console.log("\n🎯 CONTRACT FUNCTION MAPPING:");
  console.log("This transaction will trigger:");
  console.log("  1. proposal.mint() with CreateProposal redeemer");
  console.log(
    "     └─ create_proposal(tx, dao_datum, vote_policy_id, vote_key, policy_id)"
  );
  console.log(
    "        ├─ minimum_staked() - checks vote UTXO has enough governance tokens"
  );
  console.log("        ├─ correct_duration() - checks proposal timing");
  console.log(
    "        └─ single_identifier_minted_into_proposal() - checks minting"
  );
  console.log(
    "  2. dao.spend() should NOT be called (DAO is reference input only)"
  );
  console.log(
    "  3. vote.spend() should NOT be called (Vote is reference input only)"
  );

  console.log("\n==========================================");

  console.log("🔍 VOTE KEY VERIFICATION:");
  console.log("Reference asset name:", userVoteInfo.referenceAssetName);
  console.log("Vote key hex:", voteKeyHex);
  console.log("Expected asset in vote UTXO:", `0000${voteKeyHex}`);
  console.log(
    "Vote policy + expected asset:",
    `${votePolicyId}0000${voteKeyHex}`
  );

  console.log("🔍 Starting transaction build...");
  let txBuilder = blaze.newTransaction().addInput(seedUtxo);
  console.log("✅ Added seed input");

  try {
    txBuilder = txBuilder.addReferenceInput(daoInfo.utxo);
    console.log("✅ Added DAO reference input");

    txBuilder = txBuilder.addReferenceInput(voteUtxo);
    // txBuilder = txBuilder.addInput(voteUtxo, voteRedeemer);
    console.log("✅ Added vote reference input");

    txBuilder = txBuilder.provideScript(proposalScript);
    console.log("✅ Provided proposal script");

    // txBuilder = txBuilder.provideScript(voteScript);
    // console.log("✅ Provided vote script");

    txBuilder = txBuilder.addMint(
      Core.PolicyId(proposalPolicyId),
      proposalMintMap,
      proposalRedeemer
    );
    console.log("✅ Added mint");

    txBuilder = txBuilder.lockAssets(
      proposalScriptAddress,
      proposalValue,
      proposalDatum
    );
    console.log("✅ Added proposal output");

    const currentSlot = getCurrentSlot();
    const validityStart = Core.Slot(Number(currentSlot));
    const validityEnd = Core.Slot(Number(currentSlot) + 3600); // 1 hour from now (3600 seconds = 3600 slots)

    console.log("🔍 SETTING VALIDITY RANGE:");
    console.log("  - Start slot:", Number(currentSlot));
    console.log("  - End slot:", Number(currentSlot + 3600n));

    txBuilder = txBuilder
      .setValidFrom(validityStart)
      .setValidUntil(validityEnd);

    console.log("🔍 Calling complete()...");
  } catch (buildError: any) {
    console.error("❌ Transaction building failed at step:", buildError);
    console.error("Error details:", buildError.message);
    console.error("Error stack:", buildError.stack);
    throw buildError;
  }

  // if (action) {
  //   txBuilder = await addActionToTransaction(
  //     txBuilder,
  //     action,
  //     proposalPolicyId,
  //     proposalIdentifier,
  //     daoInfo,
  //     seedUtxo
  //   );
  // }

  return txBuilder.complete();
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

  const actionIdentifier = getActionIdentifier(
    proposalPolicyId,
    proposalIdentifier,
    0
  );

  const actionDatum = await createActionDatum(
    action,
    proposalPolicyId,
    proposalIdentifier,
    daoInfo
  );

  console.log("🔍 ACTION MINT DEBUG:");
  console.log("Action policy ID:", actionPolicyId);
  console.log("DAO whitelisted actions:", daoInfo.whitelisted_actions);
  console.log(
    "Action whitelisted:",
    daoInfo.whitelisted_actions.includes(actionPolicyId)
  );
  console.log("Proposal policy passed to action:", proposalPolicyId);

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

  console.log("🔍 ACTION REDEEMER DEBUG:");
  console.log("Action redeemer CBOR:", actionRedeemer.toCbor());
  console.log("Seed UTXO for action:", {
    txHash: seedUtxo.input().transactionId(),
    index: seedUtxo.input().index(),
  });

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

  return txBuilder
    .provideScript(actionScript)
    .addMint(Core.PolicyId(actionPolicyId), actionMintMap, actionRedeemer)
    .lockAssets(actionScriptAddress, actionValue, actionDatum);
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

async function createActionDatum(
  action: ActionData,
  proposalPolicyId: string,
  proposalIdentifier: string,
  daoInfo: ExtendedDAOInfo
): Promise<Core.PlutusData> {
  const fieldsList = new Core.PlutusList();

  fieldsList.add(
    Core.PlutusData.newBytes(new TextEncoder().encode(action.name))
  );

  fieldsList.add(
    Core.PlutusData.newBytes(new TextEncoder().encode(action.description))
  );

  // Use milliseconds since Unix epoch, not seconds
  const activationTimeMs = new Date(action.activationTime).getTime();
  fieldsList.add(Core.PlutusData.newInteger(BigInt(activationTimeMs)));

  const actionIdentifierData = Core.PlutusData.newConstrPlutusData(
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
  fieldsList.add(actionIdentifierData);

  fieldsList.add(Core.PlutusData.newInteger(1n));

  const targetsList = new Core.PlutusList();
  for (const target of action.targets) {
    const targetData = createTargetData(target);
    targetsList.add(targetData);
  }
  fieldsList.add(Core.PlutusData.newList(targetsList));

  const treasuryScript = createParameterizedScript("treasury.treasury.spend", [
    daoInfo.policyId,
    daoInfo.key,
  ]);
  const treasuryAddress = addressFromScript(treasuryScript);
  const treasuryAddressBytes = treasuryAddress.toBytes();
  fieldsList.add(Core.PlutusData.newBytes(Core.fromHex(treasuryAddressBytes)));

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

function createTargetData(target: ProposalTarget): Core.PlutusData {
  console.log("🔍 TARGET DATA DEBUG:");
  console.log("Target:", target);
  const fieldsList = new Core.PlutusList();

  const address = Core.addressFromBech32(target.address);
  console.log("Address bytes:", address.toBytes());
  fieldsList.add(Core.PlutusData.newBytes(Core.fromHex(address.toBytes())));

  const adaAsset = target.assets.find((a) => a.unit === "lovelace");
  const coins = adaAsset ? BigInt(adaAsset.quantity) : 0n;
  console.log("Coins:", coins);
  fieldsList.add(Core.PlutusData.newInteger(coins));

  const tokensList = new Core.PlutusList();
  const tokensByPolicy = new Map<string, TokenGroup[]>();

  for (const asset of target.assets) {
    if (asset.unit === "lovelace") continue;
    console.log("Processing asset:", asset);

    const policyId = asset.unit.slice(0, 56);
    const assetName = asset.unit.slice(56);
    console.log("Policy ID:", policyId, "Asset name:", assetName);

    if (!tokensByPolicy.has(policyId)) {
      tokensByPolicy.set(policyId, []);
    }
    tokensByPolicy.get(policyId)!.push({
      name: assetName,
      amount: BigInt(asset.quantity),
    });
  }
  console.log("Tokens by policy:", tokensByPolicy);

  for (const [policyId, assets] of tokensByPolicy) {
    const policyData = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(
        0n,
        (() => {
          const list = new Core.PlutusList();
          list.add(Core.PlutusData.newBytes(Core.fromHex(policyId)));

          const assetsList = new Core.PlutusList();
          for (const asset of assets) {
            const assetData = Core.PlutusData.newConstrPlutusData(
              new Core.ConstrPlutusData(
                0n,
                (() => {
                  const assetList = new Core.PlutusList();
                  assetList.add(
                    Core.PlutusData.newBytes(Core.fromHex(asset.name))
                  );
                  assetList.add(Core.PlutusData.newInteger(asset.amount));
                  return assetList;
                })()
              )
            );
            assetsList.add(assetData);
          }
          list.add(Core.PlutusData.newList(assetsList));
          return list;
        })()
      )
    );
    tokensList.add(policyData);
  }
  fieldsList.add(Core.PlutusData.newList(tokensList));

  const noDatum = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, new Core.PlutusList())
  );
  fieldsList.add(noDatum);

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, fieldsList)
  );
}
