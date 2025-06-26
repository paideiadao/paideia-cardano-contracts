-- CreateTable
CREATE TABLE "utxo_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "utxos" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "utxo_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "utxo_cache_cacheKey_key" ON "utxo_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "utxo_cache_cacheKey_idx" ON "utxo_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "utxo_cache_expiresAt_idx" ON "utxo_cache"("expiresAt");

-- CreateIndex
CREATE INDEX "utxo_cache_address_idx" ON "utxo_cache"("address");
