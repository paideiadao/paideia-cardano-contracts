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
