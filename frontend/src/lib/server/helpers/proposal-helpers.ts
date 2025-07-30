import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript } from "@blaze-cardano/uplc";
import plutusJson from "@/lib/scripts/plutus.json";
import { addressFromScript, createParameterizedScript } from "./script-helpers";
import { getVotePolicyId } from "./vote-helpers";
import { ExtendedDAOInfo } from "@/app/api/dao/proposal/create/route";
import {
  getCachedTransactionDetails,
  getCachedTransactionHistory,
  getCachedUtxos,
  SCRIPT_TTL,
} from "./utxo-cache";
import { addressToPlutusData, plutusDataToAddress } from "./address-parsing";
import { TransactionUnspentOutput } from "@blaze-cardano/core";

export interface ProposalData {
  name: string;
  description: string;
  startTime: string;
  endTime: string;
}

export interface ProposalAsset {
  unit: string;
  quantity: string;
}

export interface ProposalTarget {
  address: string;
  assets: ProposalAsset[];
}

export interface ActionData {
  name: string;
  description: string;
  activationTime: string;
  targets: ProposalTarget[];
}

export interface ActionTarget {
  address: string;
  coins: number; // ADA in lovelace
  tokens: Array<{
    policyId: string;
    assetName: string;
    quantity: number;
  }>;
  datum: "NoDatum" | { type: "InlineDatum"; data: string };
}

// Fixed ParsedActionDatum interface
export interface ParsedActionDatum {
  name: string;
  description: string;
  activationTime: number;
  actionIdentifier: {
    proposal_policy_id: string;
    proposal_identifier: string;
    action_index: number;
  };
  option: number;
  targets: ActionTarget[];
  treasuryAddress: string;
}

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
    name: string;
    description: string;
    targets: ActionTarget[];
    isExecuted: boolean;
  }>
