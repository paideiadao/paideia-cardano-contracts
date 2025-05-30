/**
 * CIP-68 Metadata structures and utilities
 */

import { mConStr0 } from "@meshsdk/core";

// Base interfaces for different token standards
export interface Cip68NftMetadata {
  name: string;
  image: string; // Required for NFTs
  description?: string;
  files?: Array<{
    name?: string;
    mediaType: string;
    src: string;
  }>;
  [key: string]: any; // Additional properties allowed
}

export interface Cip68FungibleMetadata {
  name: string;
  description: string;
  ticker?: string;
  url?: string;
  decimals?: number;
  logo?: string;
  [key: string]: any; // Additional properties allowed
}

export interface Cip68RichFungibleMetadata {
  name: string;
  image: string; // Required for RFTs
  description?: string;
  decimals?: number;
  files?: Array<{
    name?: string;
    mediaType: string;
    src: string;
  }>;
  [key: string]: any; // Additional properties allowed
}

export interface Cip68Datum {
  metadata:
    | Cip68NftMetadata
    | Cip68FungibleMetadata
    | Cip68RichFungibleMetadata;
  version: number;
  extra: any; // Required field for custom plutus data
}

export type TokenStandard = 222 | 333 | 444; // NFT, FT, RFT

export function createCip68Datum(
  standard: TokenStandard,
  metadata: any,
  extra: any = null // Unit/Void placeholder
): Cip68Datum {
  // Validate required fields based on standard
  validateMetadataForStandard(standard, metadata);

  return {
    metadata,
    version: getVersionForStandard(standard),
    extra: extra ?? null, // Default to null (Unit/Void equivalent)
  };
}

function validateMetadataForStandard(
  standard: TokenStandard,
  metadata: any
): void {
  switch (standard) {
    case 222: // NFT
      if (!metadata.name || !metadata.image) {
        throw new Error("NFT metadata must include 'name' and 'image' fields");
      }
      break;
    case 333: // FT
      if (!metadata.name || !metadata.description) {
        throw new Error(
          "FT metadata must include 'name' and 'description' fields"
        );
      }
      break;
    case 444: // RFT
      if (!metadata.name || !metadata.image) {
        throw new Error("RFT metadata must include 'name' and 'image' fields");
      }
      break;
  }
}

function getVersionForStandard(standard: TokenStandard): number {
  switch (standard) {
    case 222:
    case 333:
      return 1; // NFT and FT standards use version 1
    case 444:
      return 2; // RFT standard uses version 2
  }
}

/**
 * Convert metadata to Plutus CBOR format
 * Constructor 0 with fields: [metadata_map, version_int, extra]
 */
export function metadataToPlutusCbor(datum: Cip68Datum): any {
  // Use actual Map instead of array
  const metadataMap = new Map();

  Object.entries(datum.metadata).forEach(([key, value]) => {
    const keyHex = stringToHex(key);

    if (typeof value === "string") {
      metadataMap.set({ bytes: keyHex }, { bytes: stringToHex(value) });
    } else if (typeof value === "number") {
      metadataMap.set({ bytes: keyHex }, { int: value });
    } else if (Array.isArray(value)) {
      metadataMap.set(
        { bytes: keyHex },
        { bytes: stringToHex(JSON.stringify(value)) }
      );
    }
  });

  // Return format that Blaze expects
  return [
    metadataMap, // Map instead of { map: [...] }
    datum.version, // number instead of { int: ... }
    null, // null instead of datum.extra
  ];
}

export function meshMetadataToPlutusCbor(datum: Cip68Datum): any {
  const metadataMap: Array<{
    k: { bytes: string };
    v: { bytes: string } | { int: number };
  }> = [];

  // Convert each metadata field to proper CBOR format
  Object.entries(datum.metadata).forEach(([key, value]) => {
    const keyHex = stringToHex(key);

    if (typeof value === "string") {
      metadataMap.push({
        k: { bytes: keyHex },
        v: { bytes: stringToHex(value) },
      });
    } else if (typeof value === "number") {
      metadataMap.push({
        k: { bytes: keyHex },
        v: { int: value },
      });
    } else if (Array.isArray(value)) {
      metadataMap.push({
        k: { bytes: keyHex },
        v: { bytes: stringToHex(JSON.stringify(value)) },
      });
    }
  });

  // Use MeshSDK's constructor helper instead of raw JSON
  return mConStr0([
    { map: metadataMap },
    { int: datum.version },
    datum.extra ?? null,
  ]);
}

export function stringToHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// Helper functions for creating specific token types
export function createNftDatum(
  metadata: Cip68NftMetadata,
  extra?: any
): Cip68Datum {
  return createCip68Datum(222, metadata, extra);
}

export function createFungibleDatum(
  metadata: Cip68FungibleMetadata,
  extra?: any
): Cip68Datum {
  return createCip68Datum(333, metadata, extra);
}

export function createRichFungibleDatum(
  metadata: Cip68RichFungibleMetadata,
  extra?: any
): Cip68Datum {
  return createCip68Datum(444, metadata, extra);
}
