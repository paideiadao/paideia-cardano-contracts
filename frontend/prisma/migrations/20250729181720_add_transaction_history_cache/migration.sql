-- CreateTable
CREATE TABLE "transaction_history_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "transactions" JSONB NOT NULL,
    "lastTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_history_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_history_cache_cacheKey_key" ON "transaction_history_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "transaction_history_cache_cacheKey_idx" ON "transaction_history_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "transaction_history_cache_expiresAt_idx" ON "transaction_history_cache"("expiresAt");

-- CreateIndex
CREATE INDEX "transaction_history_cache_address_idx" ON "transaction_history_cache"("address");
