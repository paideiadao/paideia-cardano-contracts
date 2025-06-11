import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core, Provider, Wallet } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  addressFromScript,
  createParameterizedScript,
  getCurrentSlot,
} from "@/lib/server/helpers/script-helpers";
import {
  findUserVoteUtxo,
  getVotePolicyId,
} from "@/lib/server/helpers/vote-helpers";
import { fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";
import { getProposalUtxo } from "@/lib/server/helpers/proposal-helpers";
import { ProposalRedeemer, VoteRedeemer } from "@/lib/scripts/contracts";

interface CastVoteRequest {
  daoPolicyId: string;
  daoKey: string;
  proposalPolicyId: string;
  proposalAssetName: string;
  votedOption: number;
  votePower: number;
  walletAddress: string;
  collateral: any[];
  changeAddress: string;
}

export async function POST(request: NextRequest) {
  try {
    const {
      daoPolicyId,
      daoKey,
      proposalPolicyId,
      proposalAssetName,
      votedOption,
      votePower,
      walletAddress,
      collateral,
      changeAddress,
    }: CastVoteRequest = await request.json();

    if (!collateral?.length) {
      throw new Error("No collateral available, please set it in your wallet");
    }

    const sendAddress = Core.addressFromBech32(walletAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    const votePolicyId = await getVotePolicyId(daoPolicyId, daoKey);
    const userVoteInfo = await findUserVoteUtxo(
      walletAddress,
      votePolicyId,
      daoPolicyId,
      daoKey
    );

    if (!userVoteInfo) {
      throw new Error("You must be registered to vote");
    }

    if (votePower > userVoteInfo.lockedGovernanceTokens) {
      throw new Error(
        `Insufficient voting power. Available: ${userVoteInfo.lockedGovernanceTokens}`
      );
    }

    const proposalUtxo = await getProposalUtxo(
      proposalPolicyId,
      proposalAssetName,
      daoPolicyId,
      daoKey
    );
    if (!proposalUtxo) {
      throw new Error("Proposal UTXO not found");
    }

    // Parse proposal datum manually for now
    const proposalDatum = proposalUtxo.output().datum()?.asInlineData();
    if (!proposalDatum) {
      throw new Error("Proposal UTXO missing datum");
    }

    const currentProposal = parseProposalDatum(proposalDatum);
    if (!currentProposal) {
      throw new Error("Failed to parse proposal datum");
    }

    // Check if proposal is still active
    const now = Date.now();
    if (now > currentProposal.end_time) {
      throw new Error(
        `Proposal has ended. Voting closed at ${new Date(
          currentProposal.end_time
        ).toISOString()}`
      );
    }

    if (currentProposal.status !== "Active") {
      throw new Error(
        `Cannot vote on proposal with status: ${currentProposal.status}`
      );
    }

    // Calculate vote receipt asset name
    const voteReceiptAssetName = createVoteReceiptIdentifier(
      proposalAssetName,
      votedOption
    );

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

    const tx = await buildVoteTransaction(blaze, {
      proposalUtxo,
      seedUtxo,
      proposalPolicyId,
      votedOption,
      votePower,
      voteReceiptAssetName,
      votePolicyId,
      daoPolicyId,
      daoKey,
      daoInfo,
      userVoteInfo,
      currentProposal,
    });

    return NextResponse.json({
      unsignedTx: tx.toCbor(),
      voteReceiptAssetName,
      votePower,
      votedOption,
    });
  } catch (error) {
    console.error("❌ Server-side voting error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build vote transaction",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

function createVoteReceiptIdentifier(
  proposalIdentifier: string,
  index: number
): string {
  const voteReceiptData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalIdentifier)));
        list.add(Core.PlutusData.newInteger(BigInt(index)));
        return list;
      })()
    )
  );
  return Core.blake2b_256(voteReceiptData.toCbor());
}

