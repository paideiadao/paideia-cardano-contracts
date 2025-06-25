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
