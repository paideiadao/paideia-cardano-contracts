import {
  generateCip67Label,
  validateCip67Label,
  CIP68_LABELS,
  checksum,
} from "../cip67-labels";

describe("CIP-67 Label Generation", () => {
  test("generates correct label for 222 (from spec example)", () => {
    const result = generateCip67Label(222);
    expect(result).toBe("000de140");
  });

  test("validates correct label for 222 (from spec example)", () => {
    const result = validateCip67Label("000de140");
    expect(result.isValid).toBe(true);
    expect(result.labelNum).toBe(222);
  });

  test("verifies spec example step by step", () => {
    // 1. Convert 222 to hex and pad => 0x00de
    const labelNum = 222;
    const numHex = labelNum.toString(16).padStart(4, "0");
    expect(numHex).toBe("00de");

    // 2. Calculate CRC-8 checksum => should be 0x14
    const calculatedChecksum = checksum(numHex);
    expect(calculatedChecksum).toBe("14");

    // 3. Add brackets and combine => 0x000de140
    const result = "0" + numHex + calculatedChecksum + "0";
    expect(result).toBe("000de140");

    // Full function should produce same result
    expect(generateCip67Label(222)).toBe("000de140");
  });

  test("round-trip works for all common CIP-68 labels", () => {
    Object.values(CIP68_LABELS).forEach((labelNum) => {
      const label = generateCip67Label(labelNum);
      const validation = validateCip67Label(label);
      expect(validation.isValid).toBe(true);
      expect(validation.labelNum).toBe(labelNum);
    });
  });

  test("handles edge cases", () => {
    expect(generateCip67Label(0)).toMatch(/^0[0-9a-f]{6}0$/);
    expect(generateCip67Label(65535)).toMatch(/^0[0-9a-f]{6}0$/);

    expect(validateCip67Label(generateCip67Label(0)).labelNum).toBe(0);
    expect(validateCip67Label(generateCip67Label(65535)).labelNum).toBe(65535);
  });

  test("throws error for invalid label numbers", () => {
    expect(() => generateCip67Label(-1)).toThrow();
    expect(() => generateCip67Label(65536)).toThrow();
  });

  test("validates format correctly", () => {
    expect(validateCip67Label("000de14").isValid).toBe(false); // too short
    expect(validateCip67Label("000de1400").isValid).toBe(false); // too long
    expect(validateCip67Label("100de140").isValid).toBe(false); // first char not 0
    expect(validateCip67Label("000de141").isValid).toBe(false); // last char not 0
    expect(validateCip67Label("000de1ff").isValid).toBe(false); // wrong checksum
  });

  test("format always correct", () => {
    for (let i = 0; i <= 1000; i += 100) {
      const label = generateCip67Label(i);
      expect(label).toMatch(/^0[0-9a-f]{6}0$/);
      expect(label.charAt(0)).toBe("0");
      expect(label.charAt(7)).toBe("0");
    }
  });
});