function parseProposalDatum(datum: Core.PlutusData): {
  name: string;
  description: string;
  tally: number[];
  end_time: number;
  status: string;
  identifier: any;
} | null {
  try {
    const constr = datum.asConstrPlutusData();
    if (!constr || constr.getAlternative() !== 0n) return null;

    const fields = constr.getData();
    if (fields.getLength() < 6) return null;

    const name = new TextDecoder().decode(
      fields.get(0).asBoundedBytes() ?? new Uint8Array()
    );

    const description = new TextDecoder().decode(
      fields.get(1).asBoundedBytes() ?? new Uint8Array()
    );

    const tallyList = fields.get(2).asList();
    const tally: number[] = [];
    if (tallyList) {
      for (let i = 0; i < tallyList.getLength(); i++) {
        tally.push(Number(tallyList.get(i).asInteger() ?? 0n));
      }
    }

    const end_time = Number(fields.get(3).asInteger() ?? 0n);

    const statusConstr = fields.get(4).asConstrPlutusData();
    let status = "Active";
    if (statusConstr) {
      const statusAlt = Number(statusConstr.getAlternative());
      switch (statusAlt) {
        case 0:
          status = "Active";
          break;
        case 1:
          status = "FailedThreshold";
          break;
        case 2:
          status = "FailedQuorum";
          break;
        case 3:
          status = "Passed";
          break;
      }
    }

    const identifier = fields.get(5);

    return {
      name,
      description,
      tally,
      end_time,
      status,
      identifier,
    };
  } catch (error) {
    return null;
  }
}

