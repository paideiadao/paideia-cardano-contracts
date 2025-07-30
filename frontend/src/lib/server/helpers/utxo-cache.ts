import { prisma } from "@/lib/prisma";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";

const DEFAULT_TTL = 30 * 1000; // 30 seconds
const WALLET_TTL = 15 * 1000; // 15 seconds for wallet UTXOs (change faster)
const SCRIPT_TTL = 45 * 1000; // 45 seconds for script UTXOs (change slower)
const TRANSACTION_LIST_TTL = 5 * 60 * 1000; // 5 minutes for transaction history

function serializeUtxos(utxos: Core.TransactionUnspentOutput[]): any[] {
  return utxos.map((utxo) => ({
    cbor: utxo.toCbor(),
  }));
}

function deserializeUtxos(
  serializedUtxos: any[]
): Core.TransactionUnspentOutput[] {
  return serializedUtxos.map((data) =>
    Core.TransactionUnspentOutput.fromCbor(Core.HexBlob(data.cbor))
  );
}

export async function getCachedUtxos(
  address: Core.Address,
  ttlMs: number = DEFAULT_TTL
): Promise<Core.TransactionUnspentOutput[]> {
  const addressStr = address.toBech32();
  const cacheKey = `utxos:${addressStr}`;

  try {
    // Check cache first
    const cached = await prisma.utxoCache.findUnique({
      where: { cacheKey },
    });

    if (cached && new Date() < cached.expiresAt) {
      console.log(`🎯 Cache HIT for ${addressStr.slice(0, 20)}...`);
      return deserializeUtxos(cached.utxos as any[]);
    }

    console.log(
      `📡 Cache MISS for ${addressStr.slice(0, 20)}..., fetching from Maestro`
    );

    // Fetch fresh data from blockchain
    const utxos = await blazeMaestroProvider.getUnspentOutputs(address);

    // Serialize UTXOs using CBOR
    const utxoData = serializeUtxos(utxos);
    const expiresAt = new Date(Date.now() + ttlMs);

    // Cache the result
    await prisma.utxoCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        address: addressStr,
        utxos: utxoData,
        expiresAt,
      },
      update: {
        utxos: utxoData,
        expiresAt,
      },
    });

    console.log(
      `💾 Cached ${utxos.length} UTXOs for ${addressStr.slice(
        0,
        20
      )}... (expires in ${ttlMs / 1000}s)`
    );
    return utxos;
  } catch (error) {
    console.error(
      `❌ Error getting cached UTXOs for ${addressStr.slice(0, 20)}...:`,
      error
    );

    // Fallback to direct call if cache fails
    try {
      return await blazeMaestroProvider.getUnspentOutputs(address);
    } catch (fallbackError) {
      console.error(`❌ Fallback also failed:`, fallbackError);
      throw fallbackError;
    }
  }
}

// Cleanup expired cache entries
export async function cleanupExpiredCache() {
  try {
    const deleted = await prisma.utxoCache.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    console.log(`🧹 Cleaned up ${deleted.count} expired cache entries`);
    return deleted.count;
  } catch (error) {
    console.error(`❌ Error cleaning up cache:`, error);
    return 0;
  }
}

// Invalidate cache for specific address (when we know it changed)
export async function invalidateAddressCache(address: Core.Address) {
  const addressStr = address.toBech32();
  const cacheKey = `utxos:${addressStr}`;

  try {
    await prisma.utxoCache.delete({
      where: { cacheKey },
    });
    console.log(`🗑️ Invalidated cache for ${addressStr.slice(0, 20)}...`);
  } catch (error) {
    // Ignore if not found
    console.log(
      `🤷 Cache entry not found for ${addressStr.slice(
        0,
        20
      )}... (already invalid)`
    );
  }
}

