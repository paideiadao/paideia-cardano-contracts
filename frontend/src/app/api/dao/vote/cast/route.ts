import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  createParameterizedScript,
  addressFromScript,
  getCurrentSlot,
} from "@/lib/server/helpers/script-helpers";
import {
  findUserVoteUtxo,
  getVotePolicyId,
  getVoteUtxo,
  createVoteScript,
} from "@/lib/server/helpers/vote-helpers";
import { fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";
import { getProposalUtxo } from "@/lib/server/helpers/proposal-helpers";

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

    console.debug(
      `📝 Casting vote: Option ${votedOption} with ${votePower} power`
    );

    const sendAddress = Core.addressFromBech32(walletAddress);
    const receiveAddress = Core.addressFromBech32(changeAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    // Get DAO info for governance token details
    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);

    // Get user's vote info
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

    // Get current proposal and vote UTXOs
    const proposalUtxo = await getProposalUtxo(
      proposalPolicyId,
      proposalAssetName,
      daoPolicyId,
      daoKey
    );
    if (!proposalUtxo) {
      throw new Error("Proposal UTXO not found");
    }

    const voteUtxo = await getVoteUtxo(daoPolicyId, daoKey, userVoteInfo.utxo);
    if (!voteUtxo) {
      throw new Error("Vote UTXO not found");
    }

    // Calculate vote receipt asset name
    const voteReceiptAssetName = getVoteReceiptIdentifier(
      proposalAssetName,
      votedOption
    );

    // Build the voting transaction
    const tx = await buildVoteTransaction(blaze, {
      proposalUtxo,
      voteUtxo,
      daoInfo,
      proposalPolicyId,
      proposalAssetName,
      votedOption,
      votePower,
      voteReceiptAssetName,
      votePolicyId,
      daoPolicyId,
      daoKey,
      receiveAddress,
    });

    console.debug("✅ Vote transaction built successfully");

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

function getVoteReceiptIdentifier(
  proposalIdentifier: string,
  optionIndex: number
): string {
  // Recreate VoteReceiptIdentifier structure from the contract
  const voteReceiptData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalIdentifier)));
        list.add(Core.PlutusData.newInteger(BigInt(optionIndex)));
        return list;
      })()
    )
  );

  return Core.blake2b_256(voteReceiptData.toCbor());
}

async function buildVoteTransaction(
  blaze: Blaze<any, any>,
  params: {
    proposalUtxo: Core.TransactionUnspentOutput;
    voteUtxo: Core.TransactionUnspentOutput;
    daoInfo: any;
    proposalPolicyId: string;
    proposalAssetName: string;
    votedOption: number;
    votePower: number;
    voteReceiptAssetName: string;
    votePolicyId: string;
    daoPolicyId: string;
    daoKey: string;
    receiveAddress: Core.Address;
  }
): Promise<Core.Transaction> {
  const {
    proposalUtxo,
    voteUtxo,
    daoInfo,
    proposalPolicyId,
    votedOption,
    votePower,
    voteReceiptAssetName,
    votePolicyId,
    daoPolicyId,
    daoKey,
  } = params;

  // Parse current proposal datum to update tally
  const proposalDatum = proposalUtxo.output().datum()?.asInlineData();
  if (!proposalDatum) {
    throw new Error("Proposal UTXO missing datum");
  }

  const currentProposal = parseProposalDatum(proposalDatum);
  if (!currentProposal) {
    throw new Error("Failed to parse proposal datum");
  }

  // Update tally
  const newTally = [...currentProposal.tally];
  newTally[votedOption] = (newTally[votedOption] || 0) + votePower;

  // Create updated proposal datum
  const newProposalDatum = createUpdatedProposalDatum(
    proposalDatum, // Pass the original PlutusData
    newTally
  );

  // Create vote and proposal scripts
  const voteScript = await createVoteScript(daoPolicyId, daoKey);
  const proposalScript = createParameterizedScript("proposal.proposal.spend", [
    daoPolicyId,
    daoKey,
    votePolicyId,
  ]);

  // Create redeemers
  const castVoteRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(1n, new Core.PlutusList()) // CastVote
  );

  // Create mint map for vote receipt
  const receiptMintMap: Map<Core.AssetName, bigint> = new Map();
  receiptMintMap.set(Core.AssetName(voteReceiptAssetName), BigInt(votePower));

  // Calculate new vote UTXO value (add vote receipt tokens)
  const currentVoteValue = voteUtxo.output().amount().toCore();
  const newVoteAssets = new Map(currentVoteValue.assets);

  const receiptAssetId = Core.AssetId.fromParts(
    Core.PolicyId(proposalPolicyId),
    Core.AssetName(voteReceiptAssetName)
  );

  const existingReceipts = newVoteAssets.get(receiptAssetId) ?? 0n;
  newVoteAssets.set(receiptAssetId, existingReceipts + BigInt(votePower));

  const newVoteValue = Core.Value.fromCore({
    coins: currentVoteValue.coins,
    assets: newVoteAssets,
  });

  // Calculate new proposal UTXO value (unchanged)
  const proposalValue = proposalUtxo.output().amount();

  // Get current vote datum
  const voteDatum = voteUtxo.output().datum()?.asInlineData();
  if (!voteDatum) {
    throw new Error("Vote UTXO missing datum");
  }

  const currentSlot = getCurrentSlot();
  const validityStart = Core.Slot(Number(currentSlot));
  const validityEnd = Core.Slot(Number(currentSlot) + 3600);

  return blaze
    .newTransaction()
    .addInput(proposalUtxo, castVoteRedeemer)
    .addInput(voteUtxo, castVoteRedeemer)
    .addReferenceInput(daoInfo.utxo)
    .provideScript(proposalScript)
    .provideScript(voteScript)
    .addMint(Core.PolicyId(proposalPolicyId), receiptMintMap, castVoteRedeemer)
    .lockAssets(
      proposalUtxo.output().address(),
      proposalValue,
      newProposalDatum
    )
    .lockAssets(voteUtxo.output().address(), newVoteValue, voteDatum)
    .setValidFrom(validityStart)
    .setValidUntil(validityEnd)
    .complete();
}

function parseProposalDatum(datum: Core.PlutusData): {
  name: string;
  description: string;
  tally: number[];
  end_time: number;
  status: any;
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
    const status = fields.get(4);
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

function createUpdatedProposalDatum(
  originalDatum: Core.PlutusData,
  newTally: number[]
): Core.PlutusData {
  const constr = originalDatum.asConstrPlutusData()!;
  const fields = constr.getData();

  // Only change the tally field (index 2)
  const newTallyList = new Core.PlutusList();
  for (const votes of newTally) {
    newTallyList.add(Core.PlutusData.newInteger(BigInt(votes)));
  }

  const newFields = new Core.PlutusList();
  for (let i = 0; i < fields.getLength(); i++) {
    if (i === 2) {
      newFields.add(Core.PlutusData.newList(newTallyList));
    } else {
      newFields.add(fields.get(i));
    }
  }

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(constr.getAlternative(), newFields)
  );
}
