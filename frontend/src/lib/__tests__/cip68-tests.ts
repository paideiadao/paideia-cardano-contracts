import {
  createNftDatum,
  createFungibleDatum,
  createRichFungibleDatum,
  metadataToPlutusCbor,
  TokenStandard,
} from "../cip68-metadata";

describe("CIP-68 Metadata", () => {
  test("creates valid NFT datum (222)", () => {
    const metadata = {
      name: "SpaceBud",
      image: "ipfs://test",
      description: "Test NFT",
    };

    const datum = createNftDatum(metadata);
    expect(datum.version).toBe(1);
    expect(datum.metadata.name).toBe("SpaceBud");
    expect(datum.extra).toBeNull();
  });

  test("creates valid FT datum (333)", () => {
    const metadata = {
      name: "TestToken",
      description: "This is my test token",
      ticker: "TEST",
      decimals: 6,
    };

    const datum = createFungibleDatum(metadata);
    expect(datum.version).toBe(1);
    expect(datum.metadata.decimals).toBe(6);
  });

  test("creates valid RFT datum (444)", () => {
    const metadata = {
      name: "FractionalArt",
      image: "ipfs://art-image",
      decimals: 2,
    };

    const datum = createRichFungibleDatum(metadata);
    expect(datum.version).toBe(2); // RFT uses version 2
  });

  test("converts to proper CBOR format", () => {
    const metadata = { name: "Test", description: "Description" };
    const datum = createFungibleDatum(metadata);
    const cbor = metadataToPlutusCbor(datum);

    expect(cbor.constructor).toBe(0);
    expect(cbor.fields).toHaveLength(3); // metadata, version, extra
    expect(cbor.fields[1]).toEqual({ int: 1 });
    expect(cbor.fields[0].map).toBeDefined();
  });

  test("validates required fields", () => {
    expect(() => createNftDatum({ name: "Test" } as any)).toThrow();
    expect(() => createFungibleDatum({ name: "Test" } as any)).toThrow();
  });

  test("handles custom extra field", () => {
    const metadata = { name: "Test", image: "ipfs://test" };
    const customExtra = { customField: "value" };
    const datum = createNftDatum(metadata, customExtra);

    expect(datum.extra).toEqual(customExtra);
  });
});
