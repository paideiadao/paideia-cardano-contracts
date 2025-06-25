import { NextRequest, NextResponse } from "next/server";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  createParameterizedScript,
  getNetworkId,
  addressFromScript,
  getCurrentSlot,
} from "@/lib/server/helpers/script-helpers";

interface DeployedScript {
  name: string;
  scriptHash: string;
  address: string;
  deploymentTx: string;
  size: number;
  parameters: string[];
}

interface DAOConfig {
  name: string;
  description: string;
  governanceToken: {
    policyId: string;
    assetName: string;
  };
  threshold: number;
  minProposalTime: number;
  maxProposalTime: number;
  quorum: number;
  minGovProposalCreate: number;
  image?: string;
}

interface FinalizeDAORequest {
  daoConfig: DAOConfig;
  daoParams: {
    seedUtxo: { txHash: string; outputIndex: number };
    daoPolicyId: string;
    daoKey: string;
    governanceTokenHex: string;
  };
  deployedScripts: DeployedScript[];
  walletAddress: string;
  collateral: any[];
  changeAddress: string;
}

export async function POST(request: NextRequest) {
  try {
    const {
      daoConfig,
      daoParams,
      deployedScripts,
      walletAddress,
      collateral,
      changeAddress,
    }: FinalizeDAORequest = await request.json();

    if (!collateral?.length) {
      throw new Error("No collateral available");
    }

    if (!deployedScripts?.length) {
      throw new Error("No deployed scripts provided");
    }

    console.log(`🏗️ Finalizing DAO: ${daoConfig.name}`);
    console.log(`📜 Using ${deployedScripts.length} deployed scripts`);

    const sendAddress = Core.addressFromBech32(walletAddress);
    const wallet = new ColdWallet(
      sendAddress,
      getNetworkId(),
      blazeMaestroProvider
    );
    const blaze = await Blaze.from(blazeMaestroProvider, wallet);

    // Find the seed UTXO
    const userUtxos = await blazeMaestroProvider.getUnspentOutputs(sendAddress);
    const seedUtxo = userUtxos.find(
      (utxo) =>
        utxo.input().transactionId() === daoParams.seedUtxo.txHash &&
        Number(utxo.input().index()) === daoParams.seedUtxo.outputIndex
    );

    if (!seedUtxo) {
      throw new Error("Seed UTXO not found or already spent");
    }

    // Create DAO script and address
    const daoScript = createParameterizedScript("dao.dao.spend", []);
    const daoScriptAddress = addressFromScript(daoScript);

    // Create comprehensive DAO NFT metadata including all script references
    const nftMetadata = createDAONftMetadata(
      daoConfig,
      daoParams,
      deployedScripts
    );

    // Create DAO datum for the contract
    const daoDatum = createDAODatum(
      daoConfig,
      daoParams.governanceTokenHex,
      deployedScripts
    );

    // Create DAO creation redeemer
    const daoRedeemer = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(
        0n,
        (() => {
          const list = new Core.PlutusList();
          const outputRefData = Core.PlutusData.newConstrPlutusData(
            new Core.ConstrPlutusData(
              0n,
              (() => {
                const refList = new Core.PlutusList();
                refList.add(
                  Core.PlutusData.newBytes(
                    Core.fromHex(daoParams.seedUtxo.txHash)
                  )
                );
                refList.add(
                  Core.PlutusData.newInteger(
                    BigInt(daoParams.seedUtxo.outputIndex)
                  )
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

    // Mint the DAO NFT
    const daoMintMap = new Map([[Core.AssetName(daoParams.daoKey), 1n]]);

    const daoValue = Core.Value.fromCore({
      coins: 0n,
      assets: new Map([
        [
          Core.AssetId.fromParts(
            Core.PolicyId(daoParams.daoPolicyId),
            Core.AssetName(daoParams.daoKey)
          ),
          1n,
        ],
      ]),
    });

    const currentSlot = getCurrentSlot();
    const validityStart = Core.Slot(Number(currentSlot));
    const validityEnd = Core.Slot(Number(currentSlot) + 3600);

    const transaction = await blaze
      .newTransaction()
      .addInput(seedUtxo)
      .provideScript(daoScript)
      .addMint(Core.PolicyId(daoParams.daoPolicyId), daoMintMap, daoRedeemer)
      .lockAssets(daoScriptAddress, daoValue, daoDatum)
      .setValidFrom(validityStart)
      .setValidUntil(validityEnd)
      .complete();

    console.log(`✅ DAO finalization transaction prepared`);

    return NextResponse.json({
      unsignedTx: transaction.toCbor(),
      dao: {
        policyId: daoParams.daoPolicyId,
        assetName: daoParams.daoKey,
        address: daoScriptAddress.toBech32(),
        metadata: nftMetadata,
      },
    });
  } catch (error) {
    console.error("❌ DAO finalization failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to finalize DAO creation",
      },
      { status: 500 }
    );
  }
}

function createDAONftMetadata(
  config: DAOConfig,
  daoParams: any,
  deployedScripts: DeployedScript[]
) {
  const scriptsMetadata = deployedScripts.reduce((acc, script) => {
    acc[script.name] = {
      hash: script.scriptHash,
      address: script.address,
      deploymentTx: script.deploymentTx,
      size: script.size,
      parameters: script.parameters,
    };
    return acc;
  }, {} as Record<string, any>);

  return {
    name: config.name,
    description: config.description,
    ...(config.image && { image: config.image }),
    governance: {
      governanceToken: daoParams.governanceTokenHex,
      threshold: config.threshold,
      minProposalTime: config.minProposalTime,
      maxProposalTime: config.maxProposalTime,
      quorum: config.quorum,
      minGovProposalCreate: config.minGovProposalCreate,
    },
    scripts: scriptsMetadata,
    network: process.env.NETWORK,
    version: "1.0.0",
    createdAt: new Date().toISOString(),
  };
}

function createDAODatum(
  config: DAOConfig,
  governanceTokenHex: string,
  deployedScripts: DeployedScript[]
): Core.PlutusData {
  const fieldsList = new Core.PlutusList();

  // name
  fieldsList.add(
    Core.PlutusData.newBytes(new TextEncoder().encode(config.name))
  );

  // governance_token
  fieldsList.add(Core.PlutusData.newBytes(Core.fromHex(governanceTokenHex)));

  // threshold
  fieldsList.add(Core.PlutusData.newInteger(BigInt(config.threshold)));

  // min_proposal_time (convert to milliseconds if needed)
  fieldsList.add(Core.PlutusData.newInteger(BigInt(config.minProposalTime)));

  // max_proposal_time
  fieldsList.add(Core.PlutusData.newInteger(BigInt(config.maxProposalTime)));

  // quorum
  fieldsList.add(Core.PlutusData.newInteger(BigInt(config.quorum)));

  // min_gov_proposal_create
  fieldsList.add(
    Core.PlutusData.newInteger(BigInt(config.minGovProposalCreate))
  );

  // whitelisted_proposals - get proposal script hashes
  const proposalScripts = deployedScripts.filter((s) => s.name === "proposal");
  const whitelistedProposals = new Core.PlutusList();
  proposalScripts.forEach((script) => {
    whitelistedProposals.add(
      Core.PlutusData.newBytes(Core.fromHex(script.scriptHash))
    );
  });
  fieldsList.add(Core.PlutusData.newList(whitelistedProposals));

  // whitelisted_actions - get action script hashes
  const actionScripts = deployedScripts.filter(
    (s) => s.name === "actionSendFunds"
  );
  const whitelistedActions = new Core.PlutusList();
  actionScripts.forEach((script) => {
    whitelistedActions.add(
      Core.PlutusData.newBytes(Core.fromHex(script.scriptHash))
    );
  });
  fieldsList.add(Core.PlutusData.newList(whitelistedActions));

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, fieldsList)
  );
}
