import { Core } from "@blaze-cardano/sdk";
import {
  addressFromScript,
  createParameterizedScript,
  extractInlineDatum,
  getNetworkId,
  getUTXOsWithFallback,
} from "./script-helpers";
import { findUTXOWithAsset } from "./utxo-helpers";
import { prisma } from "@/lib/prisma";

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
  const cached = await prisma.deployedScript.findUnique({
    where: { scriptHash },
  });

  if (cached) {
    return {
      txHash: cached.txHash,
      outputIndex: cached.outputIndex,
      scriptHash: cached.scriptHash,
    };
  }

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
      const result = {
        txHash: deploymentUtxo.tx_hash,
        outputIndex: deploymentUtxo.index,
        scriptHash,
      };

      // Cache the result
      await prisma.deployedScript.create({
        data: {
          scriptHash,
          txHash: result.txHash,
          outputIndex: result.outputIndex,
          network: process.env.NETWORK!,
          // Add other fields as needed
        },
      });

      return result;
    }

    return null;
  } catch (error) {
    console.error("Maestro search error:", error);
    throw error;
  }
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
  const cachedDao = await prisma.dao.findUnique({
    where: { policyId: daoPolicyId },
    include: { scripts: true },
  });

  if (cachedDao) {
    // Reconstruct the full UTXO
    const utxo = reconstructUtxoFromDb(cachedDao);

    return {
      name: cachedDao.name,
      governance_token: cachedDao.governanceToken,
      threshold: cachedDao.threshold,
      min_proposal_time: cachedDao.minProposalTime,
      max_proposal_time: cachedDao.maxProposalTime,
      quorum: cachedDao.quorum,
      min_gov_proposal_create: cachedDao.minGovProposalCreate,
      whitelisted_proposals: cachedDao.whitelistedProposals as string[],
      whitelisted_actions: cachedDao.whitelistedActions as string[],
      policyId: daoPolicyId,
      key: daoKey,
      utxo,
      scripts: cachedDao.scripts,
    };
  }

  // Fallback to Maestro
  const daoUtxo = await getDaoUtxo(daoPolicyId, daoKey);
  if (!daoUtxo) {
    throw new Error(
      `DAO not found with Policy ID: ${daoPolicyId} and Key: ${daoKey}`
    );
  }

  const datum = extractInlineDatum(daoUtxo);
  const parsedDao = parseDAODatum(datum);

  // Save complete UTXO data
  await prisma.dao.upsert({
    where: { policyId: daoPolicyId },
    update: {
      // Update fields if needed when DAO data changes
      name: parsedDao.name,
      governanceToken: parsedDao.governance_token,
      threshold: parsedDao.threshold,
      minProposalTime: parsedDao.min_proposal_time,
      maxProposalTime: parsedDao.max_proposal_time,
      quorum: parsedDao.quorum,
      minGovProposalCreate: parsedDao.min_gov_proposal_create,
      whitelistedProposals: parsedDao.whitelisted_proposals,
      whitelistedActions: parsedDao.whitelisted_actions,
      utxoTxHash: daoUtxo.input().transactionId(),
      utxoIndex: Number(daoUtxo.input().index()),
      utxoAddress: daoUtxo.output().address().toBech32(),
      utxoValue: serializeValue(daoUtxo.output().amount()),
      utxoDatum: daoUtxo.output().datum()?.asInlineData()?.toCbor(),
    },
    create: {
      policyId: daoPolicyId,
      name: parsedDao.name,
      governanceToken: parsedDao.governance_token,
      threshold: parsedDao.threshold,
      minProposalTime: parsedDao.min_proposal_time,
      maxProposalTime: parsedDao.max_proposal_time,
      quorum: parsedDao.quorum,
      minGovProposalCreate: parsedDao.min_gov_proposal_create,
      whitelistedProposals: parsedDao.whitelisted_proposals,
      whitelistedActions: parsedDao.whitelisted_actions,
      deploymentTx: daoUtxo.input().transactionId(),
      address: addressFromScript(
        createParameterizedScript("dao.dao.spend", [])
      ).toBech32(),
      network: process.env.NETWORK!,
      utxoTxHash: daoUtxo.input().transactionId(),
      utxoIndex: Number(daoUtxo.input().index()),
      utxoAddress: daoUtxo.output().address().toBech32(),
      utxoValue: serializeValue(daoUtxo.output().amount()),
      utxoDatum: daoUtxo.output().datum()?.asInlineData()?.toCbor(),
    },
  });

  return {
    ...parsedDao,
    policyId: daoPolicyId,
    key: daoKey,
    utxo: daoUtxo,
    scripts: [],
  };
}

function reconstructUtxoFromDb(cachedDao: any): Core.TransactionUnspentOutput {
  const input = new Core.TransactionInput(
    Core.TransactionId(cachedDao.utxoTxHash),
    BigInt(cachedDao.utxoIndex)
  );

  const address = Core.addressFromBech32(cachedDao.utxoAddress);
  const value = deserializeValue(cachedDao.utxoValue);

  const output = new Core.TransactionOutput(address, value);

  // Set datum if it exists
  if (cachedDao.utxoDatum) {
    const datum = Core.Datum.newInlineData(
      Core.PlutusData.fromCbor(Core.HexBlob(cachedDao.utxoDatum))
    );
    output.setDatum(datum);
  }

  return new Core.TransactionUnspentOutput(input, output);
}

function serializeValue(value: Core.Value): string {
  return value.toCbor(); // Store as hex string
}

function deserializeValue(serialized: string): Core.Value {
  return Core.Value.fromCbor(Core.HexBlob(serialized));
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
