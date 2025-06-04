import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript } from "@blaze-cardano/uplc";
import plutusJson from "@/lib/scripts/plutus.json";
import {
  GovernanceTokenInfo,
  DAOConfig,
} from "@/lib/stores/dao-creation-store";
import { addressFromScript } from "@/lib/server/helpers/script-helpers";

interface DeployDAORequest {
  governanceToken: GovernanceTokenInfo;
  daoConfig: DAOConfig;
  walletAddress: string;
  collateral: any[];
  // changeAddress: string;
}

export async function POST(request: NextRequest) {
  try {
    const {
      governanceToken,
      daoConfig,
      walletAddress,
      collateral,
    }: // changeAddress,
    DeployDAORequest = await request.json();

    if (!collateral?.length) {
      throw new Error("No collateral available, please set it in your wallet");
    }

    console.debug(`📝 Deploying DAO: ${daoConfig.name}`);
    console.debug(
      `🪙 Governance Token: ${governanceToken.name} (${governanceToken.symbol})`
    );

    // Setup addresses and wallet
    const sendAddress = Core.addressFromBech32(walletAddress);
    // const receiveAddress = Core.addressFromBech32(changeAddress);
    const wallet = new ColdWallet(sendAddress, 0, blazeMaestroProvider);
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    // Get UTXOs from wallet
    const utxos = await blazeMaestroProvider.getUnspentOutputs(sendAddress);

    if (!utxos?.length) {
      throw new Error(
        "No UTXOs found in wallet. Please add some ADA to your wallet first."
      );
    }

    const firstUtxo = utxos[0];
    console.debug(
      `📦 Using UTxO: ${firstUtxo.input().transactionId()}#${firstUtxo
        .input()
        .index()}`
    );

    // Load and create all required validators
    const daoValidator = plutusJson.validators.find(
      (v) => v.title === "dao.dao.mint"
    );
    const proposalValidator = plutusJson.validators.find(
      (v) => v.title === "proposal.proposal.mint"
    );
    const actionSendFundsValidator = plutusJson.validators.find(
      (v) => v.title === "action_send_funds.action_send_funds.mint"
    );

    if (!daoValidator || !proposalValidator || !actionSendFundsValidator) {
      throw new Error("Required validators not found in plutus.json");
    }

    console.debug("🔧 Creating validator scripts and extracting policy IDs");

    // Create scripts and get their policy IDs (hashes)
    const daoScript = cborToScript(daoValidator.compiledCode, "PlutusV3");
    const proposalScript = cborToScript(
      proposalValidator.compiledCode,
      "PlutusV3"
    );
    const actionSendFundsScript = cborToScript(
      actionSendFundsValidator.compiledCode,
      "PlutusV3"
    );

    const daoPolicyId = daoScript.hash();
    const proposalPolicyId = proposalScript.hash();
    const actionSendFundsPolicyId = actionSendFundsScript.hash();

    console.debug(`🔑 DAO Policy ID: ${daoPolicyId}`);
    console.debug(`🔑 Proposal Policy ID: ${proposalPolicyId}`);
    console.debug(`🔑 Action Send Funds Policy ID: ${actionSendFundsPolicyId}`);

    // Create unique DAO identifier from first UTXO
    const outputRefData = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(
        0n,
        (() => {
          const list = new Core.PlutusList();
          list.add(
            Core.PlutusData.newBytes(
              Core.fromHex(firstUtxo.input().transactionId())
            )
          );
          list.add(
            Core.PlutusData.newInteger(BigInt(firstUtxo.input().index()))
          );
          return list;
        })()
      )
    );

    const outputRefCbor = outputRefData.toCbor();
    const daoKey = Core.blake2b_256(outputRefCbor);

    console.debug(`🔑 DAO Key: ${daoKey}`);
    console.debug(`🔑 DAO Key length: ${daoKey.length / 2} bytes`);

    // Create DAO datum with populated whitelists
    const daoDatum = createDAODatum(
      governanceToken,
      daoConfig,
      proposalPolicyId,
      actionSendFundsPolicyId
    );

    // Create DAO redeemer (CreateDAO with output reference)
    const daoRedeemer = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(
        0n,
        (() => {
          const list = new Core.PlutusList();
          list.add(outputRefData);
          return list;
        })()
      )
    );

    // Create mint map for DAO identifier
    const mintMap: Map<Core.AssetName, bigint> = new Map();
    mintMap.set(Core.AssetName(daoKey), 1n);

    // Create DAO output value (minimum ADA + DAO identifier NFT)
    const daoValue = Core.Value.fromCore({
      coins: 0n, // Let Blaze calculate minimum ADA
      assets: new Map([
        [
          Core.AssetId.fromParts(
            Core.PolicyId(daoPolicyId),
            Core.AssetName(daoKey)
          ),
          1n,
        ],
      ]),
    });

    console.debug("🏗️ Building DAO deployment transaction");

    // Build transaction
    const tx = await blaze
      .newTransaction()
      .addInput(firstUtxo)
      .provideScript(daoScript)
      .addMint(Core.PolicyId(daoPolicyId), mintMap, daoRedeemer)
      .lockAssets(addressFromScript(daoScript), daoValue, daoDatum)
      .complete();

    console.debug("✅ DAO deployment transaction built successfully");

    return NextResponse.json({
      unsignedTx: tx.toCbor(),
      daoPolicyId,
      daoKey,
    });
  } catch (error) {
    console.error("❌ Server-side DAO deployment error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build deployment transaction",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

function createDAODatum(
  governanceToken: GovernanceTokenInfo,
  daoConfig: DAOConfig,
  proposalPolicyId: string,
  actionSendFundsPolicyId: string
): Core.PlutusData {
  console.debug("📋 Creating DAO datum with whitelisted validators");

  const fieldsList = new Core.PlutusList();

  // name: String (as bytes)
  fieldsList.add(
    Core.PlutusData.newBytes(new TextEncoder().encode(daoConfig.name))
  );

  // governance_token: ByteArray (policy_id + asset_name concatenated)
  const govTokenBytes = Core.fromHex(
    governanceToken.policyId + governanceToken.assetName
  );
  fieldsList.add(Core.PlutusData.newBytes(govTokenBytes));

  // threshold: Int
  fieldsList.add(Core.PlutusData.newInteger(BigInt(daoConfig.threshold)));

  // min_proposal_time: Int (convert minutes to seconds)
  fieldsList.add(
    Core.PlutusData.newInteger(BigInt(daoConfig.minProposalTime * 60))
  );

  // max_proposal_time: Int (convert minutes to seconds)
  fieldsList.add(
    Core.PlutusData.newInteger(BigInt(daoConfig.maxProposalTime * 60))
  );

  // quorum: Int
  fieldsList.add(Core.PlutusData.newInteger(BigInt(daoConfig.quorum)));

  // min_gov_proposal_create: Int
  fieldsList.add(
    Core.PlutusData.newInteger(BigInt(daoConfig.minGovProposalCreate))
  );

  // whitelisted_proposals: List<ByteArray> - Add proposal validator policy ID
  const proposalsList = new Core.PlutusList();
  proposalsList.add(Core.PlutusData.newBytes(Core.fromHex(proposalPolicyId)));
  fieldsList.add(Core.PlutusData.newList(proposalsList));

  // whitelisted_actions: List<ByteArray> - Add action send funds validator policy ID
  const actionsList = new Core.PlutusList();
  actionsList.add(
    Core.PlutusData.newBytes(Core.fromHex(actionSendFundsPolicyId))
  );
  fieldsList.add(Core.PlutusData.newList(actionsList));

  console.debug(`✅ Whitelisted proposal policy: ${proposalPolicyId}`);
  console.debug(`✅ Whitelisted action policy: ${actionSendFundsPolicyId}`);

  // Return as Constructor 0 (DAODatum is a single constructor type)
  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, fieldsList)
  );
}
