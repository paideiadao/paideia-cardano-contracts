import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { getDaoUtxo, fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";
import { getEndedProposalUtxos } from "@/lib/server/helpers/proposal-helpers";
import {
  getVoteUtxo,
  findVoteNftUtxo,
  countGovernanceTokensInVoteUtxo,
  createVoteScript,
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
  endedVoteReceipts?: Array<{
    assetName: string;
    proposalPolicyId: string;
    amount: number;
  }>;
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

    // Refresh all UTXO queries to avoid stale references
    const userUtxos = await blazeMaestroProvider.getUnspentOutputs(sendAddress);
    const voteNftUtxo = findVoteNftUtxo(userUtxos, voteNftAssetName);

    if (!voteNftUtxo) {
      throw new Error("Vote NFT not found in wallet");
    }

    const voteUtxo = await getVoteUtxo(daoPolicyId, daoKey, voteUtxoRef);
    if (!voteUtxo) {
      throw new Error("Vote UTXO not found or already spent");
    }

    // Verify vote receipts exist in the vote UTXO
    const actualReceipts = validateVoteReceipts(voteUtxo, endedVoteReceipts);

    const voteScript = await createVoteScript(daoPolicyId, daoKey);
    const votePolicyId = voteScript.hash();

    console.debug(`🔑 Vote Policy ID: ${votePolicyId}`);

    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    const govTokenHex = daoInfo.governance_token;
    const govPolicyId = govTokenHex.slice(0, 56);
    const govAssetName = govTokenHex.slice(56);

    const governanceTokenAmount = await countGovernanceTokensInVoteUtxo(
      voteUtxo,
      govPolicyId,
      govAssetName
    );

    console.debug(`💰 Returning ${governanceTokenAmount} governance tokens`);

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
      endedVoteReceipts: actualReceipts,
      receiveAddress,
      daoInfo,
    });

    console.debug("✅ Unregister transaction built successfully");

    return NextResponse.json({
      unsignedTx: tx.toCbor(),
      governanceTokensReturned: governanceTokenAmount,
      receiptsCleaned: actualReceipts.length,
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

function validateVoteReceipts(
  voteUtxo: Core.TransactionUnspentOutput,
  requestedReceipts: Array<{
    assetName: string;
    proposalPolicyId: string;
    amount: number;
  }>
): Array<{
  assetName: string;
  proposalPolicyId: string;
  amount: number;
}> {
  const voteValue = voteUtxo.output().amount().toCore();
  const actualReceipts: Array<{
    assetName: string;
    proposalPolicyId: string;
    amount: number;
  }> = [];

  if (!voteValue.assets) {
    return actualReceipts;
  }

  for (const requestedReceipt of requestedReceipts) {
    for (const [assetId, quantity] of voteValue.assets) {
      const policyId = Core.AssetId.getPolicyId(assetId);
      const assetName = Core.AssetId.getAssetName(assetId);

      if (
        policyId === requestedReceipt.proposalPolicyId &&
        assetName === requestedReceipt.assetName
      ) {
        actualReceipts.push({
          assetName,
          proposalPolicyId: policyId,
          amount: Number(quantity),
        });
        break;
      }
    }
  }

  return actualReceipts;
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
    endedVoteReceipts: Array<{
      assetName: string;
      proposalPolicyId: string;
      amount: number;
    }>;
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

  const voteSpendRedeemer =
    endedVoteReceipts.length === 0
      ? Core.PlutusData.newConstrPlutusData(
          new Core.ConstrPlutusData(3n, new Core.PlutusList())
        ) // EmptyVote
      : Core.PlutusData.newConstrPlutusData(
          new Core.ConstrPlutusData(2n, new Core.PlutusList())
        ); // CleanReceipts

  const voteMintRedeemer =
    endedVoteReceipts.length === 0
      ? Core.PlutusData.newConstrPlutusData(
          new Core.ConstrPlutusData(3n, new Core.PlutusList())
        ) // EmptyVote
      : Core.PlutusData.newConstrPlutusData(
          new Core.ConstrPlutusData(2n, new Core.PlutusList())
        ); // CleanReceipts

  const cleanReceiptsRedeemer = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(2n, new Core.PlutusList())
  );

  // Vote policy burns (reference + NFT tokens)
  const voteBurnMap: Map<Core.AssetName, bigint> = new Map();
  voteBurnMap.set(Core.AssetName(voteNftAssetName), -1n);
  voteBurnMap.set(Core.AssetName(referenceAssetName), -1n);

  // Group vote receipts by proposal policy
  const receiptsByPolicy = new Map<
    string,
    Array<{ assetName: string; amount: number }>
  >();

  for (const receipt of endedVoteReceipts) {
    const existing = receiptsByPolicy.get(receipt.proposalPolicyId) ?? [];
    existing.push({
      assetName: receipt.assetName,
      amount: receipt.amount,
    });
    receiptsByPolicy.set(receipt.proposalPolicyId, existing);
  }

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
    .addInput(voteNftUtxo)
    .addInput(voteUtxo, voteSpendRedeemer)
    .provideScript(voteScript)
    .addMint(Core.PolicyId(votePolicyId), voteBurnMap, voteMintRedeemer);

  const daoUtxo = await getDaoUtxo(daoInfo.policyId, daoInfo.key);
  if (daoUtxo) {
    txBuilder = txBuilder.addReferenceInput(daoUtxo);
  }

  if (endedVoteReceipts.length === 0) {
    // No receipts to clean, just do the basic unregister
    return txBuilder.payAssets(receiveAddress, returnValue).complete();
  }

  // Only add proposal policy burns and reference inputs if we actually have receipts to clean
  const proposalUtxos = await getEndedProposalUtxos(
    Array.from(receiptsByPolicy.keys()),
    endedVoteReceipts.map((r) => r.assetName),
    daoInfo
  );

  for (const proposalUtxo of proposalUtxos) {
    txBuilder = txBuilder.addReferenceInput(proposalUtxo);
  }

  // Add burns for each proposal policy
  for (const [proposalPolicyId, receipts] of receiptsByPolicy) {
    const proposalBurnMap: Map<Core.AssetName, bigint> = new Map();

    for (const receipt of receipts) {
      proposalBurnMap.set(
        Core.AssetName(receipt.assetName),
        BigInt(-receipt.amount)
      );
    }

    txBuilder = txBuilder.addMint(
      Core.PolicyId(proposalPolicyId),
      proposalBurnMap,
      cleanReceiptsRedeemer
    );
  }

  return txBuilder.payAssets(receiveAddress, returnValue).complete();
}
