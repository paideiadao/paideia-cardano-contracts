import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function capitalizeNetwork(
  network: string
): "Preview" | "Preprod" | "Mainnet" {
  const normalized = network.toLowerCase();
  switch (normalized) {
    case "preview":
      return "Preview";
    case "preprod":
      return "Preprod";
    case "mainnet":
      return "Mainnet";
    default:
      return "Mainnet";
  }
}

export function getExplorerUrl(path: string, network?: string): string {
  const networkPrefix = network === "mainnet" ? "" : `${network ?? "preview"}.`;
  return `https://${networkPrefix}cardanoscan.io${path}`;
}

export function formatDuration(
  milliseconds: number,
  format: "short" | "long" = "short"
): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;

  if (format === "short") {
    // Short format: "2d 3h", "5h 30m", "45m"
    if (days > 0) return `${days}d ${remainingHours}h`;
    if (hours > 0) return `${hours}h ${remainingMinutes}m`;
    return `${minutes}m`;
  } else {
    // Long format: "2 days, 3 hours, and 30 minutes"
    const parts: string[] = [];

    if (days > 0) parts.push(`${days} day${days !== 1 ? "s" : ""}`);
    if (remainingHours > 0)
      parts.push(`${remainingHours} hour${remainingHours !== 1 ? "s" : ""}`);
    if (remainingMinutes > 0)
      parts.push(`${remainingMinutes} min${remainingMinutes !== 1 ? "s" : ""}`);

    if (parts.length === 0) return "0 minutes";
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts.join(" and ");

    return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
  }
}

export function formatAssetQuantity(quantity: string, decimals = 0): string {
  const num = parseInt(quantity);
  if (decimals === 0) return num.toLocaleString();
  return (num / Math.pow(10, decimals)).toLocaleString();
}

/**
 * Format lovelace amount to ADA with proper decimal places
 */
export function formatADA(
  lovelace: number | bigint,
  decimals: number = 6
): string {
  const amount = typeof lovelace === "bigint" ? Number(lovelace) : lovelace;
  const ada = amount / 1_000_000;

  // For very small amounts, show more decimals
  if (ada < 0.001 && ada > 0) {
    return `${ada.toFixed(8)} ADA`;
  }

  // For normal amounts, use specified decimals
  return `${ada.toFixed(decimals)} ADA`;
}

/**
 * Format lovelace amount to ADA with smart formatting
 */
export function formatADACompact(lovelace: number | bigint): string {
  const amount = typeof lovelace === "bigint" ? Number(lovelace) : lovelace;
  const ada = amount / 1_000_000;

  if (ada >= 1_000_000) {
    return `${(ada / 1_000_000).toFixed(2)}M ADA`;
  } else if (ada >= 1_000) {
    return `${(ada / 1_000).toFixed(2)}K ADA`;
  } else if (ada >= 1) {
    return `${ada.toFixed(2)} ADA`;
  } else if (ada > 0) {
    return `${ada.toFixed(6)} ADA`;
  } else {
    return "0 ADA";
  }
}

/**
 * Truncate hash or address for display
 */
export function truncateHash(
  hash: string,
  startChars: number = 8,
  endChars: number = 8
): string {
  if (!hash) return "";

  if (hash.length <= startChars + endChars) {
    return hash;
  }

  return `${hash.slice(0, startChars)}...${hash.slice(-endChars)}`;
}