async function buildVoteTransaction(
  blaze: Blaze<Provider, Wallet>,
  params: {
    proposalUtxo: Core.TransactionUnspentOutput;
    seedUtxo: Core.TransactionUnspentOutput;
    proposalPolicyId: string;
    votedOption: number;
    votePower: number;
    voteReceiptAssetName: string;
    votePolicyId: string;
    daoPolicyId: string;
    daoKey: string;
    daoInfo: any;
    userVoteInfo: any;
    currentProposal: any;
  }
): Promise<Core.Transaction> {
  const {
    proposalUtxo,
    seedUtxo,
    proposalPolicyId,
    votedOption,
    votePower,
    voteReceiptAssetName,
    votePolicyId,
    daoPolicyId,
    daoKey,
    userVoteInfo,
    daoInfo,
    currentProposal,
  } = params;

  // Create scripts
  const proposalSpendScript = createParameterizedScript(
    "proposal.proposal.spend",
    [daoPolicyId, daoKey, votePolicyId]
  );

  const proposalMintScript = createParameterizedScript(
    "proposal.proposal.mint",
    [daoPolicyId, daoKey, votePolicyId]
  );

  const voteSpendScript = createParameterizedScript("vote.vote.spend", [
    daoPolicyId,
    daoKey,
  ]);

  // Find UTXOs
  const voteUtxos = await blaze.provider.getUnspentOutputs(
    addressFromScript(voteSpendScript)
  );

  const voteReferenceAssetId = Core.AssetId.fromParts(
    Core.PolicyId(votePolicyId),
    Core.AssetName(userVoteInfo.referenceAssetName)
  );

  const voteUtxo = voteUtxos.find(
    (utxo) =>
      utxo.output().amount().toCore().assets?.has(voteReferenceAssetId) ?? false
  );

  if (!voteUtxo) {
    throw new Error("Vote UTXO not found");
  }

  const daoUtxos = await blaze.provider.getUnspentOutputs(
    addressFromScript(createParameterizedScript("dao.dao.spend", []))
  );

  const daoAssetId = Core.AssetId.fromParts(
    Core.PolicyId(daoPolicyId),
    Core.AssetName(daoInfo.key)
  );

  const daoUtxo = daoUtxos.find(
    (utxo) => utxo.output().amount().toCore().assets?.has(daoAssetId) ?? false
  );

  if (!daoUtxo) {
    throw new Error("DAO UTXO not found");
  }

  // Update proposal tally
  const newTally = [...currentProposal.tally];
  newTally[votedOption] = Number(newTally[votedOption] || 0) + votePower;

  const updatedProposalDatum = createUpdatedProposalDatum(
    proposalUtxo.output().datum()?.asInlineData()!,
    newTally
  );

  // Try to use generated redeemer types
  let castVoteRedeemer: Core.PlutusData;
  let voteSpendRedeemer: Core.PlutusData;

  try {
    // Try the generated types first
    castVoteRedeemer =
      ProposalRedeemer.CastVote ??
      Core.PlutusData.newConstrPlutusData(
        new Core.ConstrPlutusData(1n, new Core.PlutusList())
      );
    voteSpendRedeemer =
      VoteRedeemer.CastVote ??
      Core.PlutusData.newConstrPlutusData(
        new Core.ConstrPlutusData(1n, new Core.PlutusList())
      );
  } catch {
    // Fall back to manual construction
    castVoteRedeemer = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(1n, new Core.PlutusList())
    );
    voteSpendRedeemer = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(1n, new Core.PlutusList())
    );
  }

  const mintAssets = new Map([
    [Core.AssetName(voteReceiptAssetName), BigInt(votePower)],
  ]);

  const currentSlot = getCurrentSlot();
  const validityStart = Core.Slot(Number(currentSlot));
  const validityEnd = Core.Slot(Number(currentSlot) + 3600);
  // Calculate minimum ADA needed for the vote output with new tokens
  const voteInputValue = voteUtxo.output().amount();
  const voteInputCore = voteInputValue.toCore();

  const receiptAssetId = Core.AssetId.fromParts(
    Core.PolicyId(proposalPolicyId),
    Core.AssetName(voteReceiptAssetName)
  );

  // Create merged assets
  const mergedAssets = new Map(voteInputCore.assets ?? new Map());
  const existingQuantity = mergedAssets.get(receiptAssetId) ?? 0n;
  mergedAssets.set(receiptAssetId, existingQuantity + BigInt(votePower));

  const voteOutputValue = Core.Value.fromCore({
    coins: voteInputCore.coins,
    assets: mergedAssets,
  });

  console.log("🔍 EXACT MERGE MATCH:");
  console.log("Vote input ADA:", voteInputCore.coins);
  console.log("Vote output ADA:", voteInputCore.coins);
  console.log("ADA change:", 0);

  const transaction = await blaze
    .newTransaction()
    .addInput(seedUtxo)
    .addInput(proposalUtxo, castVoteRedeemer)
    .addInput(voteUtxo, voteSpendRedeemer)
    .addReferenceInput(daoUtxo)
    .provideScript(proposalSpendScript)
    .provideScript(proposalMintScript)
    .provideScript(voteSpendScript)
    .addMint(Core.PolicyId(proposalPolicyId), mintAssets, castVoteRedeemer)
    .lockAssets(
      proposalUtxo.output().address(),
      proposalUtxo.output().amount(),
      updatedProposalDatum
    )
    .lockAssets(
      voteUtxo.output().address(),
      voteOutputValue, // Exact merge result - same ADA, added tokens
      voteUtxo.output().datum()?.asInlineData()!
    )
    .setValidFrom(validityStart)
    .setValidUntil(validityEnd)
    .complete();

  return transaction;
}

function createUpdatedProposalDatum(
  originalDatum: Core.PlutusData,
  newTally: number[]
): Core.PlutusData {
  const constr = originalDatum.asConstrPlutusData()!;
  const originalFields = constr.getData();

  const newTallyList = new Core.PlutusList();
  newTally.forEach((votes) => {
    newTallyList.add(Core.PlutusData.newInteger(BigInt(votes)));
  });

  const updatedFields = new Core.PlutusList();
  updatedFields.add(originalFields.get(0)); // name
  updatedFields.add(originalFields.get(1)); // description
  updatedFields.add(Core.PlutusData.newList(newTallyList)); // tally - updated
  updatedFields.add(originalFields.get(3)); // end_time
  updatedFields.add(originalFields.get(4)); // status
  updatedFields.add(originalFields.get(5)); // identifier

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(constr.getAlternative(), updatedFields)
  );
}
