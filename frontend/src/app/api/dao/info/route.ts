import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import plutusJson from "@/lib/scripts/plutus.json";
import { cborToScript, applyParamsToScript } from "@blaze-cardano/uplc";
import { Type } from "@blaze-cardano/data";

export interface DAOInfo {
  policyId: string;
  assetName: string;
  name: string;
  description: string;
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
    const network = process.env.NETWORK === "preview" ? 0 : 1;
    const daoScriptAddress = Core.addressFromValidator(network, daoScript);

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
      description: daoData.description ?? "",
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
    const network = process.env.NETWORK === "preview" ? 0 : 1;
    const treasuryAddress = Core.addressFromValidator(network, treasuryScript);

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
      console.log("Treasury empty or error fetching assets");
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

function parseDAODatum(datum: Core.PlutusData): any | null {
  try {
    const constr = datum.asConstrPlutusData();
    if (!constr || constr.getAlternative() !== 0n) {
      return null;
    }

    const fields = constr.getData();
    if (fields.getLength() < 9) {
      return null;
    }

    return {
      name: new TextDecoder().decode(
        fields.get(0).asBoundedBytes() ?? new Uint8Array()
      ),
      governance_token: Core.toHex(
        fields.get(1).asBoundedBytes() ?? new Uint8Array()
      ),
      threshold: Number(fields.get(2).asInteger() ?? 0n),
      min_proposal_time: Number(fields.get(3).asInteger() ?? 0n),
      max_proposal_time: Number(fields.get(4).asInteger() ?? 0n),
      quorum: Number(fields.get(5).asInteger() ?? 0n),
      min_gov_proposal_create: Number(fields.get(6).asInteger() ?? 0n),
    };
  } catch (error) {
    console.error("Error parsing DAO datum:", error);
    return null;
  }
}
