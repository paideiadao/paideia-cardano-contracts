import { Blaze, Core, Maestro } from "@blaze-cardano/sdk";

const maestroProvider = new Maestro({
  network: process.env.NETWORK as "preview" | "preprod" | "mainnet",
  apiKey: process.env.MAESTRO_API_KEY!,
});

export { maestroProvider, Core, Blaze };
