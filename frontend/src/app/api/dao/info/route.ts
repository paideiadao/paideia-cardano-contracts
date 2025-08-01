import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import plutusJson from "@/lib/scripts/plutus.json";
import { cborToScript, applyParamsToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";
import { parseDAODatum } from "@/lib/server/helpers/dao-helpers";
import { addressFromScript } from "@/lib/server/helpers/script-helpers";

export interface DAOInfo {
  policyId: string;
  assetName: string;
  name: string;
  governanceToken: {
    policyId: string;
    assetName: string;
    fullAssetId: string;
  };
  threshold: number;
  quorum: number;
  minProposalTime: number;
  maxProposalTime: number;
  minGovProposalCreate: number;
  treasury: {
    address: string;
    assets: Array<{
      unit: string;
      quantity: string;
      metadata?: {
        name?: string;
        ticker?: string;
        decimals?: number;
      };
    }>;
    totalValueAda: string;
  };
  stats: {
    totalProposals: number;
    activeProposals: number;
    passedProposals: number;
    failedProposals: number;
  };
  createdAt?: string;
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const policyId = searchParams.get("policyId");
    const assetName = searchParams.get("assetName");

    if (!policyId || !assetName) {
      return NextResponse.json(
        { error: "policyId and assetName query parameters are required" },
        { status: 400 }
      );
    }

    const daoValidator = plutusJson.validators.find(
      (v) => v.title === "dao.dao.spend"
    );

    if (!daoValidator) {
      throw new Error("DAO validator not found in plutus.json");
    }

    const daoScript = cborToScript(daoValidator.compiledCode, "PlutusV3");
    const daoScriptAddress = addressFromScript(daoScript);

    const utxos = await blazeMaestroProvider.getUnspentOutputs(
      daoScriptAddress
    );

    let daoUtxo = null;
    for (const utxo of utxos) {
      const value = utxo.output().amount().toCore();
      if (value.assets) {
        for (const [assetId, quantity] of value.assets) {
          if (quantity === 1n) {
            const utxoPolicyId = Core.AssetId.getPolicyId(assetId);
            const utxoAssetName = Core.AssetId.getAssetName(assetId);
            if (utxoPolicyId === policyId && utxoAssetName === assetName) {
              daoUtxo = utxo;
              break;
            }
          }
        }
      }
      if (daoUtxo) break;
    }

    if (!daoUtxo) {
      return NextResponse.json({ error: "DAO not found" }, { status: 404 });
    }

    const datum = daoUtxo.output().datum()?.asInlineData();
    if (!datum) {
      throw new Error("DAO UTXO missing datum");
    }

    const daoData = parseDAODatum(datum);
    if (!daoData) {
      throw new Error("Failed to parse DAO datum");
    }

    const treasuryInfo = await getTreasuryInfo(policyId, assetName);

    const govTokenHex = daoData.governance_token;
    const govPolicyId = govTokenHex.slice(0, 56);
    const govAssetName = govTokenHex.slice(56);

    const stats = {
      totalProposals: 0,
      activeProposals: 0,
      passedProposals: 0,
      failedProposals: 0,
    };

    const daoInfo: DAOInfo = {
      policyId,
      assetName,
      name: daoData.name,
      governanceToken: {
        policyId: govPolicyId,
        assetName: govAssetName,
        fullAssetId: Core.AssetId.fromParts(
          Core.PolicyId(govPolicyId),
          Core.AssetName(govAssetName)
        ),
      },
      threshold: daoData.threshold,
      quorum: daoData.quorum,
      minProposalTime: daoData.min_proposal_time,
      maxProposalTime: daoData.max_proposal_time,
      minGovProposalCreate: daoData.min_gov_proposal_create,
      treasury: treasuryInfo,
      stats,
      utxoRef: {
        txHash: daoUtxo.input().transactionId(),
        outputIndex: Number(daoUtxo.input().index()),
      },
    };

    return NextResponse.json(daoInfo);
  } catch (error) {
    console.error("Error fetching DAO info:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch DAO info",
      },
      { status: 500 }
    );
  }
}

async function getTreasuryInfo(daoPolicyId: string, daoKey: string) {
  try {
    const treasuryValidator = plutusJson.validators.find(
      (v) => v.title === "treasury.treasury.spend"
    );

    if (!treasuryValidator) {
      throw new Error("Treasury validator not found");
    }

    const parameterizedTreasuryScript = (applyParamsToScript as any)(
      treasuryValidator.compiledCode,
      Type.Tuple([Type.String(), Type.String()]),
      [daoPolicyId, daoKey]
    );

    const treasuryScript = cborToScript(
      parameterizedTreasuryScript,
      "PlutusV3"
    );
    const treasuryAddress = addressFromScript(treasuryScript);

    let assets: any[] = [];
    let totalValueAda = "0";

    try {
      const utxos = await blazeMaestroProvider.getUnspentOutputs(
        treasuryAddress
      );
      const assetMap = new Map<string, bigint>();

      for (const utxo of utxos) {
        const value = utxo.output().amount();
        const ada = value.coin();
        assetMap.set("lovelace", (assetMap.get("lovelace") ?? 0n) + ada);

        const coreValue = value.toCore();
        if (coreValue.assets) {
          for (const [assetId, quantity] of coreValue.assets) {
            assetMap.set(assetId, (assetMap.get(assetId) ?? 0n) + quantity);
          }
        }
      }

      assets = Array.from(assetMap.entries()).map(([unit, quantity]) => ({
        unit,
        quantity: quantity.toString(),
      }));

      const lovelace = assetMap.get("lovelace") ?? 0n;
      totalValueAda = (Number(lovelace) / 1_000_000).toFixed(2);
    } catch (error) {
      console.error("Treasury empty or error fetching assets: ", error);
    }

    return {
      address: treasuryAddress.toBech32(),
      assets,
      totalValueAda,
    };
  } catch (error) {
    console.error("Error getting treasury info:", error);
    return {
      address: "",
      assets: [],
      totalValueAda: "0",
    };
  }
}
