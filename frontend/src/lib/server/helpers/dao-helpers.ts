import { Core } from "@blaze-cardano/sdk";
import {
  addressFromScript,
  createParameterizedScript,
  extractInlineDatum,
  getNetworkId,
  getScriptPolicyId,
  getUTXOsWithFallback,
} from "./script-helpers";
import { findUTXOWithAsset } from "./utxo-helpers";

export interface FullDAODatum {
  name: string;
  governance_token: string;
  threshold: number;
  min_proposal_time: number;
  max_proposal_time: number;
  quorum: number;
  min_gov_proposal_create: number;
  whitelisted_proposals: string[];
  whitelisted_actions: string[];
}

export interface DeployedScriptReference {
  txHash: string;
  outputIndex: number;
  scriptHash: string;
}

export interface DAOScriptReferences {
  vote: DeployedScriptReference;
  treasury: DeployedScriptReference;
  proposal: DeployedScriptReference;
  actionSendFunds: DeployedScriptReference;
}

/**
 * Extract script references from DAO NFT metadata
 * The DAO NFT should contain metadata with deployed script info
 */
export async function getDAOScriptReferences(
  daoUtxo: Core.TransactionUnspentOutput
): Promise<DAOScriptReferences> {
  // The DAO NFT metadata contains the script deployment info
  // We need to extract this from the NFT metadata
  // For now, let's scan for deployed scripts based on the DAO parameters

  throw new Error(
    "Not implemented - need to extract from DAO NFT metadata or scan deployed scripts"
  );
}

/**
 * Get vote script hash from DAO's whitelisted proposals
 * The vote script hash should be derivable from DAO parameters
 */
export function getVoteScriptHashFromDAO(
  daoPolicyId: string,
  daoKey: string
): string {
  const voteScript = createParameterizedScript("vote.vote.spend", [
    daoPolicyId,
    daoKey,
  ]);
  return voteScript.hash();
}

/**
 * Find deployed script UTXO by scanning burn address
 */
export async function findDeployedScriptUtxo(
  scriptHash: string
): Promise<Core.TransactionUnspentOutput | null> {
  const networkId = getNetworkId();
  const burnAddress = Core.getBurnAddress(networkId);

  try {
    const utxos = await getUTXOsWithFallback(burnAddress);

    // Find UTXO with matching reference script
    for (const utxo of utxos) {
      // Check if this UTXO has a reference script with matching hash
      // This requires checking the reference script field
      // For now, we'll need to implement this based on Blaze SDK capabilities
    }

    return null;
  } catch (error) {
    console.error("Error finding deployed script UTXO:", error);
    return null;
  }
}

/**
 * Alternative: Use Maestro API to find deployed script
 */
