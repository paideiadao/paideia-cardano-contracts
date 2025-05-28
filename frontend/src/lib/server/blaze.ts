import { Core, Blaze, Maestro } from "@blaze-cardano/sdk";

const blazeMaestroProvider = new Maestro({
  network: process.env.NETWORK as "preview" | "preprod" | "mainnet",
  apiKey: process.env.MAESTRO_API_KEY!,
});

export { blazeMaestroProvider, Core, Blaze };