// Get cache statistics
export async function getCacheStats() {
  const total = await prisma.utxoCache.count();
  const expired = await prisma.utxoCache.count({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });

  return {
    total,
    active: total - expired,
    expired,
  };
}
export async function getCachedTransactionHistory(
  address: Core.Address
): Promise<string[]> {
  const addressStr = address.toBech32();

  try {
    // Check if this address has been recently fetched
    const addressRecord = await prisma.address.findUnique({
      where: { address: addressStr },
      include: {
        transactions: {
          orderBy: { slot: "desc" },
          select: { txHash: true },
        },
      },
    });

    const shouldFetch =
      !addressRecord?.lastFetched ||
      Date.now() - addressRecord.lastFetched.getTime() > TRANSACTION_LIST_TTL;

    if (!shouldFetch && addressRecord?.transactions) {
      console.log(
        `🎯 Transaction history cache HIT for ${addressStr.slice(0, 20)}...`
      );
      return addressRecord.transactions.map((t) => t.txHash);
    }

    console.log(
      `📡 Transaction history cache MISS for ${addressStr.slice(
        0,
        20
      )}..., fetching from Maestro`
    );

    // Fetch from Maestro
    const maestroNetwork =
      process.env.NETWORK === "mainnet" ? "mainnet" : "preview";
    const maestroApiKey = process.env.MAESTRO_API_KEY;

    if (!maestroApiKey) {
      throw new Error("MAESTRO_API_KEY environment variable is required");
    }

    const response = await fetch(
      `https://${maestroNetwork}.gomaestro-api.org/v1/addresses/${addressStr}/transactions?count=100&order=desc`,
      {
        method: "GET",
        headers: { "api-key": maestroApiKey },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get transaction history: ${response.status}`);
    }

    const data = await response.json();
    const transactions = data.data ?? [];

    // Store addresses and create relationships
    await prisma.$transaction(async (tx) => {
      // Upsert the address
      await tx.address.upsert({
        where: { address: addressStr },
        create: {
          address: addressStr,
          network: process.env.NETWORK!,
          lastFetched: new Date(),
        },
        update: {
          lastFetched: new Date(),
        },
      });

      // Process each transaction
      for (const txSummary of transactions) {
        // Store basic transaction info (fetch full details later if needed)
        await tx.transaction.upsert({
          where: { txHash: txSummary.tx_hash },
          create: {
            txHash: txSummary.tx_hash,
            slot: txSummary.slot,
            network: process.env.NETWORK!,
            rawData: "",
            addresses: {
              connectOrCreate: [
                {
                  where: { address: addressStr },
                  create: {
                    address: addressStr,
                    network: process.env.NETWORK!,
                  },
                },
              ],
            },
          },
          update: {
            slot: txSummary.slot,
            addresses: {
              connectOrCreate: [
                {
                  where: { address: addressStr },
                  create: {
                    address: addressStr,
                    network: process.env.NETWORK!,
                  },
                },
              ],
            },
          },
        });
      }
    });

    console.log(
      `💾 Cached ${
        transactions.length
      } transaction links for ${addressStr.slice(0, 20)}...`
    );
    return transactions.map((t: any) => t.tx_hash);
  } catch (error) {
    console.error(
      `❌ Error getting cached transaction history for ${addressStr.slice(
        0,
        20
      )}...:`,
      error
    );
    return [];
  }
}

export async function getCachedTransactionDetails(
  txHash: string
): Promise<any> {
  try {
    // Check if we have full details
    const cached = await prisma.transaction.findUnique({
      where: { txHash },
    });

    if (cached?.rawData) {
      console.log(
        `🎯 Transaction details cache HIT for ${txHash.slice(0, 12)}...`
      );
      return cached.rawData;
    }

    console.log(
      `📡 Fetching full transaction details for ${txHash.slice(0, 12)}...`
    );

    const maestroNetwork =
      process.env.NETWORK === "mainnet" ? "mainnet" : "preview";
    const maestroApiKey = process.env.MAESTRO_API_KEY;

    if (!maestroApiKey) {
      throw new Error("MAESTRO_API_KEY environment variable is required");
    }

    const response = await fetch(
      `https://${maestroNetwork}.gomaestro-api.org/v1/transactions/${txHash}`,
      {
        method: "GET",
        headers: { "api-key": maestroApiKey },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get transaction details: ${response.status}`);
    }

    const txData = await response.json();
    const transaction = txData.data;

    // Extract addresses from the full transaction data
    const addressesInTx = new Set<string>();

    // Add addresses from inputs
    transaction.inputs?.forEach((input: any) => {
      if (input.address) addressesInTx.add(input.address);
    });

    // Add addresses from outputs
    transaction.outputs?.forEach((output: any) => {
      if (output.address) addressesInTx.add(output.address);
    });

    // Update transaction with full data and all address relationships
    await prisma.transaction.update({
      where: { txHash },
      data: {
        timestamp: transaction.block_timestamp
          ? new Date(transaction.block_timestamp * 1000)
          : null,
        mint: transaction.mint ?? null,
        rawData: transaction,
        addresses: {
          connectOrCreate: Array.from(addressesInTx).map((addr) => ({
            where: { address: addr },
            create: {
              address: addr,
              network: process.env.NETWORK!,
            },
          })),
        },
      },
    });

    console.log(
      `💾 Cached full transaction details for ${txHash.slice(0, 12)}... with ${
        addressesInTx.size
      } addresses`
    );

    return transaction;
  } catch (error) {
    console.error(
      `❌ Error getting transaction details for ${txHash.slice(0, 12)}...:`,
      error
    );
    throw error;
  }
}

export { WALLET_TTL, SCRIPT_TTL, DEFAULT_TTL };
