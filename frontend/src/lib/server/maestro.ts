import { MaestroProvider } from "@meshsdk/core";
import { capitalizeNetwork } from "../utils";

export const maestroProvider = new MaestroProvider({
  network: capitalizeNetwork(process.env.NETWORK ?? "mainnet"),
  apiKey: process.env.MAESTRO_API_KEY!,
});
