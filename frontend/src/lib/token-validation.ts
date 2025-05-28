export interface TokenValidationError {
  field: string;
  message: string;
}

export interface TokenValidationResult {
  isValid: boolean;
  errors: TokenValidationError[];
}

export function validateTokenInput(input: any): TokenValidationResult {
  const errors: TokenValidationError[] = [];

  // Name validation
  if (!input.name || typeof input.name !== "string") {
    errors.push({ field: "name", message: "Token name is required" });
  } else if (input.name.length < 1 || input.name.length > 50) {
    errors.push({
      field: "name",
      message: "Token name must be 1-50 characters",
    });
  }

  // Symbol validation
  if (!input.symbol || typeof input.symbol !== "string") {
    errors.push({ field: "symbol", message: "Token symbol is required" });
  } else if (!/^[A-Z0-9]{1,12}$/.test(input.symbol)) {
    errors.push({
      field: "symbol",
      message: "Symbol must be 1-12 uppercase alphanumeric characters",
    });
  }

  // Description validation
  if (!input.description || typeof input.description !== "string") {
    errors.push({ field: "description", message: "Description is required" });
  } else if (input.description.length > 500) {
    errors.push({
      field: "description",
      message: "Description must be under 500 characters",
    });
  }

  // Supply validation
  if (!input.supply || typeof input.supply !== "number") {
    errors.push({ field: "supply", message: "Supply is required" });
  } else if (input.supply < 1 || input.supply > 1_000_000_000) {
    errors.push({
      field: "supply",
      message: "Supply must be between 1 and 1 billion",
    });
  } else if (!Number.isInteger(input.supply)) {
    errors.push({ field: "supply", message: "Supply must be a whole number" });
  }

  // Decimals validation
  if (typeof input.decimals !== "number") {
    errors.push({ field: "decimals", message: "Decimals must be a number" });
  } else if (input.decimals < 0 || input.decimals > 18) {
    errors.push({
      field: "decimals",
      message: "Decimals must be between 0 and 18",
    });
  } else if (!Number.isInteger(input.decimals)) {
    errors.push({
      field: "decimals",
      message: "Decimals must be a whole number",
    });
  }

  // Minting period validation
  if (!input.mintingPeriodDays || typeof input.mintingPeriodDays !== "number") {
    errors.push({
      field: "mintingPeriodDays",
      message: "Minting period is required",
    });
  } else if (input.mintingPeriodDays < 1 || input.mintingPeriodDays > 365) {
    errors.push({
      field: "mintingPeriodDays",
      message: "Minting period must be between 1 and 365 days",
    });
  }

  // Image URL validation (optional)
  if (input.image && typeof input.image === "string") {
    try {
      new URL(input.image);
    } catch {
      errors.push({ field: "image", message: "Image must be a valid URL" });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
