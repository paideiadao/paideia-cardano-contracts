import { Core } from "@blaze-cardano/sdk";
import { getNetworkId } from "./script-helpers";

export interface ParsedCredential {
  type: "PubKey" | "Script";
  hash: string;
}

export interface ParsedAddress {
  paymentCredential: ParsedCredential;
  stakeCredential?: ParsedCredential;
}

export function parseCardanoAddress(address: string): ParsedAddress {
  console.log(`🔍 PARSING ADDRESS: ${address}`);

  const addr = Core.addressFromBech32(address);
  const addressBytes = addr.toBytes();

  console.log(`  Raw bytes: ${addressBytes}`);
  console.log(`  Bytes length: ${addressBytes.length}`);

  // Parse header byte to determine address type
  const headerByte = parseInt(addressBytes.slice(0, 2), 16);
  console.log(
    `  Header byte: 0x${headerByte
      .toString(16)
      .padStart(2, "0")} (${headerByte})`
  );

  const addressType = (headerByte >> 4) & 0x0f;
  console.log(
    `  Address type: ${addressType} (${
      addressType <= 0x03 ? "Base" : "Enterprise/Other"
    })`
  );

  // Extract payment credential (always 28 bytes after header)
  const paymentCredHash = addressBytes.slice(2, 58);
  const paymentIsScript = (headerByte & 0x10) !== 0;
  console.log(`  Payment cred hash: ${paymentCredHash}`);
  console.log(`  Payment is script: ${paymentIsScript}`);

  const paymentCredential: ParsedCredential = {
    type: paymentIsScript ? "Script" : "PubKey",
    hash: paymentCredHash,
  };

  // Check for stake credential (base addresses have them)
  let stakeCredential: ParsedCredential | undefined;

  const isBaseAddress = addressType <= 0x03;
  console.log(`  Is base address: ${isBaseAddress}`);
  console.log(`  Address bytes length >= 114: ${addressBytes.length >= 114}`);

  if (isBaseAddress && addressBytes.length >= 114) {
    const stakeCredHash = addressBytes.slice(58, 114);
    const stakeIsScript = (headerByte & 0x02) !== 0;

    console.log(`  Stake cred hash: ${stakeCredHash}`);
    console.log(`  Stake is script: ${stakeIsScript}`);

    stakeCredential = {
      type: stakeIsScript ? "Script" : "PubKey",
      hash: stakeCredHash,
    };
  } else {
    console.log(`  No stake credential detected`);
  }

  const result = {
    paymentCredential,
    stakeCredential,
  };

  console.log(`  Final parsed result:`, result);
  return result;
}

export function addressToPlutusData(address: string): Core.PlutusData {
  console.log(`🔧 CONVERTING TO PLUTUS DATA: ${address}`);

  const parsed = parseCardanoAddress(address);
  const addressFields = new Core.PlutusList();

  // Payment credential
  console.log(`  Creating payment credential PlutusData...`);
  const paymentCredFields = new Core.PlutusList();
  paymentCredFields.add(
    Core.PlutusData.newBytes(Core.fromHex(parsed.paymentCredential.hash))
  );

  const paymentCred = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      parsed.paymentCredential.type === "Script" ? 1n : 0n,
      paymentCredFields
    )
  );
  addressFields.add(paymentCred);
  console.log(`  Payment credential CBOR: ${paymentCred.toCbor()}`);

  // Stake credential with Inline wrapper
  if (parsed.stakeCredential) {
    // Create the inner credential
    const innerCredential = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(
        parsed.stakeCredential.type === "Script" ? 1n : 0n,
        (() => {
          const credFields = new Core.PlutusList();
          credFields.add(
            Core.PlutusData.newBytes(Core.fromHex(parsed.stakeCredential.hash))
          );
          return credFields;
        })()
      )
    );

    // Wrap in Inline (constructor 0)
    const inlineStakeCred = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(
        0n,
        (() => {
          const inlineFields = new Core.PlutusList();
          inlineFields.add(innerCredential);
          return inlineFields;
        })()
      )
    );

    // Wrap in Some (constructor 0)
    const stakeCred = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(
        0n,
        (() => {
          const someFields = new Core.PlutusList();
          someFields.add(inlineStakeCred);
          return someFields;
        })()
      )
    );

    addressFields.add(stakeCred);
  } else {
    console.log(`  Creating stake credential PlutusData (None)...`);
    // None
    const stakeCredNone = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(1n, new Core.PlutusList())
    );
    addressFields.add(stakeCredNone);
    console.log(`  None stake credential CBOR: ${stakeCredNone.toCbor()}`);
  }

  const result = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, addressFields)
  );

  console.log(`  Final address PlutusData CBOR: ${result.toCbor()}`);
  return result;
}

