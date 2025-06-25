import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import {
  createParameterizedScript,
  getScriptPolicyId,
  addressFromScript,
} from "@/lib/server/helpers/script-helpers";

export interface DAOConfig {
  name: string;
  description: string;
  governanceToken: {
    policyId: string;
    assetName: string;
  };
  threshold: number; // percentage
  minProposalTime: number; // milliseconds
  maxProposalTime: number; // milliseconds
  quorum: number; // minimum votes needed
  minGovProposalCreate: number; // tokens needed to create proposal
  image?: string; // optional DAO logo
}

interface DAOCreationPlan {
  daoConfig: DAOConfig;
  daoParams: {
    seedUtxo: {
      txHash: string;
      outputIndex: number;
    };
    daoPolicyId: string;
    daoKey: string;
    governanceTokenHex: string; // combined policyId + assetName for contract
  };
  scriptsToDeployData: Array<{
    name: string;
    scriptHash: string;
    address: string;
    parameters: string[];
    size: number;
  }>;
  totalSteps: number;
  estimatedCost: string;
}

export async function POST(request: NextRequest) {
  try {
    const {
      walletAddress,
      daoConfig,
    }: {
      walletAddress: string;
      daoConfig: DAOConfig;
    } = await request.json();

    // Validate DAO config
    if (!daoConfig.name?.trim()) {
      throw new Error("DAO name is required");
    }
    if (
      !daoConfig.governanceToken?.policyId ||
      !daoConfig.governanceToken?.assetName
    ) {
      throw new Error("Governance token policy ID and asset name are required");
    }
    if (daoConfig.threshold < 1 || daoConfig.threshold > 100) {
      throw new Error("Threshold must be between 1 and 100 percent");
    }
    if (daoConfig.minProposalTime >= daoConfig.maxProposalTime) {
      throw new Error("Maximum proposal time must be greater than minimum");
    }

    const userAddress = Core.addressFromBech32(walletAddress);
    const userUtxos = await blazeMaestroProvider.getUnspentOutputs(userAddress);

    if (!userUtxos?.length) {
      throw new Error("No UTXOs found in wallet");
    }

    // Use first available UTXO as seed
    const seedUtxo = userUtxos[0];
    const daoKey = Core.blake2b_256(
      Core.PlutusData.newConstrPlutusData(
        new Core.ConstrPlutusData(
          0n,
          (() => {
            const list = new Core.PlutusList();
            list.add(
              Core.PlutusData.newBytes(
                Core.fromHex(seedUtxo.input().transactionId())
              )
            );
            list.add(
              Core.PlutusData.newInteger(BigInt(seedUtxo.input().index()))
            );
            return list;
          })()
        )
      ).toCbor()
    );

    // Calculate DAO policy ID (unparameterized DAO script)
    const daoScript = createParameterizedScript("dao.dao.mint", []);
    const daoPolicyId = daoScript.hash();

    // Calculate vote policy ID
    const votePolicyId = getScriptPolicyId("vote.vote.mint", [
      daoPolicyId,
      daoKey,
    ]);

    // Combine governance token for contract use
    const governanceTokenHex =
      daoConfig.governanceToken.policyId + daoConfig.governanceToken.assetName;

    // Plan all script deployments
    const scriptsToDeployConfig = [
      {
        name: "vote",
        title: "vote.vote.spend",
        parameters: [daoPolicyId, daoKey],
      },
      {
        name: "treasury",
        title: "treasury.treasury.spend",
        parameters: [daoPolicyId, daoKey],
      },
      {
        name: "proposal",
        title: "proposal.proposal.spend",
        parameters: [daoPolicyId, daoKey, votePolicyId],
      },
      {
        name: "actionSendFunds",
        title: "action_send_funds.action_send_funds.spend",
        parameters: [daoPolicyId, daoKey],
      },
    ];

    const scriptsToDeployData = scriptsToDeployConfig.map((config) => {
      const script = createParameterizedScript(config.title, config.parameters);
      return {
        name: config.name,
        scriptHash: script.hash(),
        address: addressFromScript(script).toBech32(),
        parameters: config.parameters,
        size: script.toCbor().length / 2,
      };
    });

    const plan: DAOCreationPlan = {
      daoConfig,
      daoParams: {
        seedUtxo: {
          txHash: seedUtxo.input().transactionId(),
          outputIndex: Number(seedUtxo.input().index()),
        },
        daoPolicyId,
        daoKey,
        governanceTokenHex,
      },
      scriptsToDeployData,
      totalSteps: scriptsToDeployData.length + 1, // +1 for DAO creation
      estimatedCost: "~8-15 ADA", // scripts + DAO creation
    };

    return NextResponse.json({ plan });
  } catch (error) {
    console.error("❌ DAO creation initialization failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to initialize DAO creation",
      },
      { status: 500 }
    );
  }
}
