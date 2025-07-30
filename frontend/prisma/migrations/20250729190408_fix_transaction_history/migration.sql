/*
  Warnings:

  - You are about to drop the `transaction_details_cache` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `transaction_history_cache` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "transaction_details_cache";

-- DropTable
DROP TABLE "transaction_history_cache";

-- CreateTable
CREATE TABLE "transactions" (
    "txHash" TEXT NOT NULL,
    "slot" INTEGER,
    "timestamp" TIMESTAMP(3),
    "mint" JSONB,
    "rawData" JSONB NOT NULL,
    "network" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("txHash")
);

-- CreateTable
CREATE TABLE "addresses" (
    "address" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "lastFetched" TIMESTAMP(3),

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "_AddressToTransaction" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AddressToTransaction_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "transactions_slot_idx" ON "transactions"("slot");

-- CreateIndex
CREATE INDEX "transactions_timestamp_idx" ON "transactions"("timestamp");

-- CreateIndex
CREATE INDEX "transactions_network_idx" ON "transactions"("network");

-- CreateIndex
CREATE INDEX "addresses_network_idx" ON "addresses"("network");

-- CreateIndex
CREATE INDEX "_AddressToTransaction_B_index" ON "_AddressToTransaction"("B");

-- AddForeignKey
ALTER TABLE "_AddressToTransaction" ADD CONSTRAINT "_AddressToTransaction_A_fkey" FOREIGN KEY ("A") REFERENCES "addresses"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AddressToTransaction" ADD CONSTRAINT "_AddressToTransaction_B_fkey" FOREIGN KEY ("B") REFERENCES "transactions"("txHash") ON DELETE CASCADE ON UPDATE CASCADE;
