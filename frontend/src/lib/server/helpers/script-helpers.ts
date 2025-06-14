import { applyParamsToScript, cborToScript, Core } from "@blaze-cardano/sdk";
import plutusJson from "@/lib/scripts/plutus.json";
import { Type } from "@blaze-cardano/data";
import { blazeMaestroProvider } from "../blaze";
import { maestroProvider } from "../maestro";

export function createParameterizedScript(
  validatorTitle: string,
  params: string[]
): Core.Script {
  const validator = plutusJson.validators.find(
    (v) => v.title === validatorTitle
  );
  if (!validator) {
    throw new Error(`Validator '${validatorTitle}' not found in plutus.json`);
  }

  const parameterizedScript = (applyParamsToScript as any)(
    validator.compiledCode,
    Type.Tuple(params.map(() => Type.String())),
    params
  );

  return cborToScript(parameterizedScript, "PlutusV3");
}

export function getScriptPolicyId(
  validatorTitle: string,
  params: string[]
): string {
  return createParameterizedScript(validatorTitle, params).hash();
}

export function createUnparameterizedScript(
  validatorTitle: string
): Core.Script {
  const validator = plutusJson.validators.find(
    (v) => v.title === validatorTitle
  );
  if (!validator) {
    throw new Error(`Validator '${validatorTitle}' not found in plutus.json`);
  }

  return cborToScript(validator.compiledCode, "PlutusV3");
}

export function getScriptAddress(
  validatorTitle: string,
  params?: string[]
): Core.Address {
  const script = params?.length
    ? createParameterizedScript(validatorTitle, params)
    : createUnparameterizedScript(validatorTitle);

  const network = process.env.NETWORK === "preview" ? 0 : 1;
  return Core.addressFromValidator(network, script);
}

export async function getScriptUtxos(
  validatorTitle: string,
  params?: string[]
): Promise<Core.TransactionUnspentOutput[]> {
  const address = getScriptAddress(validatorTitle, params);
  return blazeMaestroProvider.getUnspentOutputs(address);
}

export function getNetworkId(): number {
  const network = process.env.NETWORK?.toLowerCase();

  if (network === "mainnet") {
    return 1;
  }

  if (network === "preview" || network === "preprod") {
    return 0;
  }

  // Default to mainnet for safety (prevents accidentally using testnet addresses)
  console.warn(`Unknown network: ${network}, defaulting to mainnet`);
  return 1;
}

export function addressFromScript(script: Core.Script): Core.Address {
  return Core.addressFromValidator(getNetworkId(), script);
}

export async function getUTXOsWithFallback(
  address: Core.Address,
  fallbackValue: any[] = []
): Promise<Core.TransactionUnspentOutput[]> {
  try {
    return await blazeMaestroProvider.getUnspentOutputs(address);
  } catch (error) {
    console.log(`No UTXOs found at address ${address.toBech32()}`);
    return fallbackValue;
  }
}

export function extractInlineDatum(
  utxo: Core.TransactionUnspentOutput
): Core.PlutusData {
  const datum = utxo.output().datum()?.asInlineData();
  if (!datum) {
    throw new Error("UTXO missing inline datum");
  }
  return datum;
}

export function aggregateAssets(
  utxos: Core.TransactionUnspentOutput[]
): Array<{ unit: string; quantity: string }> {
  const assetMap = new Map<string, bigint>();

  for (const utxo of utxos) {
    const value = utxo.output().amount();

    // Add ADA
    const ada = value.coin();
    assetMap.set("lovelace", (assetMap.get("lovelace") ?? 0n) + ada);

    // Add other assets
    const coreValue = value.toCore();
    if (coreValue.assets) {
      for (const [assetId, quantity] of coreValue.assets) {
        assetMap.set(assetId, (assetMap.get(assetId) ?? 0n) + quantity);
      }
    }
  }

  return Array.from(assetMap.entries()).map(([unit, quantity]) => ({
    unit,
    quantity: quantity.toString(),
  }));
}

function normalizeNetworkName(
  network: string
): keyof typeof Core.SLOT_CONFIG_NETWORK {
  const normalized =
    network.charAt(0).toUpperCase() + network.slice(1).toLowerCase();

  if (
    normalized === "Mainnet" ||
    normalized === "Preview" ||
    normalized === "Preprod"
  ) {
    return normalized;
  }

  throw new Error(`Unsupported network: ${network}`);
}

export function getCurrentSlot(): bigint {
  const network = normalizeNetworkName(process.env.NETWORK!);
  const slotConfig = Core.SLOT_CONFIG_NETWORK[network];
  const currentTime = Date.now(); // Keep in milliseconds
  const slotsSinceZero = Math.floor(
    (currentTime - slotConfig.zeroTime) / slotConfig.slotLength
  );
  return BigInt(slotConfig.zeroSlot + slotsSinceZero);
}

export function slotToTimestamp(slot: bigint): number {
  const network = normalizeNetworkName(process.env.NETWORK!);
  const slotConfig = Core.SLOT_CONFIG_NETWORK[network];

  const slotsSinceZero = Number(slot) - slotConfig.zeroSlot;
  return slotConfig.zeroTime + slotsSinceZero * slotConfig.slotLength;
}

export function timestampToSlot(unixTimestamp: number): bigint {
  const network = normalizeNetworkName(process.env.NETWORK!);
  const slotConfig = Core.SLOT_CONFIG_NETWORK[network];

  // Auto-detect if timestamp is in seconds or milliseconds
  // Timestamps in seconds are typically 10 digits (1.7B range for 2024+)
  // Timestamps in milliseconds are typically 13 digits (1.7T range for 2024+)
  let timestampMs: number;

  if (unixTimestamp < 10000000000) {
    // Looks like seconds - convert to milliseconds
    timestampMs = unixTimestamp * 1000;
  } else {
    // Looks like milliseconds already
    timestampMs = unixTimestamp;
  }

  const slotsSinceZero = Math.floor(
    (timestampMs - slotConfig.zeroTime) / slotConfig.slotLength
  );
  return BigInt(slotConfig.zeroSlot) + BigInt(slotsSinceZero);
}
