import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { getDaoUtxo, fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";
import { getEndedProposalUtxos } from "@/lib/server/helpers/proposal-helpers";
import {
  getVoteUtxo,
  createVoteScript,
  findVoteNftUtxo,
  countGovernanceTokensInVoteUtxo,
} from "@/lib/server/helpers/vote-helpers";

interface UnregisterExecuteRequest {
  daoPolicyId: string;
  daoKey: string;
  walletAddress: string;
  changeAddress: string;
  collateral: any[];
  voteUtxoRef: {
    txHash: string;
    outputIndex: number;
  };
  voteNftAssetName: string;
  referenceAssetName: string;
  endedVoteReceipts?: string[]; // Asset names of receipts to clean
}

export async function POST(request: NextRequest) {
  try {
    const {
      daoPolicyId,
      daoKey,
      walletAddress,
      changeAddress,
      collateral,
      voteUtxoRef,
      voteNftAssetName,
      referenceAssetName,
      endedVoteReceipts = [],
    }: UnregisterExecuteRequest = await request.json();

    if (!collateral?.length) {
      throw new Error("No collateral available, please set it in your wallet");
    }

    console.debug(`📝 Unregistering from DAO: ${daoPolicyId}`);
    console.debug(
      `🗳️ Vote UTXO: ${voteUtxoRef.txHash}#${voteUtxoRef.outputIndex}`
    );

    const sendAddress = Core.addressFromBech32(walletAddress);
    const receiveAddress = Core.addressFromBech32(changeAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    // Get user's Vote NFT from wallet
    const userUtxos = await blazeMaestroProvider.getUnspentOutputs(sendAddress);
    const voteNftUtxo = findVoteNftUtxo(userUtxos, voteNftAssetName);

    if (!voteNftUtxo) {
      throw new Error("Vote NFT not found in wallet");
    }

    // Get Vote UTXO from script address
    const voteUtxo = await getVoteUtxo(daoPolicyId, daoKey, voteUtxoRef);
    if (!voteUtxo) {
      throw new Error("Vote UTXO not found");
    }

    // Create vote script and get policy ID
    const voteScript = await createVoteScript(daoPolicyId, daoKey);
    const votePolicyId = voteScript.hash();

    console.debug(`🔑 Vote Policy ID: ${votePolicyId}`);

    // Get DAO info for governance token details
    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    const govTokenHex = daoInfo.governance_token;
    const govPolicyId = govTokenHex.slice(0, 56);
    const govAssetName = govTokenHex.slice(56);

    // Count governance tokens to return
    const governanceTokenAmount = await countGovernanceTokensInVoteUtxo(
      voteUtxo,
      govPolicyId,
      govAssetName
    );

    console.debug(`💰 Returning ${governanceTokenAmount} governance tokens`);

    // Build transaction
    const tx = await buildUnregisterTransaction(blaze, {
      voteNftUtxo,
      voteUtxo,
      voteScript,
      votePolicyId,
      voteNftAssetName,
      referenceAssetName,
      govPolicyId,
      govAssetName,
      governanceTokenAmount,
      endedVoteReceipts,
      receiveAddress,
      daoInfo,
    });

    console.debug("✅ Unregister transaction built successfully");

    return NextResponse.json({
      unsignedTx: tx.toCbor(),
      governanceTokensReturned: governanceTokenAmount,
      receiptsCleaned: endedVoteReceipts.length,
    });
  } catch (error) {
    console.error("❌ Server-side unregister error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build unregister transaction",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

async function buildUnregisterTransaction(
  blaze: Blaze<any, any>,
  params: {
    voteNftUtxo: Core.TransactionUnspentOutput;
    voteUtxo: Core.TransactionUnspentOutput;
    voteScript: Core.Script;
    votePolicyId: string;
    voteNftAssetName: string;
    referenceAssetName: string;
    govPolicyId: string;
    govAssetName: string;
    governanceTokenAmount: number;
    endedVoteReceipts: string[];
    receiveAddress: Core.Address;
    daoInfo: any;
  }
): Promise<Core.Transaction> {
  const {
    voteNftUtxo,
    voteUtxo,
    voteScript,
    votePolicyId,
    voteNftAssetName,
    referenceAssetName,
    govPolicyId,
    govAssetName,
    governanceTokenAmount,
    endedVoteReceipts,
    receiveAddress,
    daoInfo,
  } = params;

  // Create EmptyVote redeemer for spending Vote UTXO
  const emptyVoteSpendRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(3n, new Core.PlutusList()) // EmptyVote = constructor 3
  );

  // Create EmptyVote redeemer for minting (burning NFTs)
  const emptyVoteMintRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(3n, new Core.PlutusList()) // EmptyVote = constructor 3
  );

  // Create burn map for Vote NFTs
  const burnMap: Map<Core.AssetName, bigint> = new Map();
  burnMap.set(Core.AssetName(voteNftAssetName), -1n);
  burnMap.set(Core.AssetName(referenceAssetName), -1n);

  // Add ended vote receipts to burn map if any
  for (const receiptAssetName of endedVoteReceipts) {
    // Find which proposal policy this receipt belongs to
    for (const proposalPolicyId of daoInfo.whitelisted_proposals) {
      // Note: In a full implementation, we'd need to verify this receipt
      // actually belongs to an ended proposal from this policy
      burnMap.set(Core.AssetName(receiptAssetName), -1n);
    }
  }

  // Create value to return to user (governance tokens)
  const returnValue = Core.Value.fromCore({
    coins: 0n,
    assets: new Map([
      [
        Core.AssetId.fromParts(
          Core.PolicyId(govPolicyId),
          Core.AssetName(govAssetName)
        ),
        BigInt(governanceTokenAmount),
      ],
    ]),
  });

  let txBuilder = blaze
    .newTransaction()
    .addInput(voteNftUtxo) // User's Vote NFT
    .addInput(voteUtxo, emptyVoteSpendRedeemer) // Vote UTXO from script
    .provideScript(voteScript)
    .addMint(Core.PolicyId(votePolicyId), burnMap, emptyVoteMintRedeemer);

  // Add DAO as reference input for vote receipt validation
  const daoUtxo = await getDaoUtxo(daoInfo.policyId, daoInfo.key);
  if (daoUtxo) {
    txBuilder = txBuilder.addReferenceInput(daoUtxo);
  }

  // If cleaning ended vote receipts, we need proposal references too
  if (endedVoteReceipts.length > 0) {
    const proposalUtxos = await getEndedProposalUtxos(
      daoInfo.whitelisted_proposals,
      endedVoteReceipts
    );
    for (const proposalUtxo of proposalUtxos) {
      txBuilder = txBuilder.addReferenceInput(proposalUtxo);
    }
  }

  return txBuilder.payAssets(receiveAddress, returnValue).complete();
}
