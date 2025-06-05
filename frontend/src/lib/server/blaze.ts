import { Core, Blaze, Maestro, Blockfrost } from "@blaze-cardano/sdk";

const networkMap = {
  preview: "cardano-preview",
  preprod: "cardano-preprod",
  mainnet: "cardano-mainnet",
} as const;

const blazeMaestroProvider = new Maestro({
  network: process.env.NETWORK as "preview" | "preprod" | "mainnet",
  apiKey: process.env.MAESTRO_API_KEY!,
});

const blazeBlockfrostProvider = new Blockfrost({
  network: networkMap[process.env.NETWORK as keyof typeof networkMap],
  projectId: process.env.BLOCKFROST_PROJECT_ID!,
});

export { blazeMaestroProvider, blazeBlockfrostProvider, Core, Blaze };
