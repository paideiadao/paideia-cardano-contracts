"use client";

import { useState } from "react";
import { useWallet } from "@meshsdk/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { useDAOCreationStore } from "@/lib/stores/dao-creation-store";

export default function DeployDaoStep() {
  const { wallet, connected } = useWallet();
  const {
    governanceToken,
    daoConfig,
    setDeployResults,
    setCurrentStep,
    daoTxHash,
    daoPolicyId,
  } = useDAOCreationStore();

  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDeploy = async () => {
    if (!connected || !wallet || !governanceToken || !daoConfig) {
      setError("Missing required data for deployment");
      return;
    }

    setIsDeploying(true);
    setError(null);

    try {
      console.log("=== Starting DAO Deployment ===");

      const usedAddresses = await wallet.getUsedAddresses();
      const address = usedAddresses[0];
      const collateral = await wallet.getCollateral();
      const changeAddress = await wallet.getChangeAddress();

      if (!collateral?.length) {
        throw new Error("No collateral available");
      }

      console.log("✓ Wallet data obtained");

      const response = await fetch("/api/dao/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          governanceToken,
          daoConfig,
          walletAddress: address,
          collateral,
          changeAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ?? "Failed to build deployment transaction"
        );
      }

      const {
        unsignedTx,
        daoPolicyId: deployedPolicyId,
        daoKey,
      } = await response.json();

      console.log("Transaction built on server, signing...");
      const signedTx = await wallet.signTx(unsignedTx, true);

      console.log("Submitting transaction...");
      const deployTxHash = await wallet.submitTx(signedTx);

      console.log("✓ DAO deployed:", deployTxHash);
      console.log("✓ DAO Policy ID:", deployedPolicyId);
      console.log("✓ DAO Key:", daoKey);

      setDeployResults(deployTxHash, deployedPolicyId, daoKey);
    } catch (err: any) {
      console.error("❌ Deployment error:", err);
      setError(err instanceof Error ? err.message : "Failed to deploy DAO");
    } finally {
      setIsDeploying(false);
    }
  };

  const handleContinue = () => {
    setCurrentStep(3);
  };

  if (daoTxHash) {
    return (
      <div className="space-y-6">
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">🎉 DAO Successfully Deployed!</p>
              <p className="text-sm">
                Your DAO is now live on the Cardano blockchain and ready for
                governance.
              </p>
              <div className="flex items-center gap-2 mt-3">
                <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
                  {daoTxHash}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(
                      `https://cardanoscan.io/transaction/${daoTxHash}`,
                      "_blank"
                    )
                  }
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  View
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>DAO Summary</CardTitle>
            <CardDescription>Your deployed DAO configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium text-sm mb-2">Basic Information</h4>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Name:</span>{" "}
                    {daoConfig?.name}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Description:</span>{" "}
                    {daoConfig?.description}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Policy ID:</span>{" "}
                    {daoPolicyId}
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2">Governance Token</h4>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Token:</span>{" "}
                    {governanceToken?.name} ({governanceToken?.symbol})
                  </p>
                  <p>
                    <span className="text-muted-foreground">Decimals:</span>{" "}
                    {governanceToken?.decimals}
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2">Voting Parameters</h4>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Threshold:</span>{" "}
                    {daoConfig?.threshold}%
                  </p>
                  <p>
                    <span className="text-muted-foreground">Quorum:</span>{" "}
                    {daoConfig?.quorum} {governanceToken?.symbol}
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2">Proposal Timing</h4>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Min Duration:</span>{" "}
                    {daoConfig?.minProposalTime} minutes
                  </p>
                  <p>
                    <span className="text-muted-foreground">Max Duration:</span>{" "}
                    {daoConfig?.maxProposalTime} minutes
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleContinue}>Continue to Treasury Setup</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Deploy Your DAO</CardTitle>
          <CardDescription>
            Create your DAO on-chain with the configuration you've set up
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Deployment Summary</h3>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="border-l-4 border-blue-500 pl-4">
                  <h4 className="font-semibold text-blue-700">DAO Contract</h4>
                  <p className="text-sm text-muted-foreground">
                    Creates the core DAO with your governance rules
                  </p>
                </div>

                <div className="border-l-4 border-green-500 pl-4">
                  <h4 className="font-semibold text-green-700">
                    Unique Identifier
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Mints a unique NFT that identifies your DAO
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="border-l-4 border-purple-500 pl-4">
                  <h4 className="font-semibold text-purple-700">
                    Governance Token
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {governanceToken?.name} ({governanceToken?.symbol})
                  </p>
                </div>

                <div className="border-l-4 border-orange-500 pl-4">
                  <h4 className="font-semibold text-orange-700">
                    Voting Rules
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {daoConfig?.threshold}% threshold, {daoConfig?.quorum}{" "}
                    quorum
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-medium">Important Notes:</p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>
                    • DAO parameters are <strong>immutable</strong> once
                    deployed
                  </li>
                  <li>• You'll need ADA for transaction fees (~2-5 ADA)</li>
                  <li>• The DAO will be immediately active for governance</li>
                  <li>• Treasury setup is optional and can be done later</li>
                </ul>
              </div>
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              onClick={() => setCurrentStep(1)}
              disabled={isDeploying}
            >
              Back to Configuration
            </Button>
            <Button
              onClick={handleDeploy}
              disabled={!connected || isDeploying}
              className="min-w-[150px]"
            >
              {isDeploying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deploying DAO...
                </>
              ) : (
                "Deploy DAO"
              )}
            </Button>
          </div>

          {!connected && (
            <p className="text-sm text-muted-foreground text-center">
              Please connect your wallet to deploy your DAO
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
