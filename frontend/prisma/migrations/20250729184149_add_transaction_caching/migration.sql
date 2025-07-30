-- CreateTable
CREATE TABLE "transaction_details_cache" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "transactionData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_details_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_details_cache_txHash_key" ON "transaction_details_cache"("txHash");

-- CreateIndex
CREATE INDEX "transaction_details_cache_txHash_idx" ON "transaction_details_cache"("txHash");
