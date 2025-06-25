"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@meshsdk/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  Play,
  RefreshCw,
} from "lucide-react";
import { getExplorerUrl } from "@/lib/utils";

interface DeployedScript {
  name: string;
  scriptHash: string;
  address: string;
  deploymentTx: string;
  size: number;
  parameters: string[];
}

interface DeploymentStep {
  name: string;
  displayName: string;
  status: "pending" | "deploying" | "success" | "error";
  txHash?: string;
  error?: string;
  description: string;
}

interface ScriptDeploymentSectionProps {
  scriptsToDeployData: Array<{
    name: string;
    scriptHash: string;
    address: string;
    parameters: string[];
    size: number;
  }>;
  daoParams: {
    seedUtxo: { txHash: string; outputIndex: number };
    daoPolicyId: string;
    daoKey: string;
    governanceTokenHex: string;
  };
  onDeploymentComplete: (deployedScripts: DeployedScript[]) => void;
  onError: (error: string) => void;
}

export function ScriptDeploymentSection({
  scriptsToDeployData,
  daoParams,
  onDeploymentComplete,
  onError,
}: ScriptDeploymentSectionProps) {
  const { wallet, connected } = useWallet();

  const getScriptDisplayName = (name: string): string => {
    const displayNames: Record<string, string> = {
      vote: "Vote Manager",
      treasury: "Treasury",
      proposal: "Proposal Handler",
      actionSendFunds: "Treasury Actions",
    };
    return displayNames[name] ?? name;
  };

  const [deploymentSteps, setDeploymentSteps] = useState<DeploymentStep[]>(
    scriptsToDeployData.map((script) => ({
      name: script.name,
      displayName: getScriptDisplayName(script.name),
      status: "pending",
      description: `Deploy ${script.name} validator script`,
    }))
  );

  const [deployedScripts, setDeployedScripts] = useState<DeployedScript[]>([]);
  const [isDeployingAll, setIsDeployingAll] = useState(false);
  const [deployingScript, setDeployingScript] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const getScriptTitle = (name: string): string => {
    const titles: Record<string, string> = {
      vote: "vote.vote.spend",
      treasury: "treasury.treasury.spend",
      proposal: "proposal.proposal.spend",
      actionSendFunds: "action_send_funds.action_send_funds.spend",
    };
    return titles[name] ?? `${name}.${name}.spend`;
  };

  const updateStep = (stepName: string, update: Partial<DeploymentStep>) => {
    setDeploymentSteps((prev) =>
      prev.map((step) =>
        step.name === stepName ? { ...step, ...update } : step
      )
    );
  };

  const scanExistingDeployments = async () => {
    if (!scriptsToDeployData.length) return;

    setIsScanning(true);
    try {
      console.log("🔍 Scanning for existing script deployments...");

      const scriptsToScan = scriptsToDeployData.map((script) => ({
        name: script.name,
        scriptHash: script.scriptHash,
        parameters: script.parameters,
      }));

      const response = await fetch("/api/dao/deploy/scan-deployed-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptsToScan }),
      });

      if (response.ok) {
        const {
          deployedScripts: foundScripts,
          foundCount,
          totalScanned,
        } = await response.json();

        console.log(
          `📋 Scan complete: ${foundCount} scripts found in ${totalScanned} UTXOs`
        );

        // Update deployment steps based on scan results
        const updatedSteps = scriptsToDeployData.map((script) => {
          const existing = foundScripts[script.name];
          const currentStep = deploymentSteps.find(
            (s) => s.name === script.name
          );

          return {
            name: script.name,
            displayName: getScriptDisplayName(script.name),
            status: existing ? ("success" as const) : ("pending" as const),
            txHash: existing?.txHash,
            description: existing
              ? `${script.name} already deployed`
              : `Deploy ${script.name} validator script`,
          };
        });

        setDeploymentSteps(updatedSteps);

        // Update deployed scripts list
        const deployedList = Object.entries(foundScripts).map(
          ([name, data]: [string, any]) => ({
            name,
            scriptHash: data.scriptHash,
            address:
              scriptsToDeployData.find((s) => s.name === name)?.address ?? "",
            deploymentTx: `${data.txHash}#${data.outputIndex}`,
            size: data.size,
            parameters: data.parameters,
          })
        );

        setDeployedScripts(deployedList);

        // Check if all scripts are already deployed
        if (deployedList.length === scriptsToDeployData.length) {
          console.log("✅ All scripts already deployed!");
          onDeploymentComplete(deployedList);
        }
      }
    } catch (error) {
      console.error("❌ Failed to scan existing deployments:", error);
      // Don't show error for scan failures - just proceed with deployment
    } finally {
      setIsScanning(false);
    }
  };

  // Scan on component mount and when scripts change
  useEffect(() => {
    if (connected && wallet && scriptsToDeployData.length > 0) {
      scanExistingDeployments();
    }
  }, [connected, wallet, scriptsToDeployData]);

  const waitForConfirmation = async (
    txHash: string,
    expectedScriptHash: string,
    maxAttempts: number = 30
  ): Promise<void> => {
    console.log(`⏳ Waiting for confirmation of ${txHash}...`);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // First check if transaction exists
        const txResponse = await fetch(`/api/check-transaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash }),
        });

        if (txResponse.ok) {
          const { confirmed } = await txResponse.json();
          if (confirmed) {
            // Transaction confirmed, now verify script is deployed correctly
            const verifyResponse = await fetch(
              "/api/dao/deploy/scan-deployed-scripts",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  scriptsToScan: [
                    {
                      name: "verification",
                      scriptHash: expectedScriptHash,
                      parameters: [],
                    },
                  ],
                }),
              }
            );

            if (verifyResponse.ok) {
              const { deployedScripts } = await verifyResponse.json();
              if (deployedScripts.verification) {
                console.log(
                  `✅ Script ${expectedScriptHash} confirmed on-chain`
                );
                return; // Script confirmed and verified
              }
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.warn(`Confirmation check ${attempt + 1} failed:`, error);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    throw new Error(
      `Script deployment not confirmed after ${maxAttempts} attempts`
    );
  };

  const deployScript = async (scriptName: string): Promise<DeployedScript> => {
    if (!connected || !wallet) {
      throw new Error("Wallet not connected");
    }

    const scriptData = scriptsToDeployData.find((s) => s.name === scriptName);
    if (!scriptData) {
      throw new Error(`Script data not found for ${scriptName}`);
    }

    const usedAddresses = await wallet.getUsedAddresses();
    const walletAddress = usedAddresses[0];
    const collateral = await wallet.getCollateral();
    const changeAddress = await wallet.getChangeAddress();

    if (!collateral?.length) {
      throw new Error("No collateral available");
    }

    console.log(`📦 Deploying ${scriptName}...`);
    updateStep(scriptName, { status: "deploying", error: undefined });

    const scriptIndex = scriptsToDeployData.findIndex(
      (s) => s.name === scriptName
    );

    // Build deployment transaction
    const response = await fetch("/api/dao/deploy/deploy-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scriptName: scriptData.name,
        scriptTitle: getScriptTitle(scriptData.name),
        parameters: scriptData.parameters,
        walletAddress,
        collateral,
        changeAddress,
        scriptIndex,
        totalScripts: scriptsToDeployData.length,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.error ?? `Failed to build deployment for ${scriptName}`
      );
    }

    const { unsignedTx, script } = await response.json();

    console.log(
      `✓ Transaction built for ${scriptName}, requesting signature...`
    );

    // Sign and submit
    const signedTx = await wallet.signTx(unsignedTx, true);
    const txHash = await wallet.submitTx(signedTx);

    console.log(`✓ ${scriptName} deployed: ${txHash}`);

    // Wait for confirmation with script verification
    await waitForConfirmation(txHash, scriptData.scriptHash);

    updateStep(scriptName, { status: "success", txHash });

    const deployedScript: DeployedScript = {
      name: script.name,
      scriptHash: script.scriptHash,
      address: script.address,
      deploymentTx: script.deploymentTx,
      size: script.size,
      parameters: script.parameters,
    };

    // Update deployed scripts list
    setDeployedScripts((prev) => {
      const updated = [...prev, deployedScript];

      // Check if all scripts are deployed
      if (updated.length === scriptsToDeployData.length) {
        onDeploymentComplete(updated);
      }

      return updated;
    });

    return deployedScript;
  };

  const handleDeployScript = async (scriptName: string) => {
    setDeployingScript(scriptName);

    try {
      await deployScript(scriptName);
    } catch (err: any) {
      console.error(`❌ Failed to deploy ${scriptName}:`, err);
      updateStep(scriptName, {
        status: "error",
        error: err.message,
      });
      onError(`Failed to deploy ${scriptName}: ${err.message}`);
    } finally {
      setDeployingScript(null);
    }
  };

  const handleDeployAll = async () => {
    setIsDeployingAll(true);

    try {
      console.log(`🚀 Starting sequential script deployment`);

      let successCount = 0;
      let failureCount = 0;

      for (const scriptData of scriptsToDeployData) {
        // Skip already successful scripts
        const currentStep = deploymentSteps.find(
          (s) => s.name === scriptData.name
        );
        if (currentStep?.status === "success") {
          successCount++;
          continue;
        }

        try {
          await deployScript(scriptData.name);
          successCount++;

          // Add delay between deployments except for the last one
          if (
            scriptData.name !==
            scriptsToDeployData[scriptsToDeployData.length - 1].name
          ) {
            console.log("⏳ Waiting 3 seconds before next deployment...");
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        } catch (scriptError: any) {
          console.error(`❌ Failed to deploy ${scriptData.name}:`, scriptError);
          failureCount++;
          // Continue with remaining scripts
        }
      }

      if (successCount === 0) {
        throw new Error("All script deployments failed");
      }

      if (failureCount > 0) {
        onError(
          `${failureCount} script(s) failed to deploy. Use individual retry buttons to fix them.`
        );
      }

      console.log(
        `🎉 Script deployment complete! ${successCount}/${scriptsToDeployData.length} scripts deployed`
      );
    } catch (err: any) {
      console.error("❌ Script deployment process failed:", err);
      onError(err instanceof Error ? err.message : "Script deployment failed");
    } finally {
      setIsDeployingAll(false);
    }
  };

  const getStatusIcon = (status: DeploymentStep["status"]) => {
    switch (status) {
      case "pending":
        return <div className="w-4 h-4 rounded-full bg-gray-300" />;
      case "deploying":
        return <Loader2 className="w-4 h-4 animate-spin text-blue-600" />;
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case "error":
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
    }
  };

  const getStatusColor = (status: DeploymentStep["status"]) => {
    switch (status) {
      case "pending":
        return "bg-gray-100 text-gray-800";
      case "deploying":
        return "bg-blue-100 text-blue-800";
      case "success":
        return "bg-green-100 text-green-800";
      case "error":
        return "bg-red-100 text-red-800";
    }
  };

  const calculateProgress = () => {
    const completed = deploymentSteps.filter(
      (s) => s.status === "success"
    ).length;
    return (completed / deploymentSteps.length) * 100;
  };

  const successfulDeployments = deploymentSteps.filter(
    (s) => s.status === "success"
  ).length;
  const failedDeployments = deploymentSteps.filter(
    (s) => s.status === "error"
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Deploy Reference Scripts
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={scanExistingDeployments}
              disabled={
                isScanning || isDeployingAll || deployingScript !== null
              }
            >
              {isScanning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
            <div className="text-sm font-normal">
              {successfulDeployments}/{deploymentSteps.length} completed
            </div>
          </div>
        </CardTitle>
        <CardDescription>
          Deploy validator scripts as reference scripts to reduce transaction
          sizes. Scanning burn address for existing deployments...
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isScanning && (
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertDescription>
              Scanning burn address for existing script deployments...
            </AlertDescription>
          </Alert>
        )}

        <Progress value={calculateProgress()} className="w-full" />

        <div className="space-y-2">
          {deploymentSteps.map((step) => (
            <div
              key={step.name}
              className="flex items-center justify-between p-3 border rounded"
            >
              <div className="flex items-center gap-3">
                {getStatusIcon(step.status)}
                <div>
                  <span className="font-medium">{step.displayName}</span>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                  {step.error && (
                    <p className="text-sm text-red-600 mt-1">{step.error}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge className={getStatusColor(step.status)}>
                  {step.status === "deploying" && step.name === deployingScript
                    ? "confirming..."
                    : step.status}
                </Badge>

                {step.status === "success" && step.txHash && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      window.open(
                        getExplorerUrl(`/transaction/${step.txHash}`),
                        "_blank"
                      )
                    }
                  >
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                )}

                {(step.status === "error" || step.status === "pending") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeployScript(step.name)}
                    disabled={isDeployingAll || deployingScript !== null}
                  >
                    {step.status === "error" ? (
                      <>
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Retry
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 mr-1" />
                        Deploy
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <Button
          onClick={handleDeployAll}
          disabled={!connected || isDeployingAll || deployingScript !== null}
          className="w-full"
        >
          {isDeployingAll ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Deploying Scripts...
            </>
          ) : failedDeployments > 0 ? (
            `Resume Deployment (${failedDeployments} failed)`
          ) : successfulDeployments > 0 ? (
            `Deploy Remaining (${
              scriptsToDeployData.length - successfulDeployments
            } left)`
          ) : (
            "Deploy All Scripts"
          )}
        </Button>

        {!connected && (
          <p className="text-sm text-muted-foreground text-center">
            Connect your wallet to deploy scripts
          </p>
        )}
      </CardContent>
    </Card>
  );
}