> {
  try {
    console.log("🔍 SEARCHING FOR ACTIONS:");
    console.log(`  Proposal policy ID: ${proposalPolicyId}`);
    console.log(`  Proposal asset name: ${proposalAssetName}`);

    const actionScript = createParameterizedScript(
      "action_send_funds.action_send_funds.spend",
      [daoPolicyId, daoKey]
    );
    const actionScriptAddress = addressFromScript(actionScript);

    // Get transaction summaries (cached for 2 minutes)
    const transactionHistory = await getCachedTransactionHistory(
      actionScriptAddress
    );

    console.log(`  Found ${transactionHistory.length} transactions to analyze`);

    if (transactionHistory.length === 0) {
      return [];
    }

    // Fetch full transaction details for each transaction
    const transactions = [];
    for (const txHash of transactionHistory) {
      try {
        const fullTx = await getCachedTransactionDetails(txHash);
        transactions.push(fullTx);
      } catch (error) {
        console.error(`  Error fetching full details for ${txHash}:`, error);
        // Continue with other transactions
      }
    }

    console.log(
      `  Successfully loaded ${transactions.length} full transaction details`
    );

    const actions: Array<{
      index: number;
      name: string;
      description: string;
      targets: ActionTarget[];
      isExecuted: boolean;
    }> = [];

    // Track which action UTXOs have been spent (executed)
    const spentOutputs = new Set<string>();
    const createdOutputs = new Map<string, any>();

    // Analyze all transactions to find actions
    for (const tx of transactions) {
      try {
        // Check inputs to see what was spent
        for (const input of tx.inputs ?? []) {
          const utxoKey = `${input.tx_hash}#${input.index}`;
          spentOutputs.add(utxoKey);
        }

        // Check outputs to see what was created at this address
        for (let i = 0; i < (tx.outputs ?? []).length; i++) {
          const output = tx.outputs[i];
          if (output.address === actionScriptAddress.toBech32()) {
            const utxoKey = `${tx.tx_hash}#${i}`;
            createdOutputs.set(utxoKey, {
              txHash: tx.tx_hash,
              outputIndex: i,
              output,
              datum: output.datum?.bytes,
            });
          }
        }
      } catch (error) {
        console.error(`  Error analyzing transaction ${tx.hash}:`, error);
        continue;
      }
    }

    console.log(`  Found ${createdOutputs.size} action outputs created`);
    console.log(`  Found ${spentOutputs.size} outputs spent`);

    // Parse action data from all created outputs
    for (const [utxoKey, outputData] of createdOutputs) {
      try {
        if (!outputData.datum) {
          console.log(`  ${utxoKey}: No datum`);
          continue;
        }

        // Convert the datum to Core.PlutusData format
        const datum = Core.PlutusData.fromCbor(Core.HexBlob(outputData.datum));
        const actionData = parseActionDatum(datum);

        if (!actionData) {
          console.log(`  ${utxoKey}: Failed to parse datum`);
          continue;
        }

        console.log(`  ${utxoKey}:`);
        console.log(`    Action name: ${actionData.name}`);
        console.log(
          `    Proposal policy ID: ${actionData.actionIdentifier.proposal_policy_id}`
        );
        console.log(
          `    Proposal identifier: ${actionData.actionIdentifier.proposal_identifier}`
        );

        // Check if this action belongs to our proposal
        if (
          actionData.actionIdentifier.proposal_policy_id === proposalPolicyId &&
          actionData.actionIdentifier.proposal_identifier === proposalAssetName
        ) {
          console.log(`    ✅ Matches proposal!`);

          const isExecuted = spentOutputs.has(utxoKey);
          console.log(`    Executed: ${isExecuted ? "✅" : "❌"}`);

          actions.push({
            index: actionData.actionIdentifier.action_index,
            name: actionData.name,
            description: actionData.description,
            targets: actionData.targets,
            isExecuted,
          });
        } else {
          console.log(`    ❌ Doesn't match proposal`);
        }
      } catch (error) {
        console.error(`  Error parsing action from ${utxoKey}:`, error);
        continue;
      }
    }

    console.log(`  Found ${actions.length} matching actions`);
    actions.sort((a, b) => a.index - b.index);
    return actions;
  } catch (error) {
    console.error("Error finding proposal actions:", error);
    return [];
  }
}

