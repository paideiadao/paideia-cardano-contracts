import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  createParameterizedScript,
  getCurrentSlot,
  timestampToSlot,
} from "@/lib/server/helpers/script-helpers";
import {
  findUserVoteUtxo,
  getVotePolicyId,
  getVoteUtxo,
} from "@/lib/server/helpers/vote-helpers";
import { fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";
import {
  getProposalUtxo,
  parseProposalDatum,
  parseRawProposalDatum,
} from "@/lib/server/helpers/proposal-helpers";

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

    // Parse proposal to check if it's still active
    const proposalDatum = proposalUtxo.output().datum()?.asInlineData();
    if (!proposalDatum) {
      throw new Error("Proposal UTXO missing datum");
    }

    const currentProposal = parseProposalDatum(proposalDatum, daoInfo);
    if (!currentProposal) {
      throw new Error("Failed to parse proposal datum");
    }

    // Check if proposal is still active
    const now = Date.now();
    if (now > currentProposal.endTime) {
      throw new Error(
        `Proposal has ended. Voting closed at ${new Date(
          currentProposal.endTime
        ).toISOString()}`
      );
    }

    if (currentProposal.status !== "Active") {
      throw new Error(
        `Cannot vote on proposal with status: ${currentProposal.status}`
      );
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

    console.log("🔍 EXACT VALUE DEBUG:");
    const inputValue = proposalUtxo.output().amount();
    console.log("Input value object:", inputValue);
    console.log("Input value CBOR:", inputValue.toCbor());

    // Test if creating a new identical value changes anything
    const testValue = Core.Value.fromCore(inputValue.toCore());
    console.log("Reconstructed value CBOR:", testValue.toCbor());
    console.log(
      "Values have same CBOR:",
      inputValue.toCbor() === testValue.toCbor()
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

  const proposalDatum = proposalUtxo.output().datum()?.asInlineData();
  if (!proposalDatum) {
    throw new Error("Proposal UTXO missing datum");
  }

  const currentProposal = parseRawProposalDatum(proposalDatum);
  if (!currentProposal) {
    throw new Error("Failed to parse proposal datum");
  }

  const newTally = [...currentProposal.tally];
  newTally[votedOption] = (newTally[votedOption] || 0) + votePower;
  const newProposalDatum = createUpdatedProposalDatum(proposalDatum, newTally);

  const proposalMintScript = createParameterizedScript(
    "proposal.proposal.mint",
    [daoPolicyId, daoKey, votePolicyId]
  );

  const proposalSpendScript = createParameterizedScript(
    "proposal.proposal.spend",
    [daoPolicyId, daoKey, votePolicyId]
  );

  const voteScript = createParameterizedScript("vote.vote.mint", [
    daoPolicyId,
    daoKey,
  ]);

  const castVoteRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(1n, new Core.PlutusList())
  );

  const receiptMintMap: Map<Core.AssetName, bigint> = new Map();
  receiptMintMap.set(Core.AssetName(voteReceiptAssetName), BigInt(votePower));

  const voteDatum = voteUtxo.output().datum()?.asInlineData();
  if (!voteDatum) {
    throw new Error("Vote UTXO missing datum");
  }

  const currentTime = Date.now();
  const validityEndMs = Math.min(
    currentTime + 3600000,
    currentProposal.end_time - 1000
  );
  const validityEndSlot = timestampToSlot(validityEndMs);
  const currentSlot = getCurrentSlot();
  const validityStart = Core.Slot(Number(currentSlot));
  const validityEnd = Core.Slot(Number(validityEndSlot));
  // Calculate the exact output value the contract expects
  const currentVoteValue = voteUtxo.output().amount().toCore();
  console.log("Original input assets map size:", currentVoteValue.assets?.size);

  const newVoteAssets = new Map(currentVoteValue.assets ?? new Map());
  console.log("Copied assets map size:", newVoteAssets.size);

  const receiptAssetId = Core.AssetId.fromParts(
    Core.PolicyId(proposalPolicyId),
    Core.AssetName(voteReceiptAssetName)
  );

  // Add the minted receipt tokens to existing balance
  const existingReceipts = currentVoteValue.assets?.get(receiptAssetId) ?? 0n; // Check ORIGINAL
  console.log("Existing receipts from ORIGINAL:", existingReceipts);

  newVoteAssets.set(receiptAssetId, existingReceipts + BigInt(votePower));
  console.log("After setting in new map:", newVoteAssets.get(receiptAssetId));

  const newVoteValue = Core.Value.fromCore({
    coins: currentVoteValue.coins,
    assets: newVoteAssets,
  });

  // console.log("🔍 POLICY ID VERIFICATION:");
  // console.log("proposalPolicyId used:", proposalPolicyId);
  // console.log("proposalMintScript hash:", proposalMintScript.hash());
  // console.log("proposalSpendScript hash:", proposalSpendScript.hash());
  // console.log(
  //   "Policy IDs match mint script:",
  //   proposalPolicyId === proposalMintScript.hash()
  // );
  // console.log(
  //   "Policy IDs match spend script:",
  //   proposalPolicyId === proposalSpendScript.hash()
  // );

  // console.log("🔍 VOTE MERGE CALCULATION:");
  // console.log("Vote input value:", voteUtxo.output().amount().toCore());
  // console.log("Minted tokens:", {
  //   policyId: proposalPolicyId,
  //   assetName: voteReceiptAssetName,
  //   amount: votePower,
  // });

  // console.log("Receipt asset ID:", receiptAssetId);
  // console.log("Calculated vote output value:", newVoteValue.toCore());
  // console.log("Expected: input + mint = output");
  // console.log("Input coins:", currentVoteValue.coins);
  // console.log("Output coins:", newVoteValue.toCore().coins);
  // console.log(
  //   "Coins match:",
  //   currentVoteValue.coins === newVoteValue.toCore().coins
  // );

  // console.log("🔍 ASSET MATCHING DEBUG:");
  // console.log("Looking for receipt asset:", receiptAssetId);
  // console.log("Vote input assets:");
  // if (currentVoteValue.assets) {
  //   for (const [assetId, quantity] of currentVoteValue.assets) {
  //     console.log(`  ${assetId} = ${quantity}`);
  //     console.log(`  Matches receipt: ${assetId === receiptAssetId}`);
  //   }
  // }
  // console.log("Map.get result:", currentVoteValue.assets?.get(receiptAssetId));
  // console.log("Map.has result:", currentVoteValue.assets?.has(receiptAssetId));

  // console.log("🔍 MINT VS OUTPUT COMPARISON:");
  // console.log("Mint map:");
  // for (const [assetName, quantity] of receiptMintMap) {
  //   console.log(`  ${assetName} = ${quantity}`);
  // }

  // console.log("Vote output assets:");
  // const outputAssets = newVoteValue.toCore().assets;
  // if (outputAssets) {
  //   for (const [assetId, quantity] of outputAssets) {
  //     console.log(`  ${assetId} = ${quantity}`);
  //   }
  // }

  // console.log(
  //   "Receipt asset in mint map:",
  //   receiptMintMap.get(Core.AssetName(voteReceiptAssetName))
  // );
  // console.log("Receipt asset in output:", outputAssets?.get(receiptAssetId));
  // console.log("🔍 CONTRACT MERGE COMPARISON:");
  // console.log("Vote input address:", voteUtxo.output().address().toBech32());
  // console.log("Vote output address:", voteUtxo.output().address().toBech32());

  // console.log("Vote input datum CBOR:", voteDatum.toCbor());
  // console.log("Vote output datum CBOR:", voteDatum.toCbor());

  // // The critical comparison - manual value comparison
  // const inputValue = voteUtxo.output().amount().toCore();
  // const actualOutput = newVoteValue.toCore();

  // console.log("Input coins:", inputValue.coins);
  // console.log("Output coins:", actualOutput.coins);
  // console.log("Coins match:", inputValue.coins === actualOutput.coins);

  // console.log("Input assets count:", inputValue.assets?.size ?? 0);
  // console.log("Output assets count:", actualOutput.assets?.size ?? 0);

  // // Check if output has exactly input assets + 1 new receipt
  // const expectedAssetCount = (inputValue.assets?.size ?? 0) + 1;
  // console.log("Expected asset count:", expectedAssetCount);
  // console.log(
  //   "Asset count matches:",
  //   (actualOutput.assets?.size ?? 0) === expectedAssetCount
  // );

  // // Verify each input asset exists in output with same quantity
  // let allInputAssetsMatch = true;
  // if (inputValue.assets) {
  //   for (const [assetId, quantity] of inputValue.assets) {
  //     const outputQuantity = actualOutput.assets?.get(assetId);
  //     if (outputQuantity !== quantity) {
  //       console.log(
  //         `❌ Asset mismatch: ${assetId} input=${quantity} output=${outputQuantity}`
  //       );
  //       allInputAssetsMatch = false;
  //     }
  //   }
  // }
  // console.log("All input assets preserved:", allInputAssetsMatch);

  // // Check the new receipt token
  // const receiptInOutput = actualOutput.assets?.get(receiptAssetId);
  // console.log("Receipt token in output:", receiptInOutput);
  // console.log("Receipt token correct:", receiptInOutput === BigInt(votePower));

  // console.log("🔍 VOTE SCRIPT VERIFICATION:");
  // console.log("Vote script hash:", voteScript.hash());
  // console.log("Vote policy ID used:", votePolicyId);
  // console.log("Vote script hashes match:", voteScript.hash() === votePolicyId);

  // console.log("Vote input address credential:");
  // const inputAddress = voteUtxo.output().address();
  // console.log("  Input address:", inputAddress.toBech32());

  // console.log("Vote output will be locked to:");
  // console.log("  Same address:", voteUtxo.output().address().toBech32());

  console.log("🔍 UTXO_UNCHANGED_EXCEPT_TALLY DEBUG:");

  // 1. Address comparison
  const inputAddress = proposalUtxo.output().address().toBech32();
  const outputAddress = proposalUtxo.output().address().toBech32(); // Should be same
  console.log("1. ADDRESS COMPARISON:");
  console.log("   input.address:", inputAddress);
  console.log("   output.address:", outputAddress);
  console.log("   SHOULD BE: identical");
  console.log("   ACTUAL:", inputAddress === outputAddress);

  // 2. Value comparison
  const inputValue = proposalUtxo.output().amount().toCore();
  const outputValue = proposalUtxo.output().amount().toCore(); // Should be same
  console.log("2. VALUE COMPARISON:");
  console.log("   input.value coins:", inputValue.coins);
  console.log("   output.value coins:", outputValue.coins);
  console.log("   input.value assets:", inputValue.assets?.size ?? 0);
  console.log("   output.value assets:", outputValue.assets?.size ?? 0);
  console.log("   SHOULD BE: identical coins and assets");
  console.log("   ACTUAL coins match:", inputValue.coins === outputValue.coins);

  // 3. Datum comparison (the critical one)
  const inputDatum = proposalDatum; // Original
  const outputDatum = newProposalDatum; // Modified
  console.log("3. DATUM COMPARISON (after stripping tally):");

  // Parse both and show what contract sees when it strips tally
  const inputParsed = parseRawProposalDatum(inputDatum);
  const outputParsed = parseRawProposalDatum(outputDatum);

  console.log(
    "   Contract will create input_without_tally = { ...input_datum, tally: [] }"
  );
  console.log(
    "   Contract will create output_without_tally = { ...output_datum, tally: [] }"
  );
  console.log("   Then compare: input_without_tally == output_without_tally");

  console.log("   INPUT datum (original):");
  console.log("     name:", inputParsed?.name);
  console.log("     description:", inputParsed?.description);
  console.log("     tally:", inputParsed?.tally, "(will be stripped to [])");
  console.log("     end_time:", inputParsed?.end_time);
  console.log("     status CBOR:", inputParsed?.status?.toCbor());
  console.log("     identifier CBOR:", inputParsed?.identifier?.toCbor());

  console.log("   OUTPUT datum (modified):");
  console.log("     name:", outputParsed?.name);
  console.log("     description:", outputParsed?.description);
  console.log("     tally:", outputParsed?.tally, "(will be stripped to [])");
  console.log("     end_time:", outputParsed?.end_time);
  console.log("     status CBOR:", outputParsed?.status?.toCbor());
  console.log("     identifier CBOR:", outputParsed?.identifier?.toCbor());

  console.log("   SHOULD BE: all fields except tally identical");
  console.log("   ACTUAL field matches:");
  console.log("     name:", inputParsed?.name === outputParsed?.name);
  console.log(
    "     description:",
    inputParsed?.description === outputParsed?.description
  );
  console.log(
    "     end_time:",
    inputParsed?.end_time === outputParsed?.end_time
  );
  console.log(
    "     status:",
    inputParsed?.status?.toCbor() === outputParsed?.status?.toCbor()
  );
  console.log(
    "     identifier:",
    inputParsed?.identifier?.toCbor() === outputParsed?.identifier?.toCbor()
  );

  return blaze
    .newTransaction()
    .addInput(proposalUtxo, castVoteRedeemer) // Proposal as INPUT, not reference
    .addInput(voteUtxo, castVoteRedeemer) // Vote as INPUT
    .addReferenceInput(daoInfo.utxo) // Only DAO as reference
    .provideScript(proposalMintScript) // For minting receipt tokens
    .provideScript(proposalSpendScript) // For spending proposal UTXO
    .provideScript(voteScript) // For spending vote UTXO
    .addMint(Core.PolicyId(proposalPolicyId), receiptMintMap, castVoteRedeemer)
    .lockAssets(
      proposalUtxo.output().address(),
      proposalUtxo.output().amount(),
      newProposalDatum // Updated proposal with new tally
    )
    .lockAssets(
      voteUtxo.output().address(),
      newVoteValue, // Vote output with receipt tokens
      voteDatum
    )
    .setValidFrom(validityStart)
    .setValidUntil(validityEnd)
    .complete();
}

function createUpdatedProposalDatum(
  originalDatum: Core.PlutusData,
  newTally: number[]
): Core.PlutusData {
  const constr = originalDatum.asConstrPlutusData()!;
  const originalFields = constr.getData();

  // Create new tally list
  const newTallyList = new Core.PlutusList();
  newTally.forEach((votes) => {
    newTallyList.add(Core.PlutusData.newInteger(BigInt(votes)));
  });

  // Use EXACT original field objects, don't reconstruct them
  const updatedFields = new Core.PlutusList();
  updatedFields.add(originalFields.get(0)); // name - original object
  updatedFields.add(originalFields.get(1)); // description - original object
  updatedFields.add(Core.PlutusData.newList(newTallyList)); // tally - only this is new
  updatedFields.add(originalFields.get(3)); // end_time - original object
  updatedFields.add(originalFields.get(4)); // status - original object
  updatedFields.add(originalFields.get(5)); // identifier - original object

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(constr.getAlternative(), updatedFields)
  );
}
