import { NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import plutusJson from "@/lib/scripts/plutus.json";
import { cborToScript } from "@blaze-cardano/uplc";
import { parseDAODatum } from "@/lib/server/helpers/dao-helpers";
import { addressFromScript } from "@/lib/server/helpers/script-helpers";

export interface DAOListItem {
  policyId: string;
  assetName: string;
  name: string;
  // description: string;
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
  createdAt?: string;
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
}

export async function GET() {
  try {
    // Load DAO validator to get script address
    const daoValidator = plutusJson.validators.find(
      (v) => v.title === "dao.dao.spend"
    );

    if (!daoValidator) {
      throw new Error("DAO validator not found in plutus.json");
    }

    const daoScript = cborToScript(daoValidator.compiledCode, "PlutusV3");
    const daoScriptAddress = addressFromScript(daoScript);

    console.log(`Querying DAOs at address: ${daoScriptAddress.toBech32()}`);

    // Get all UTXOs at the DAO script address
    const utxos = await blazeMaestroProvider.getUnspentOutputs(
      daoScriptAddress
    );

    const daos: DAOListItem[] = [];

    for (const utxo of utxos) {
      try {
        const output = utxo.output();
        const datum = output.datum();

        if (!datum) {
          console.warn("DAO UTXO missing datum, skipping");
          continue;
        }

        // Extract PlutusData from Datum
        let plutusData: Core.PlutusData | undefined;
        try {
          plutusData = datum.asInlineData();
          if (!plutusData) {
            console.warn("DAO UTXO has non-inline datum, skipping");
            continue;
          }
        } catch (error) {
          console.warn("Failed to extract inline datum, skipping");
          continue;
        }

        // Parse DAO datum
        const daoData = parseDAODatum(plutusData);
        if (!daoData) {
          console.warn("Failed to parse DAO datum, skipping");
          continue;
        }

        // Extract DAO NFT from UTXO value to get policy ID and asset name
        const value = output.amount().toCore();
        let daoPolicyId = "";
        let daoAssetName = "";

        if (value.assets) {
          for (const [assetId, quantity] of value.assets) {
            if (quantity === 1n) {
              // DAO NFTs have quantity 1
              const policyId = Core.AssetId.getPolicyId(assetId);
              const assetName = Core.AssetId.getAssetName(assetId);
              daoPolicyId = policyId;
              daoAssetName = assetName;
              break;
            }
          }
        }

        if (!daoPolicyId || !daoAssetName) {
          console.warn("No DAO NFT found in UTXO, skipping");
          continue;
        }

        // Parse governance token (policy + asset concatenated in datum)
        const govTokenHex = daoData.governance_token;
        const govPolicyId = govTokenHex.slice(0, 56); // First 28 bytes
        const govAssetName = govTokenHex.slice(56); // Remaining bytes

        daos.push({
          policyId: daoPolicyId,
          assetName: daoAssetName,
          name: daoData.name,
          // description: daoData.description ?? "",
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
          utxoRef: {
            txHash: utxo.input().transactionId(),
            outputIndex: Number(utxo.input().index()),
          },
        });
      } catch (error) {
        console.error("Error processing DAO UTXO:", error);
        continue;
      }
    }

    console.log(`Found ${daos.length} DAOs`);

    return NextResponse.json({
      daos,
      count: daos.length,
    });
  } catch (error) {
    console.error("Error fetching DAO list:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch DAOs",
      },
      { status: 500 }
    );
  }
}
