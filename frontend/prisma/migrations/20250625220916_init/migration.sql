-- CreateTable
CREATE TABLE "daos" (
    "policyId" TEXT NOT NULL,
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

    CONSTRAINT "daos_pkey" PRIMARY KEY ("policyId")
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

    CONSTRAINT "deployed_scripts_pkey" PRIMARY KEY ("scriptHash")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "daoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "winningOption" INTEGER,
    "tally" JSONB NOT NULL,
    "deploymentTx" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "deployed_scripts_daoPolicyId_idx" ON "deployed_scripts"("daoPolicyId");

-- CreateIndex
CREATE INDEX "proposals_daoId_idx" ON "proposals"("daoId");

-- CreateIndex
CREATE INDEX "proposals_status_idx" ON "proposals"("status");

-- CreateIndex
CREATE INDEX "proposals_endTime_idx" ON "proposals"("endTime");

-- AddForeignKey
ALTER TABLE "deployed_scripts" ADD CONSTRAINT "deployed_scripts_daoPolicyId_fkey" FOREIGN KEY ("daoPolicyId") REFERENCES "daos"("policyId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_daoId_fkey" FOREIGN KEY ("daoId") REFERENCES "daos"("policyId") ON DELETE RESTRICT ON UPDATE CASCADE;
