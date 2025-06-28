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
  const addr = Core.addressFromBech32(address);
  const addressBytes = addr.toBytes();

  // Parse header byte to determine address type
  const headerByte = parseInt(addressBytes.slice(0, 2), 16);

  // Extract payment credential (always 28 bytes after header)
  const paymentCredHash = addressBytes.slice(2, 58);
  const paymentIsScript = (headerByte & 0x10) !== 0;

  const paymentCredential: ParsedCredential = {
    type: paymentIsScript ? "Script" : "PubKey",
    hash: paymentCredHash,
  };

  // Check for stake credential (base addresses have them)
  let stakeCredential: ParsedCredential | undefined;

  // Base address (0x00-0x30) has stake credential
  if ((headerByte & 0x20) !== 0 && addressBytes.length >= 114) {
    const stakeCredHash = addressBytes.slice(58, 114);
    const stakeIsScript = (headerByte & 0x30) === 0x30;

    stakeCredential = {
      type: stakeIsScript ? "Script" : "PubKey",
      hash: stakeCredHash,
    };
  }

  return {
    paymentCredential,
    stakeCredential,
  };
}

export function addressToPlutusData(address: string): Core.PlutusData {
  const parsed = parseCardanoAddress(address);
  const addressFields = new Core.PlutusList();

  // Payment credential
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

  // Stake credential
  if (parsed.stakeCredential) {
    const stakeCredFields = new Core.PlutusList();
    const innerStakeCredFields = new Core.PlutusList();
    innerStakeCredFields.add(
      Core.PlutusData.newBytes(Core.fromHex(parsed.stakeCredential.hash))
    );

    const innerStakeCred = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(
        parsed.stakeCredential.type === "Script" ? 1n : 0n,
        innerStakeCredFields
      )
    );
    stakeCredFields.add(innerStakeCred);

    const stakeCred = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(0n, stakeCredFields) // Some
    );
    addressFields.add(stakeCred);
  } else {
    // None
    const stakeCredNone = Core.PlutusData.newConstrPlutusData(
      new Core.ConstrPlutusData(1n, new Core.PlutusList())
    );
    addressFields.add(stakeCredNone);
  }

  return Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(0n, addressFields)
  );
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
      const innerStakeCredConstr = stakeCredFields.get(0).asConstrPlutusData();
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
