import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript } from "@blaze-cardano/uplc";
import plutusJson from "@/lib/scripts/plutus.json";
import {
  addressFromScript,
  createParameterizedScript,
} from "./script-helpers";
import { getVotePolicyId } from "./vote-helpers";
import { HexBlob } from "@blaze-cardano/core";
import { Exact, parse, Type } from "@blaze-cardano/data";

const ProposalTypes = Type.Module({
  OutputReference: Type.Object({
            transaction_id: Type.String(),
            output_index: Type.BigInt(),
          }, { ctor: 0n }),
  ProposalStatus: Type.Union([
    Type.Literal("Active", {ctor: 0n}),
    Type.Literal("FailedThreshold", {ctor: 1n}),
    Type.Literal("FailedQuorum", {ctor: 2n}),
    Type.Object({
      Passed: Type.BigInt(), 
    }, {ctor: 3n})
  ]),
  ProposalDatum: Type.Object({
    name: Type.String(),
    description: Type.String(),
    tally: Type.Array(Type.BigInt()),
    end_time: Type.BigInt(),
    status: Type.Ref("ProposalStatus"),
    identifier: Type.Ref("OutputReference"),
  }, {ctor: 0n})});

export const ProposalStatus = ProposalTypes.Import("ProposalStatus");
export type ProposalStatus = Exact<typeof ProposalStatus>;
export const OutputReference = ProposalTypes.Import("OutputReference");
export type OutputReference = Exact<typeof OutputReference>;
export const ProposalDatum = ProposalTypes.Import("ProposalDatum");
export type ProposalDatum = Exact<typeof ProposalDatum>;


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

export function parseProposalDatum(datum: Core.PlutusData): ProposalDatum | undefined {
  try {
    const proposalDatum = parse(ProposalDatum, datum);

    return proposalDatum;
  } catch (error) {
    console.error("Error parsing proposal datum:", error);
    console.error("Datum:", datum.toCbor());
    return undefined;
  }
}

export function proposalStatusString(status: ProposalStatus): "Active" | "FailedThreshold" | "FailedQuorum" | "Passed" {
  switch (typeof status) {
    case "string":
      return status;
    case "object":
      if ("Passed" in status) {
        return "Passed";
      }
      throw new Error("Unknown proposal status object");
    default:
      throw new Error("Unknown proposal status object");
  }
}

export function proposalStatusWinningOption(status: ProposalStatus): number | undefined {
  if (typeof status === "object" && "Passed" in status) {
    return status.Passed;
  }
  return undefined;
}

export async function findProposalActions(
  proposalPolicyId: string,
  proposalAssetName: string,
  daoPolicyId: string,
  daoKey: string
): Promise<
  Array<{
    index: number;
    name?: string;
    description?: string;
    targets?: Array<{
      address: string;
      assets: Array<{
        unit: string;
        quantity: string;
      }>;
    }>;
  }>
> {
  try {
    const actionScript = createParameterizedScript(
      "action_send_funds.action_send_funds.spend",
      [daoPolicyId, daoKey]
    );
    const actionScriptAddress = addressFromScript(actionScript);

    const actionUtxos = await blazeMaestroProvider.getUnspentOutputs(
      actionScriptAddress
    );
    const actions: Array<{
      index: number;
      name?: string;
      description?: string;
      targets?: Array<{
        address: string;
        assets: Array<{
          unit: string;
          quantity: string;
        }>;
      }>;
    }> = [];

    for (const utxo of actionUtxos) {
      try {
        const datum = utxo.output().datum()?.asInlineData();
        if (!datum) continue;

        const actionData = parseActionDatum(datum);
        if (!actionData) continue;

        // Check if this action belongs to our proposal
        if (
          actionData.actionIdentifier.proposal_policy_id === proposalPolicyId &&
          actionData.actionIdentifier.proposal_identifier === proposalAssetName
        ) {
          actions.push({
            index: actionData.actionIdentifier.action_index,
            name: actionData.name,
            description: actionData.description,
            targets: actionData.targets,
          });
        }
      } catch (error) {
        continue;
      }
    }

    // Sort by action index
    actions.sort((a, b) => a.index - b.index);
    return actions;
  } catch (error) {
    console.error("Error finding proposal actions:", error);
    return [];
  }
}

