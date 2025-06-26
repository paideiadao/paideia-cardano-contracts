import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript } from "@blaze-cardano/uplc";
import plutusJson from "@/lib/scripts/plutus.json";
import {
  addressFromScript,
  createParameterizedScript,
  getNetworkId,
} from "./script-helpers";
import { findUserVoteUtxo, getVotePolicyId } from "./vote-helpers";
import { HexBlob } from "@blaze-cardano/core";
import { DAOInfo } from "@/app/api/dao/info/route";
import { ExtendedDAOInfo } from "@/app/api/dao/proposal/create/route";

export async function getEndedProposalUtxos(
  whitelistedProposals: string[],
  receiptAssetNames: string[],
  daoInfo: ExtendedDAOInfo
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
                const proposalData = parseProposalDatum(datum, daoInfo);
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

export interface ParsedProposalDatum {
  name: string;
  description: string;
  tally: number[];
  endTime: number;
  status: ProposalStatus;
  identifier: OutputReference;
  winningOption?: number;
}

export interface OutputReference {
  txHash: string;
  outputIndex: number;
}

export type ProposalStatus =
  | "Active"
  | "ReadyForEvaluation"
  | "FailedThreshold"
  | "FailedQuorum"
  | "Passed";

export interface RawProposalDatum {
  name: string;
  description: string;
  tally: number[];
  end_time: number;
  status: Core.PlutusData; // Raw for exact preservation
  identifier: Core.PlutusData; // Raw for exact preservation
}

export function parseProposalDatum(
  datum: Core.PlutusData,
  daoInfo: ExtendedDAOInfo
): ParsedProposalDatum | null {
  try {
    const constr = datum.asConstrPlutusData();
    if (!constr || constr.getAlternative() !== 0n) return null;

    const fields = constr.getData();
    if (fields.getLength() < 6) return null;

    const name = new TextDecoder().decode(
      fields.get(0).asBoundedBytes() ?? new Uint8Array()
    );

    const description = new TextDecoder().decode(
      fields.get(1).asBoundedBytes() ?? new Uint8Array()
    );

    const tallyList = fields.get(2).asList();
    const tally: number[] = [];
    if (tallyList) {
      for (let i = 0; i < tallyList.getLength(); i++) {
        tally.push(Number(tallyList.get(i).asInteger() ?? 0n));
      }
    }

    const endTime = Number(fields.get(3).asInteger() ?? 0n);
    let winningOption: number | undefined = undefined;

    const statusConstr = fields.get(4).asConstrPlutusData();
    let status: ProposalStatus = "Active";
    if (statusConstr) {
      const statusAlt = Number(statusConstr.getAlternative());
      switch (statusAlt) {
        case 0:
          status = "Active";
          break;
        case 1:
          status = "FailedThreshold";
          break;
        case 2:
          status = "FailedQuorum";
          break;
        case 3:
          const passedFields = statusConstr.getData();
          winningOption =
            passedFields.getLength() > 0
              ? Number(passedFields.get(0).asInteger() ?? 0n)
              : 0;
          status = "Passed";
          break;
      }
    }

    // If Active proposal has expired, mark as ready for evaluation
    if (status === "Active" && endTime <= Date.now()) {
      status = "ReadyForEvaluation";
    }

    const identifierConstr = fields.get(5).asConstrPlutusData();
    let identifier: OutputReference = { txHash: "", outputIndex: 0 };
    if (identifierConstr) {
      const idFields = identifierConstr.getData();
      if (idFields.getLength() >= 2) {
        const txHashBytes = idFields.get(0).asBoundedBytes();
        const outputIndex = Number(idFields.get(1).asInteger() ?? 0n);
        if (txHashBytes) {
          identifier = {
            txHash: Core.toHex(txHashBytes),
            outputIndex,
          };
        }
      }
    }

    return {
      name,
      description,
      tally,
      endTime,
      status,
      identifier,
      winningOption,
    };
  } catch (error) {
    console.error("Error parsing proposal datum:", error);
    return null;
  }
}

export function parseRawProposalDatum(
  datum: Core.PlutusData
): RawProposalDatum | null {
  try {
    const constr = datum.asConstrPlutusData();
    if (!constr || constr.getAlternative() !== 0n) return null;

    const fields = constr.getData();
    if (fields.getLength() < 6) return null;

    const name = new TextDecoder().decode(
      fields.get(0).asBoundedBytes() ?? new Uint8Array()
    );

    const description = new TextDecoder().decode(
      fields.get(1).asBoundedBytes() ?? new Uint8Array()
    );

    const tallyList = fields.get(2).asList();
    const tally: number[] = [];
    if (tallyList) {
      for (let i = 0; i < tallyList.getLength(); i++) {
        tally.push(Number(tallyList.get(i).asInteger() ?? 0n));
      }
    }

    const end_time = Number(fields.get(3).asInteger() ?? 0n);
    const status = fields.get(4); // Keep as raw PlutusData
    const identifier = fields.get(5); // Keep as raw PlutusData

    console.log("🔍 RAW FIELDS DEBUG:");
    console.log("Status field CBOR:", status.toCbor());
    console.log("Identifier field CBOR:", identifier.toCbor());

    return {
      name,
      description,
      tally,
      end_time,
      status,
      identifier,
    };
  } catch (error) {
    console.error("Error parsing raw proposal datum:", error);
    return null;
  }
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