export function parseActionDatum(
  datum: Core.PlutusData
): ParsedActionDatum | null {
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

    const activationTime = Number(fields.get(2).asInteger() ?? 0n);

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

    const option = Number(fields.get(4).asInteger() ?? 0n);

    // Parse targets (field 5)
    const targetsList = fields.get(5).asList();
    const targets: ActionTarget[] = [];

    if (targetsList) {
      for (let i = 0; i < targetsList.getLength(); i++) {
        const targetConstr = targetsList.get(i).asConstrPlutusData();
        if (!targetConstr) continue;

        const targetFields = targetConstr.getData();
        if (targetFields.getLength() < 4) continue;

        // Parse address - USE THE HELPER FUNCTION
        const address = plutusDataToAddress(targetFields.get(0));

        const coins = Number(targetFields.get(1).asInteger() ?? 0n);

        // Parse tokens (field 2) - Map<String, Map<String, BigInt>>
        const tokensMap = targetFields.get(2).asMap();
        const tokens: ActionTarget["tokens"] = [];

        if (tokensMap) {
          for (let j = 0; j < tokensMap.getKeys().getLength(); j++) {
            const policyIdBytes = tokensMap.getKeys().get(j).asBoundedBytes();
            if (!policyIdBytes) continue;

            const policyId = Core.toHex(policyIdBytes);
            const assetsMap = tokensMap
              .get(tokensMap.getKeys().get(j))
              ?.asMap();

            if (assetsMap) {
              for (let k = 0; k < assetsMap.getKeys().getLength(); k++) {
                const assetNameBytes = assetsMap
                  .getKeys()
                  .get(k)
                  .asBoundedBytes();
                if (!assetNameBytes) continue;

                const assetName = Core.toHex(assetNameBytes);
                const quantity = Number(
                  assetsMap.get(assetsMap.getKeys().get(k))?.asInteger() ?? 0n
                );

                tokens.push({
                  policyId,
                  assetName,
                  quantity,
                });
              }
            }
          }
        }

        // Parse datum (field 3)
        const datumConstr = targetFields.get(3).asConstrPlutusData();
        let datum: ActionTarget["datum"] = "NoDatum";

        if (datumConstr) {
          const datumAlt = Number(datumConstr.getAlternative());
          if (datumAlt === 1) {
            // InlineDatum case
            const datumFields = datumConstr.getData();
            if (datumFields.getLength() > 0) {
              const datumData = datumFields.get(0);
              datum = {
                type: "InlineDatum",
                data: datumData.toCbor(),
              };
            }
          }
        }

        targets.push({
          address,
          coins,
          tokens,
          datum,
        });
      }
    }

    // Parse treasury address (field 6) - USE THE HELPER FUNCTION
    const treasuryAddress = plutusDataToAddress(fields.get(6));

    return {
      name,
      description,
      activationTime,
      actionIdentifier: {
        proposal_policy_id: proposalPolicyId,
        proposal_identifier: proposalIdentifier,
        action_index: actionIndex,
      },
      option,
      targets,
      treasuryAddress,
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

export async function createActionDatum(
  action: ActionData,
  proposalPolicyId: string,
  proposalIdentifier: string,
  daoInfo: ExtendedDAOInfo,
  seedUtxo: TransactionUnspentOutput
): Promise<Core.PlutusData> {
  const fields = new Core.PlutusList();

  // Field 0: name
  fields.add(Core.PlutusData.newBytes(new TextEncoder().encode(action.name)));

  // Field 1: description
  fields.add(
    Core.PlutusData.newBytes(new TextEncoder().encode(action.description))
  );

  // Field 2: activation_time (BigInt)
  const activationTimeMs = new Date(action.activationTime).getTime();
  fields.add(Core.PlutusData.newInteger(BigInt(activationTimeMs)));

  // Field 3: action_identifier
  const actionIdentifierFields = new Core.PlutusList();
  actionIdentifierFields.add(
    Core.PlutusData.newBytes(Core.fromHex(proposalPolicyId))
  );
  actionIdentifierFields.add(
    Core.PlutusData.newBytes(Core.fromHex(proposalIdentifier))
  );
  actionIdentifierFields.add(Core.PlutusData.newInteger(0n));
  fields.add(
    Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(0n, actionIdentifierFields)
    )
  );

  // Field 4: option (BigInt)
  fields.add(Core.PlutusData.newInteger(1n));

  // Field 5: targets
  console.log("🎯 CREATING TARGETS LIST:");
  console.log(`  Number of targets: ${action.targets.length}`);

  const targetsList = new Core.PlutusList();
  for (const [index, target] of action.targets.entries()) {
    console.log(`\n  📍 TARGET ${index}:`);
    console.log(`    Address: ${target.address}`);
    console.log(`    Assets:`, target.assets);

    const targetFields = new Core.PlutusList();

    // Address field
    console.log("    🔍 Processing target address...");
    const targetAddressData = addressToPlutusData(target.address);
    console.log(
      "    🔍 Target address PlutusData CBOR:",
      targetAddressData.toCbor()
    );
    targetFields.add(targetAddressData);

    // Coins field
    const adaAsset = target.assets.find((a) => a.unit === "lovelace");
    const lovelaceAmount = adaAsset
      ? BigInt(parseFloat(adaAsset.quantity) * 1_000_000)
      : 0n;
    console.log(`    💰 Lovelace amount: ${lovelaceAmount}`);
    const coinsData = Core.PlutusData.newInteger(lovelaceAmount);
    console.log(`    💰 Coins PlutusData CBOR: ${coinsData.toCbor()}`);
    targetFields.add(coinsData);

    // Tokens field
    console.log("    🪙 Creating empty tokens map...");
    const emptyTokensRecord = new Core.PlutusMap();
    const tokensData = Core.PlutusData.newMap(emptyTokensRecord);
    console.log(`    🪙 Tokens PlutusData CBOR: ${tokensData.toCbor()}`);
    targetFields.add(tokensData);

    // Datum field
    console.log("    📄 Creating NoDatum...");
    const noDatum = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(0n, new Core.PlutusList())
    );
    console.log(`    📄 NoDatum PlutusData CBOR: ${noDatum.toCbor()}`);
    targetFields.add(noDatum);

    // Complete Target construction
    const targetData = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(0n, targetFields)
    );
    console.log(`    ✅ Complete Target ${index} CBOR: ${targetData.toCbor()}`);
    console.log(
      `    ✅ Target ${index} fields count: ${targetFields.getLength()}`
    );

    targetsList.add(targetData);
  }

  const targetsListData = Core.PlutusData.newList(targetsList);
  console.log(`\n🎯 FINAL TARGETS LIST:`);
  console.log(`  Targets list length: ${targetsList.getLength()}`);
  console.log(`  Targets list CBOR: ${targetsListData.toCbor()}`);

  fields.add(targetsListData);

  // Field 6: treasury
  const treasuryScript = createParameterizedScript("treasury.treasury.spend", [
    daoInfo.policyId,
    daoInfo.key,
  ]);
  const treasuryAddress = addressFromScript(treasuryScript);
  console.log("🔍 Processing treasury address:", treasuryAddress.toBech32());
  const treasuryAddressData = addressToPlutusData(treasuryAddress.toBech32());
  console.log(
    "🔍 Treasury address PlutusData CBOR:",
    treasuryAddressData.toCbor()
  );
  fields.add(treasuryAddressData);

  const actionDatum = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, fields)
  );

  console.log(`\n🏗️ COMPLETE ACTION DATUM:`);
  console.log(`  Fields count: ${fields.getLength()}`);
  console.log(`  Action datum CBOR: ${actionDatum.toCbor()}`);
  console.log(`  Action datum size: ${actionDatum.toCbor().length / 2} bytes`);

  return actionDatum;
}