export function parseActionDatum(datum: Core.PlutusData): {
  name: string;
  description: string;
  actionIdentifier: {
    proposal_policy_id: string;
    proposal_identifier: string;
    action_index: number;
  };
  targets: Array<{
    address: string;
    assets: Array<{
      unit: string;
      quantity: string;
    }>;
  }>;
} | null {
  try {
    const constr = datum.asConstrPlutusData();
    if (!constr || constr.getAlternative() !== 0n) return null;

    const fields = constr.getData();
    if (fields.getLength() < 7) return null;

    const name = new TextDecoder().decode(
      fields.get(0).asBoundedBytes() ?? new Uint8Array()
    );

    const description = new TextDecoder().decode(
      fields.get(1).asBoundedBytes() ?? new Uint8Array()
    );

    // Parse action identifier (field 3)
    const actionIdConstr = fields.get(3).asConstrPlutusData();
    if (!actionIdConstr) return null;

    const actionIdFields = actionIdConstr.getData();
    if (actionIdFields.getLength() < 3) return null;

    const proposalPolicyId = Core.toHex(
      actionIdFields.get(0).asBoundedBytes() ?? new Uint8Array()
    );
    const proposalIdentifier = Core.toHex(
      actionIdFields.get(1).asBoundedBytes() ?? new Uint8Array()
    );
    const actionIndex = Number(actionIdFields.get(2).asInteger() ?? 0n);

    // Parse targets (field 5)
    const targetsList = fields.get(5).asList();
    const targets: Array<{
      address: string;
      assets: Array<{
        unit: string;
        quantity: string;
      }>;
    }> = [];

    if (targetsList) {
      for (let i = 0; i < targetsList.getLength(); i++) {
        const targetConstr = targetsList.get(i).asConstrPlutusData();
        if (!targetConstr) continue;

        const targetFields = targetConstr.getData();
        if (targetFields.getLength() < 4) continue;

        const addressBytes = targetFields.get(0).asBoundedBytes();
        if (!addressBytes) continue;

        const address = Core.Address.fromBytes(
          HexBlob(Core.toHex(addressBytes))
        ).toBech32();
        const coins = Number(targetFields.get(1).asInteger() ?? 0n);

        const assets: Array<{
          unit: string;
          quantity: string;
        }> = [];

        // Add ADA if present
        if (coins > 0) {
          assets.push({
            unit: "lovelace",
            quantity: coins.toString(),
          });
        }

        // Parse other assets (field 2 - tokens list)
        const tokensList = targetFields.get(2).asList();
        if (tokensList) {
          for (let j = 0; j < tokensList.getLength(); j++) {
            const policyConstr = tokensList.get(j).asConstrPlutusData();
            if (!policyConstr) continue;

            const policyFields = policyConstr.getData();
            if (policyFields.getLength() < 2) continue;

            const policyId = Core.toHex(
              policyFields.get(0).asBoundedBytes() ?? new Uint8Array()
            );

            const assetsList = policyFields.get(1).asList();
            if (!assetsList) continue;

            for (let k = 0; k < assetsList.getLength(); k++) {
              const assetConstr = assetsList.get(k).asConstrPlutusData();
              if (!assetConstr) continue;

              const assetFields = assetConstr.getData();
              if (assetFields.getLength() < 2) continue;

              const assetName = Core.toHex(
                assetFields.get(0).asBoundedBytes() ?? new Uint8Array()
              );
              const quantity = Number(assetFields.get(1).asInteger() ?? 0n);

              assets.push({
                unit: policyId + assetName,
                quantity: quantity.toString(),
              });
            }
          }
        }

        targets.push({ address, assets });
      }
    }

    return {
      name,
      description,
      actionIdentifier: {
        proposal_policy_id: proposalPolicyId,
        proposal_identifier: proposalIdentifier,
        action_index: actionIndex,
      },
      targets,
    };
  } catch (error) {
    console.error("Error parsing action datum:", error);
    return null;
  }
}

export async function getProposalUtxo(
  proposalPolicyId: string,
  proposalAssetName: string,
  daoPolicyId: string,
  daoKey: string
): Promise<Core.TransactionUnspentOutput | null> {
  const votePolicyId = await getVotePolicyId(daoPolicyId, daoKey);
  const proposalScript = createParameterizedScript("proposal.proposal.spend", [
    daoPolicyId,
    daoKey,
    votePolicyId,
  ]);
  const proposalScriptAddress = addressFromScript(proposalScript);

  const utxos = await blazeMaestroProvider.getUnspentOutputs(
    proposalScriptAddress
  );

  for (const utxo of utxos) {
    const value = utxo.output().amount().toCore();
    if (value.assets) {
      for (const [assetId, quantity] of value.assets) {
        if (quantity === 1n) {
          const policyId = Core.AssetId.getPolicyId(assetId);
          const assetName = Core.AssetId.getAssetName(assetId);
          if (
            policyId === proposalPolicyId &&
            assetName === proposalAssetName
          ) {
            return utxo;
          }
        }
      }
    }
  }

  return null;
}
