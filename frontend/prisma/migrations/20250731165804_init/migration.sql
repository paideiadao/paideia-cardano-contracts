-- CreateTable
CREATE TABLE "daos" (
    "policyId" TEXT NOT NULL,
    "daoKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "governanceToken" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "minProposalTime" INTEGER NOT NULL,
    "maxProposalTime" INTEGER NOT NULL,
    "quorum" INTEGER NOT NULL,
    "minGovProposalCreate" INTEGER NOT NULL,
    "whitelistedProposals" JSONB NOT NULL,
    "whitelistedActions" JSONB NOT NULL,
    "deploymentTx" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "utxoTxHash" TEXT NOT NULL,
    "utxoIndex" INTEGER NOT NULL,
    "utxoAddress" TEXT NOT NULL,
    "utxoValue" TEXT NOT NULL,
    "utxoDatum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daos_pkey" PRIMARY KEY ("policyId","daoKey")
);

-- CreateTable
CREATE TABLE "deployed_scripts" (
    "scriptHash" TEXT NOT NULL,
    "name" TEXT,
    "txHash" TEXT NOT NULL,
    "outputIndex" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "size" INTEGER,
    "parameters" JSONB,
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "daoPolicyId" TEXT,
    "daoDaoKey" TEXT,

    CONSTRAINT "deployed_scripts_pkey" PRIMARY KEY ("scriptHash")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "winningOption" INTEGER,
    "tally" JSONB NOT NULL,
    "deploymentTx" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "daoPolicyId" TEXT,
    "daoDaoKey" TEXT,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "daos_network_idx" ON "daos"("network");

-- CreateIndex
CREATE INDEX "daos_name_idx" ON "daos"("name");

-- CreateIndex
CREATE INDEX "deployed_scripts_name_idx" ON "deployed_scripts"("name");

-- CreateIndex
CREATE INDEX "deployed_scripts_network_idx" ON "deployed_scripts"("network");

-- CreateIndex
CREATE INDEX "deployed_scripts_txHash_outputIndex_idx" ON "deployed_scripts"("txHash", "outputIndex");

-- CreateIndex
CREATE INDEX "deployed_scripts_daoPolicyId_daoDaoKey_idx" ON "deployed_scripts"("daoPolicyId", "daoDaoKey");

-- CreateIndex
CREATE INDEX "proposals_daoPolicyId_daoDaoKey_idx" ON "proposals"("daoPolicyId", "daoDaoKey");

-- CreateIndex
CREATE INDEX "proposals_status_idx" ON "proposals"("status");

-- CreateIndex
CREATE INDEX "proposals_endTime_idx" ON "proposals"("endTime");

-- CreateIndex
CREATE UNIQUE INDEX "utxo_cache_cacheKey_key" ON "utxo_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "utxo_cache_cacheKey_idx" ON "utxo_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "utxo_cache_expiresAt_idx" ON "utxo_cache"("expiresAt");

-- CreateIndex
CREATE INDEX "utxo_cache_address_idx" ON "utxo_cache"("address");

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
ALTER TABLE "deployed_scripts" ADD CONSTRAINT "deployed_scripts_daoPolicyId_daoDaoKey_fkey" FOREIGN KEY ("daoPolicyId", "daoDaoKey") REFERENCES "daos"("policyId", "daoKey") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_daoPolicyId_daoDaoKey_fkey" FOREIGN KEY ("daoPolicyId", "daoDaoKey") REFERENCES "daos"("policyId", "daoKey") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AddressToTransaction" ADD CONSTRAINT "_AddressToTransaction_A_fkey" FOREIGN KEY ("A") REFERENCES "addresses"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AddressToTransaction" ADD CONSTRAINT "_AddressToTransaction_B_fkey" FOREIGN KEY ("B") REFERENCES "transactions"("txHash") ON DELETE CASCADE ON UPDATE CASCADE;