export async function createProposalDatum(
  proposal: ProposalData,
  seedUtxo: Core.TransactionUnspentOutput
): Promise<Core.PlutusData> {
  const fieldsList = new Core.PlutusList();

  fieldsList.add(
    Core.PlutusData.newBytes(new TextEncoder().encode(proposal.name))
  );

  fieldsList.add(
    Core.PlutusData.newBytes(new TextEncoder().encode(proposal.description))
  );

  const tallyList = new Core.PlutusList();
  tallyList.add(Core.PlutusData.newInteger(0n));
  tallyList.add(Core.PlutusData.newInteger(0n));
  fieldsList.add(Core.PlutusData.newList(tallyList));

  const endTimeMs = new Date(proposal.endTime).getTime();
  fieldsList.add(Core.PlutusData.newInteger(BigInt(endTimeMs)));

  const statusData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, new Core.PlutusList())
  );
  fieldsList.add(statusData);

  const outputRefData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(
          Core.PlutusData.newBytes(
            Core.fromHex(seedUtxo.input().transactionId())
          )
        );
        list.add(Core.PlutusData.newInteger(BigInt(seedUtxo.input().index())));
        return list;
      })()
    )
  );
  fieldsList.add(outputRefData);

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, fieldsList)
  );
}

export function getActionIdentifier(
  proposalPolicyId: string,
  proposalIdentifier: string,
  actionIndex: number
): string {
  const actionIdentifierData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalPolicyId)));
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalIdentifier)));
        list.add(Core.PlutusData.newInteger(BigInt(actionIndex)));
        return list;
      })()
    )
  );

  return Core.blake2b_256(actionIdentifierData.toCbor());
}
