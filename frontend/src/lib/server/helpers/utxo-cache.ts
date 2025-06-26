import { prisma } from "@/lib/prisma";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";

const DEFAULT_TTL = 30 * 1000; // 30 seconds
const WALLET_TTL = 15 * 1000; // 15 seconds for wallet UTXOs (change faster)
const SCRIPT_TTL = 45 * 1000; // 45 seconds for script UTXOs (change slower)

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

export { WALLET_TTL, SCRIPT_TTL, DEFAULT_TTL };