export function plutusDataToAddress(plutusData: Core.PlutusData): string {
  const constr = plutusData.asConstrPlutusData();
  if (!constr || constr.getAlternative() !== 0n) {
    throw new Error("Invalid address PlutusData structure");
  }

  const fields = constr.getData();
  if (fields.getLength() < 2) {
    throw new Error("Address must have payment and stake credential fields");
  }

  // Parse payment credential
  const paymentCredConstr = fields.get(0).asConstrPlutusData();
  if (!paymentCredConstr) {
    throw new Error("Invalid payment credential structure");
  }

  const paymentCredType = Number(paymentCredConstr.getAlternative());
  const paymentCredFields = paymentCredConstr.getData();
  const paymentCredHash = paymentCredFields.get(0).asBoundedBytes();

  if (!paymentCredHash) {
    throw new Error("Missing payment credential hash");
  }

  // Parse stake credential
  const stakeCredConstr = fields.get(1).asConstrPlutusData();
  const hasStakeCredential = stakeCredConstr?.getAlternative() === 0n;

  const networkId = getNetworkId();

  if (hasStakeCredential && stakeCredConstr) {
    const stakeCredFields = stakeCredConstr.getData();
    if (stakeCredFields.getLength() > 0) {
      // First unwrap the Inline wrapper (constructor 0)
      const inlineStakeCredConstr = stakeCredFields.get(0).asConstrPlutusData();
      if (
        inlineStakeCredConstr &&
        inlineStakeCredConstr.getAlternative() === 0n
      ) {
        const inlineFields = inlineStakeCredConstr.getData();
        if (inlineFields.getLength() > 0) {
          // Now get the actual Credential
          const innerStakeCredConstr = inlineFields.get(0).asConstrPlutusData();
          if (innerStakeCredConstr) {
            const stakeCredType = Number(innerStakeCredConstr.getAlternative());
            const innerStakeCredFields = innerStakeCredConstr.getData();
            const stakeCredHash = innerStakeCredFields.get(0).asBoundedBytes();

            if (stakeCredHash) {
              // Create credentials using the actual available API
              const paymentCredential = Core.Credential.fromCore({
                type:
                  paymentCredType === 0
                    ? Core.CredentialType.KeyHash
                    : Core.CredentialType.ScriptHash,
                hash: Core.Hash28ByteBase16(Core.toHex(paymentCredHash)),
              });

              const stakeCredential = Core.Credential.fromCore({
                type:
                  stakeCredType === 0
                    ? Core.CredentialType.KeyHash
                    : Core.CredentialType.ScriptHash,
                hash: Core.Hash28ByteBase16(Core.toHex(stakeCredHash)),
              });

              // Use addressFromCredentials for base addresses
              return Core.addressFromCredentials(
                networkId,
                paymentCredential,
                stakeCredential
              ).toBech32();
            }
          }
        }
      }
    }
  }

  // Enterprise address (no stake credential)
  const paymentCredential = Core.Credential.fromCore({
    type:
      paymentCredType === 0
        ? Core.CredentialType.KeyHash
        : Core.CredentialType.ScriptHash,
    hash: Core.Hash28ByteBase16(Core.toHex(paymentCredHash)),
  });

  return Core.addressFromCredential(networkId, paymentCredential).toBech32();
}