export async function findDeployedScriptUtxoViaMaestro(
  scriptHash: string
): Promise<{
  txHash: string;
  outputIndex: number;
  scriptHash: string;
} | null> {
  try {
    const maestroApiKey = process.env.MAESTRO_API_KEY!;
    const network = process.env.NETWORK!;
    const maestroNetwork = network === "mainnet" ? "mainnet" : "preview";
    const networkId = getNetworkId();
    const burnAddress = Core.getBurnAddress(networkId);

    const url = `https://${maestroNetwork}.gomaestro-api.org/v1/addresses/${burnAddress.toBech32()}/utxos?order=desc&count=100`;

    const response = await fetch(url, {
      headers: { "api-key": maestroApiKey },
    });

    if (!response.ok) {
      throw new Error(`Maestro API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Maestro returned ${data.data.length} UTXOs from burn address`);

    // Find UTXO with matching reference script
    const deploymentUtxo = data.data.find(
      (utxo: any) => utxo.reference_script?.hash === scriptHash
    );

    if (deploymentUtxo) {
      return {
        txHash: deploymentUtxo.tx_hash,
        outputIndex: deploymentUtxo.index,
        scriptHash,
      };
    }

    return null;
  } catch (error) {
    console.error("Maestro search error:", error);
    throw error;
  }
}

/**
 * Get all script references needed for a specific DAO operation
 */
export async function getRequiredScriptReferences(
  daoPolicyId: string,
  daoKey: string,
  operation: "vote" | "proposal" | "treasury" | "action"
): Promise<{
  voteScript?: DeployedScriptReference;
  proposalScript?: DeployedScriptReference;
  treasuryScript?: DeployedScriptReference;
  actionScript?: DeployedScriptReference;
}> {
  const results: any = {};

  if (operation === "vote" || operation === "proposal") {
    const voteScriptHash = getVoteScriptHashFromDAO(daoPolicyId, daoKey);
    results.voteScript = await findDeployedScriptUtxoViaMaestro(voteScriptHash);
  }

  if (operation === "proposal") {
    // Calculate proposal script hash
    const votePolicyId = getScriptPolicyId("vote.vote.mint", [
      daoPolicyId,
      daoKey,
    ]);
    const proposalScript = createParameterizedScript(
      "proposal.proposal.spend",
      [daoPolicyId, daoKey, votePolicyId]
    );
    results.proposalScript = await findDeployedScriptUtxoViaMaestro(
      proposalScript.hash()
    );
  }

  // Add treasury and action script lookups as needed

  return results;
}

export async function getDaoUtxo(
  policyId: string,
  key: string
): Promise<Core.TransactionUnspentOutput | null> {
  const daoScript = createParameterizedScript("dao.dao.spend", []);
  const daoAddress = addressFromScript(daoScript);
  const utxos = await getUTXOsWithFallback(daoAddress);

  return findUTXOWithAsset(utxos, policyId, key, 1n);
}

export async function fetchDAOInfo(daoPolicyId: string, daoKey: string) {
  const daoUtxo = await getDaoUtxo(daoPolicyId, daoKey);
  if (!daoUtxo) {
    throw new Error(
      `DAO not found with Policy ID: ${daoPolicyId} and Key: ${daoKey}`
    );
  }

  const datum = extractInlineDatum(daoUtxo);

  return {
    ...parseDAODatum(datum),
    policyId: daoPolicyId,
    key: daoKey,
    utxo: daoUtxo, // Include the UTXO for callers that need it
  };
}

export function parseDAODatum(datum: Core.PlutusData): FullDAODatum {
  const constr = datum.asConstrPlutusData();
  if (!constr || constr.getAlternative() !== 0n) {
    throw new Error("Invalid DAO datum structure");
  }

  const fields = constr.getData();
  if (fields.getLength() < 9) {
    throw new Error("DAO datum missing required fields");
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
    whitelisted_proposals: parseStringList(fields.get(7)),
    whitelisted_actions: parseStringList(fields.get(8)),
  };
}

function parseStringList(data: Core.PlutusData): string[] {
  try {
    const list = data.asList();
    if (!list) return [];

    const result: string[] = [];
    for (let i = 0; i < list.getLength(); i++) {
      const item = list.get(i).asBoundedBytes();
      if (item) {
        result.push(Core.toHex(item));
      }
    }
    return result;
  } catch {
    return [];
  }
}

export function parseGovernanceToken(governanceTokenHex: string): {
  policyId: string;
  assetName: string;
  fullAssetId: string;
} {
  const policyId = governanceTokenHex.slice(0, 56);
  const assetName = governanceTokenHex.slice(56);
  return {
    policyId,
    assetName,
    fullAssetId: Core.AssetId.fromParts(
      Core.PolicyId(policyId),
      Core.AssetName(assetName)
    ),
  };
}

export async function countGovernanceTokens(
  voteUtxo: Core.TransactionUnspentOutput,
  daoPolicyId: string,
  daoKey: string
): Promise<number> {
  try {
    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);
    const govTokenHex = daoInfo.governance_token;
    const govPolicyId = govTokenHex.slice(0, 56);
    const govAssetName = govTokenHex.slice(56);

    const value = voteUtxo.output().amount().toCore();
    if (value.assets) {
      for (const [assetId, quantity] of value.assets) {
        const policyId = Core.AssetId.getPolicyId(assetId);
        const assetNameFromId = Core.AssetId.getAssetName(assetId);

        if (policyId === govPolicyId && assetNameFromId === govAssetName) {
          return Number(quantity);
        }
      }
    }

    return 0;
  } catch (error) {
    console.error("Error counting governance tokens:", error);
    return 0;
  }
}
