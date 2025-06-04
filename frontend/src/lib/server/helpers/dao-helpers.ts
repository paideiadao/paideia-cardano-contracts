import { Core } from "@blaze-cardano/sdk";
import {
  addressFromScript,
  createParameterizedScript,
  extractInlineDatum,
  findUTXOWithAsset,
  getUTXOsWithFallback,
} from "./script-helpers";

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
