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

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

export function formatAssetQuantity(quantity: string, decimals = 0): string {
  const num = parseInt(quantity);
  if (decimals === 0) return num.toLocaleString();
  return (num / Math.pow(10, decimals)).toLocaleString();
}
