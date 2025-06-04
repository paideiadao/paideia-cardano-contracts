import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript } from "@blaze-cardano/uplc";
import plutusJson from "@/lib/scripts/plutus.json";
import { addressFromScript, getNetworkId } from "./script-helpers";

export async function getEndedProposalUtxos(
  whitelistedProposals: string[],
  receiptAssetNames: string[]
) {
  const proposalUtxos: Core.TransactionUnspentOutput[] = [];

  for (const proposalPolicyId of whitelistedProposals) {
    try {
      const proposalValidator = plutusJson.validators.find(
        (v) => v.title === "proposal.proposal.spend"
      );

      if (!proposalValidator) {
        continue;
      }

      const proposalScript = cborToScript(
        proposalValidator.compiledCode,
        "PlutusV3"
      );
      const proposalScriptAddress = addressFromScript(proposalScript);

      const utxos = await blazeMaestroProvider.getUnspentOutputs(
        proposalScriptAddress
      );

      for (const utxo of utxos) {
        const value = utxo.output().amount().toCore();
        if (value.assets) {
          for (const [assetId, quantity] of value.assets) {
            const policyId = Core.AssetId.getPolicyId(assetId);

            if (policyId === proposalPolicyId && quantity === 1n) {
              const datum = utxo.output().datum()?.asInlineData();
              if (datum) {
                const proposalData = parseProposalDatum(datum);
                if (proposalData?.status !== "Active") {
                  proposalUtxos.push(utxo);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(
        `Error fetching proposals for policy ${proposalPolicyId}:`,
        error
      );
      continue;
    }
  }

  return proposalUtxos;
}

function parseProposalDatum(datum: Core.PlutusData): { status: string } | null {
  try {
    const constr = datum.asConstrPlutusData();
    if (!constr || constr.getAlternative() !== 0n) {
      return null;
    }

    const fields = constr.getData();
    if (fields.getLength() < 5) {
      return null;
    }

    const statusField = fields.get(4);
    const statusConstr = statusField.asConstrPlutusData();

    if (!statusConstr) {
      return null;
    }

    const statusAlt = Number(statusConstr.getAlternative());
    switch (statusAlt) {
      case 0:
        return { status: "Active" };
      case 1:
        return { status: "FailedThreshold" };
      case 2:
        return { status: "FailedQuorum" };
      case 3:
        return { status: "Passed" };
      default:
        return { status: "Active" };
    }
  } catch (error) {
    return null;
  }
}
