"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@meshsdk/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Copy,
  ExternalLink,
  RotateCcw,
  Play,
} from "lucide-react";
import { getExplorerUrl } from "@/lib/utils";

interface DeploymentResult {
  network: string;
  deployedAt: string;
  deployer: string;
  totalCost: string;
  referenceScripts: Record<
    string,
    {
      txHash: string;
      outputIndex: number;
      scriptHash: string;
      size: number;
    }
  >;
}

interface DeploymentStep {
  name: string;
  status: "pending" | "deploying" | "success" | "error";
  txHash?: string;
  error?: string;
}

type Network = "preview" | "preprod" | "mainnet";

const SCRIPT_NAMES = [
  "actionSendFunds",
  "authTokenPolicy",
  "dao",
  "proposal",
  "tokenMintingPolicy",
  "treasury",
  "vote",
];

export default function DeployScriptsPage() {
  const { wallet, connected } = useWallet();

  const [network, setNetwork] = useState<Network>("preview");
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentSteps, setDeploymentSteps] = useState<DeploymentStep[]>([]);
  const [result, setResult] = useState<DeploymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deployingScript, setDeployingScript] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const initializeSteps = () => {
    setDeploymentSteps(
      SCRIPT_NAMES.map((name) => ({
        name,
        status: "pending",
      }))
    );
  };

  const updateStep = (name: string, update: Partial<DeploymentStep>) => {
    setDeploymentSteps((prev) =>
      prev.map((step) => (step.name === name ? { ...step, ...update } : step))
    );
  };

  const deployScript = async (scriptName: string): Promise<void> => {
    const scriptIndex = SCRIPT_NAMES.indexOf(scriptName);
    if (scriptIndex === -1) {
      throw new Error(`Invalid script name: ${scriptName}`);
    }

    if (!connected || !wallet) {
      throw new Error("Wallet not connected");
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

    // Build deployment transaction
    const response = await fetch("/api/deploy-scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        network,
        walletAddress,
        collateral,
        changeAddress,
        scriptIndex,
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

    // Sign the transaction
    const signedTx = await wallet.signTx(unsignedTx, true);

    console.log(`✓ Transaction signed for ${scriptName}, submitting...`);

    // Submit the transaction
    const txHash = await wallet.submitTx(signedTx);

    console.log(`✓ ${scriptName} deployed successfully: ${txHash}`);

    // Wait for confirmation before marking as success
    await waitForConfirmation(txHash);

    // Update step and result
    updateStep(scriptName, {
      status: "success",
      txHash,
    });

    // Update deployment result
    setResult((prev) => {
      const newResult = prev ?? {
        network,
        deployedAt: new Date().toISOString(),
        deployer: walletAddress,
        totalCost: "See individual transactions",
        referenceScripts: {},
      };

      return {
        ...newResult,
        referenceScripts: {
          ...newResult.referenceScripts,
          [script.name]: {
            txHash,
            outputIndex: 0,
            scriptHash: script.scriptHash,
            size: script.size,
          },
        },
      };
    });
  };

  const waitForConfirmation = async (
    txHash: string,
    maxAttempts: number = 30
  ): Promise<void> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check if transaction exists on-chain
        const response = await fetch(`/api/check-transaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash }),
        });

        if (response.ok) {
          const { confirmed } = await response.json();
          if (confirmed) {
            return; // Transaction confirmed
          }
        }

        // Wait 2 seconds before next check
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.warn(`Confirmation check ${attempt + 1} failed:`, error);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    throw new Error(
      `Transaction ${txHash} not confirmed after ${maxAttempts} attempts`
    );
  };

  const handleDeployAll = async () => {
    if (!connected || !wallet) {
      setError("Please connect your wallet");
      return;
    }

    setIsDeploying(true);
    setError(null);

    // Initialize or reset steps if needed
    if (deploymentSteps.length === 0) {
      initializeSteps();
    }

    try {
      console.log(`🚀 Starting sequential deployment to ${network}`);

      let successCount = 0;
      let failureCount = 0;

      for (const scriptName of SCRIPT_NAMES) {
        // Skip already successful scripts
        const currentStep = deploymentSteps.find((s) => s.name === scriptName);
        if (currentStep?.status === "success") {
          successCount++;
          continue;
        }

        try {
          await deployScript(scriptName);
          successCount++;

          // Add delay between deployments except for the last one
          if (scriptName !== SCRIPT_NAMES[SCRIPT_NAMES.length - 1]) {
            console.log("⏳ Waiting 3 seconds before next deployment...");
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        } catch (scriptError: any) {
          console.error(`❌ Failed to deploy ${scriptName}:`, scriptError);

          updateStep(scriptName, {
            status: "error",
            error: scriptError.message,
          });

          failureCount++;
          // Continue with remaining scripts
        }
      }

      if (successCount === 0) {
        throw new Error("All script deployments failed");
      }

      if (failureCount > 0) {
        setError(
          `${failureCount} script(s) failed to deploy. Use individual retry buttons to fix them.`
        );
      }

      console.log(
        `🎉 Deployment complete! ${successCount}/${SCRIPT_NAMES.length} scripts deployed`
      );
    } catch (err: any) {
      console.error("❌ Deployment process failed:", err);
      setError(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setIsDeploying(false);
    }
  };

  const handleDeployScript = async (scriptName: string) => {
    setDeployingScript(scriptName);
    setError(null);

    try {
      await deployScript(scriptName);
    } catch (err: any) {
      console.error(`❌ Failed to deploy ${scriptName}:`, err);
      updateStep(scriptName, {
        status: "error",
        error: err.message,
      });
      setError(`Failed to deploy ${scriptName}: ${err.message}`);
    } finally {
      setDeployingScript(null);
    }
  };

  const downloadConfig = () => {
    if (!result) return;

    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reference-scripts-${result.network}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyConfig = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
  };

  const scanExistingDeployments = async () => {
    if (!connected || !wallet) return;

    setIsScanning(true);
    try {
      const response = await fetch("/api/scan-deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network }),
      });

      if (response.ok) {
        const { deployedScripts } = await response.json();

        // Update steps based on what's already deployed
        const updatedSteps = SCRIPT_NAMES.map((name) => {
          const existing = deployedScripts[name];
          return {
            name,
            status: existing ? ("success" as const) : ("pending" as const),
            txHash: existing?.txHash,
          };
        });

        setDeploymentSteps(updatedSteps);

        // Update result if any scripts are already deployed
        if (Object.keys(deployedScripts).length > 0) {
          setResult({
            network,
            deployedAt: new Date().toISOString(),
            deployer: "Previously deployed",
            totalCost: "0",
            referenceScripts: deployedScripts,
          });
        }
      }
    } catch (error) {
      console.error("Failed to scan existing deployments:", error);
    } finally {
      setIsScanning(false);
    }
  };

  // Call on mount and when network changes
  useEffect(() => {
    if (connected && wallet) {
      scanExistingDeployments();
    }
  }, [connected, wallet, network]);

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
    return (completed / SCRIPT_NAMES.length) * 100;
  };

  const successfulDeployments = deploymentSteps.filter(
    (s) => s.status === "success"
  ).length;
  const failedDeployments = deploymentSteps.filter(
    (s) => s.status === "error"
  ).length;
  const hasStarted = deploymentSteps.length > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Deploy Reference Scripts</CardTitle>
          <CardDescription>
            Deploy validator scripts as reference scripts to reduce transaction
            sizes. Deploy all at once or individually as needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Target Network</label>
            <Select
              value={network}
              onValueChange={(value: Network) => setNetwork(value)}
              disabled={isDeploying || deployingScript !== null}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preview">Preview Testnet</SelectItem>
                <SelectItem value="preprod">Pre-Production</SelectItem>
                <SelectItem value="mainnet">Mainnet</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {network === "mainnet" && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Warning:</strong> You are deploying to Mainnet. This
                will cost real ADA and cannot be undone.
              </AlertDescription>
            </Alert>
          )}

          {!hasStarted && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Scripts to Deploy</h3>
                <span className="text-sm text-muted-foreground">
                  {SCRIPT_NAMES.length} scripts
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {SCRIPT_NAMES.map((name) => (
                  <div key={name} className="p-2 border rounded text-sm">
                    <span className="capitalize">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={
                hasStarted
                  ? handleDeployAll
                  : () => {
                      initializeSteps();
                      handleDeployAll();
                    }
              }
              disabled={!connected || isDeploying || deployingScript !== null}
              className="flex-1"
            >
              {isDeploying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deploying Scripts...
                </>
              ) : hasStarted ? (
                `Resume Deployment (${failedDeployments} failed)`
              ) : (
                `Deploy All to ${network}`
              )}
            </Button>

            {!hasStarted && (
              <Button
                variant="outline"
                onClick={initializeSteps}
                disabled={!connected || isDeploying || deployingScript !== null}
              >
                <Play className="w-4 h-4 mr-2" />
                Manual Mode
              </Button>
            )}
          </div>

          {!connected && (
            <p className="text-sm text-muted-foreground text-center">
              Connect your wallet to deploy reference scripts
            </p>
          )}
        </CardContent>
      </Card>

      {hasStarted && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Deployment Progress
              <div className="text-sm font-normal">
                {successfulDeployments}/{SCRIPT_NAMES.length} completed
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                      <span className="capitalize font-medium">
                        {step.name}
                      </span>
                      {step.error && (
                        <p className="text-sm text-red-600 mt-1">
                          {step.error}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge className={getStatusColor(step.status)}>
                      {step.status === "deploying" &&
                      step.name === deployingScript
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
                        disabled={isDeploying || deployingScript !== null}
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
          </CardContent>
        </Card>
      )}

      {result && successfulDeployments > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-6 w-6 text-green-600" />
              Deployment Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Network:</span>
                <Badge className="ml-2">{result.network}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Success Rate:</span>
                <span className="ml-2">
                  {successfulDeployments}/{SCRIPT_NAMES.length}(
                  {Math.round(
                    (successfulDeployments / SCRIPT_NAMES.length) * 100
                  )}
                  %)
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Deployed At:</span>
                <span className="ml-2">
                  {new Date(result.deployedAt).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Deployer:</span>
                <span className="ml-2 font-mono text-xs">
                  {result.deployer.slice(0, 12)}...
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={downloadConfig}>
                <Download className="w-4 h-4 mr-2" />
                Download Config
              </Button>
              <Button variant="outline" onClick={copyConfig}>
                <Copy className="w-4 h-4 mr-2" />
                Copy JSON
              </Button>
            </div>

            <div className="space-y-3">
              <h4 className="font-medium">Deployed Scripts</h4>
              {Object.entries(result.referenceScripts).map(([name, script]) => (
                <div
                  key={name}
                  className="flex items-center justify-between p-3 border rounded"
                >
                  <div>
                    <div className="font-medium capitalize">{name}</div>
                    <div className="text-sm text-muted-foreground">
                      Size: {(script.size / 1024).toFixed(1)}KB
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      {script.txHash.slice(0, 8)}...#{script.outputIndex}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        window.open(
                          getExplorerUrl(`/transaction/${script.txHash}`),
                          "_blank"
                        )
                      }
                    >
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {successfulDeployments === SCRIPT_NAMES.length && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">
                🎉 All scripts deployed successfully!
              </p>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Download the JSON configuration file</li>
                <li>Update your app to use reference scripts</li>
                <li>Deploy your updated application</li>
                <li>Test thoroughly before production use</li>
              </ol>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
