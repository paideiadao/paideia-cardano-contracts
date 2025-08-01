"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@meshsdk/react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  Download,
  Copy,
  Play,
} from "lucide-react";
import { useDAOCreationStore } from "@/lib/stores/dao-creation-store";
import { getExplorerUrl } from "@/lib/utils";
import { ScriptDeploymentSection } from "./deploy-scripts";
import { CopyButton } from "@/components/ui/copy-button";

interface DeployDaoStepProps {
  onComplete: () => void;
  onBack: () => void;
}

interface DAOCreationPlan {
  daoParams: {
    seedUtxo: { txHash: string; outputIndex: number };
    daoPolicyId: string;
    daoKey: string;
    governanceTokenHex: string;
  };
  scriptsToDeployData: Array<{
    name: string;
    scriptHash: string;
    address: string;
    parameters: string[];
    size: number;
  }>;
  totalSteps: number;
  estimatedCost: string;
}

interface DeployedScript {
  name: string;
  scriptHash: string;
  address: string;
  deploymentTx: string;
  size: number;
  parameters: string[];
}

type DeploymentPhase =
  | "ready"
  | "initialize"
  | "deploy-scripts"
  | "finalize"
  | "complete";

export default function DeployDaoStep({
  onComplete,
  onBack,
}: DeployDaoStepProps) {
  const { wallet, connected } = useWallet();
  const {
    governanceToken,
    daoConfig,
    deployedDAO,
    setDeployedDAO,
    setDeployResults,
  } = useDAOCreationStore();

  const [currentPhase, setCurrentPhase] = useState<DeploymentPhase>("ready");
  const [creationPlan, setCreationPlan] = useState<DAOCreationPlan | null>(
    null
  );
  const [deployedScripts, setDeployedScripts] = useState<DeployedScript[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deploymentProgress, setDeploymentProgress] = useState(0);

  // Check if DAO is already deployed
  useEffect(() => {
    if (deployedDAO) {
      setCurrentPhase("complete");
      setDeploymentProgress(100);
    }
  }, [deployedDAO]);

  const initializeDAO = async () => {
    if (!connected || !wallet || !governanceToken || !daoConfig) {
      setError("Missing required data - please complete previous steps");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setCurrentPhase("initialize");
    setDeploymentProgress(10);

    try {
      const usedAddresses = await wallet.getUsedAddresses();
      const walletAddress = usedAddresses[0];

      console.log("🔄 Initializing DAO creation...");

      const response = await fetch("/api/dao/deploy/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          daoConfig: {
            ...daoConfig,
            governanceToken: {
              policyId: governanceToken.policyId,
              assetName: governanceToken.assetName,
            },
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error ?? "Failed to initialize DAO creation");
      }

      const { plan } = await response.json();
      setCreationPlan(plan);
      setCurrentPhase("deploy-scripts");
      setDeploymentProgress(25);

      console.log("✅ DAO initialization complete, ready to deploy scripts");
    } catch (err: any) {
      console.error("❌ DAO initialization failed:", err);
      setError(err instanceof Error ? err.message : "Failed to initialize DAO");
      setCurrentPhase("ready");
      setDeploymentProgress(0);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScriptDeploymentComplete = (scripts: DeployedScript[]) => {
    console.log(
      "📝 Script deployment complete callback called with:",
      scripts.length,
      "scripts"
    );
    setDeployedScripts(scripts);
    setCurrentPhase("finalize");
    setDeploymentProgress(75);
    // Auto-proceed to finalization
    finalizeDAO(scripts);
  };

  const finalizeDAO = async (scripts: DeployedScript[]) => {
    console.log("🔍 FINALIZATION STATE CHECK:");
    console.log("connected:", connected);
    console.log("wallet:", !!wallet);
    console.log("creationPlan:", !!creationPlan, creationPlan);
    console.log("deployedScripts.length:", scripts.length, scripts);

    if (!connected || !wallet || !creationPlan || !scripts.length) {
      setError("Invalid state for DAO finalization");
      return;
    }

    setIsProcessing(true);
    setDeploymentProgress(80);

    try {
      const usedAddresses = await wallet.getUsedAddresses();
      const walletAddress = usedAddresses[0];
      const collateral = await wallet.getCollateral();
      const changeAddress = await wallet.getChangeAddress();

      console.log("🏗️ Finalizing DAO creation...");

      const response = await fetch("/api/dao/deploy/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoConfig: {
            ...daoConfig,
            governanceToken: {
              policyId: governanceToken!.policyId,
              assetName: governanceToken!.assetName,
            },
          },
          daoParams: creationPlan.daoParams,
          deployedScripts: scripts,
          walletAddress,
          collateral,
          changeAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error ?? "Failed to finalize DAO creation");
      }

      const { unsignedTx, dao } = await response.json();

      console.log("✓ DAO transaction built, requesting signature...");
      setDeploymentProgress(90);

      const signedTx = await wallet.signTx(unsignedTx, true);
      const txHash = await wallet.submitTx(signedTx);

      console.log(`✓ DAO created: ${txHash}`);

      const finalDAO = {
        ...dao,
        creationTx: txHash,
      };

      // Update both the new and legacy store fields
      setDeployedDAO(finalDAO);
      setDeployResults(txHash, dao.policyId, dao.assetName);

      setCurrentPhase("complete");
      setDeploymentProgress(100);

      console.log("🎉 DAO creation complete!");
    } catch (err: any) {
      console.error("❌ DAO finalization failed:", err);
      setError(
        err instanceof Error ? err.message : "Failed to finalize DAO creation"
      );
      setDeploymentProgress(75);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadDAOConfig = () => {
    if (!deployedDAO) return;

    const config = {
      dao: deployedDAO,
      scripts: deployedScripts,
      governanceToken,
      daoConfig,
      network: process.env.NETWORK,
      createdAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `dao-${daoConfig?.name
      ?.toLowerCase()
      .replace(/\s+/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyDAOInfo = async () => {
    if (!deployedDAO) return;

    const info = `DAO Created Successfully!
      Name: ${daoConfig?.name}
      Policy ID: ${deployedDAO.policyId}
      Asset Name: ${deployedDAO.assetName}
      Creation Tx: ${deployedDAO.creationTx}
      Network: ${process.env.NETWORK}`;

    await navigator.clipboard.writeText(info);
  };

  // Completion state
  if (currentPhase === "complete" && deployedDAO) {
    return (
      <div className="space-y-6">
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">🎉 DAO Created Successfully!</p>
              <p>
                Your decentralized organization is now live and ready for
                governance.
              </p>
            </div>
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-2 gap-4 p-4 border rounded-lg">
          <div>
            <span className="text-sm font-medium text-muted-foreground">
              DAO Name
            </span>
            <p className="font-medium">{daoConfig?.name}</p>
          </div>
          <div>
            <span className="text-sm font-medium text-muted-foreground">
              Network
            </span>
            <Badge>{process.env.NETWORK}</Badge>
          </div>
          <div className="col-span-2">
            <span className="text-sm font-medium text-muted-foreground">
              Policy ID
            </span>
            <p className="font-mono text-xs break-all">
              {deployedDAO.policyId}
            </p>
          </div>
          <div className="col-span-2">
            <span className="text-sm font-medium text-muted-foreground">
              Asset Name
            </span>
            <p className="font-mono text-xs break-all">
              {deployedDAO.assetName}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button onClick={downloadDAOConfig}>
            <Download className="w-4 h-4 mr-1" />
            Download Config
          </Button>
          <Button variant="outline" onClick={copyDAOInfo}>
            <Copy className="w-4 h-4 mr-1" />
            Copy DAO Info
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              window.open(
                getExplorerUrl(`/transaction/${deployedDAO.creationTx}`),
                "_blank"
              )
            }
          >
            <ExternalLink className="w-4 h-4 mr-1" />
            View Creation Tx
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              window.open(
                `/dao?policyId=${deployedDAO.policyId}&assetName=${deployedDAO.assetName}`,
                "_blank"
              )
            }
          >
            Open DAO →
          </Button>
        </div>

        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">What&apos;s Next?</p>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Fund the treasury</li>
                <li>
                  Share the{" "}
                  <CopyButton
                    textToCopy={`${window.location.origin}/dao?policyId=${deployedDAO.policyId}&assetName=${deployedDAO.assetName}`}
                    className="text-secondary hover:text-secondary-border hover:underline cursor-pointer"
                    popoverMessage="DAO URL copied!"
                  >
                    <span>DAO Url</span>
                  </CopyButton>{" "}
                  with your community
                </li>
                <li>
                  Community members can register to vote by locking governance
                  tokens
                </li>
                <li>Create your first proposals for community voting</li>
                <li>Manage treasury funds through approved proposals</li>
              </ol>
            </div>
          </AlertDescription>
        </Alert>
        <div className="flex justify-between pt-4">
          <Button onClick={onBack} variant="outline">
            Back to Configure
          </Button>
          <Button onClick={onComplete}>
            Continue to Fund Treasury (optional)
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Deployment Progress */}
      {deploymentProgress > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Deployment Progress</span>
            <span>{Math.round(deploymentProgress)}%</span>
          </div>
          <Progress value={deploymentProgress} className="w-full" />
        </div>
      )}

      {/* Ready to start */}
      {currentPhase === "ready" && (
        <div className="space-y-4">
          <div className="p-4 border rounded-lg space-y-3">
            <h3 className="font-medium">Ready to Deploy DAO</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">DAO Name:</span>
                <span className="ml-2 font-medium">{daoConfig?.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Governance Token:</span>
                <span className="ml-2 font-medium">
                  {governanceToken?.name}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Threshold:</span>
                <span className="ml-2 font-medium">
                  {daoConfig?.threshold}%
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Quorum:</span>
                <span className="ml-2 font-medium">
                  {daoConfig?.quorum?.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-medium">Deployment Process</p>
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  <li>Initialize DAO parameters and calculate policy IDs</li>
                  <li>
                    Deploy reference scripts (vote, treasury, proposal, actions)
                  </li>
                  <li>Create the DAO NFT with script references</li>
                  <li>Your DAO will be ready for governance!</li>
                </ol>
                <p className="text-sm">
                  This process requires multiple transactions and may take
                  several minutes.
                </p>
              </div>
            </AlertDescription>
          </Alert>

          <Button
            onClick={initializeDAO}
            disabled={
              !connected || isProcessing || !governanceToken || !daoConfig
            }
            className="w-full"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Initializing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Start DAO Deployment
              </>
            )}
          </Button>
        </div>
      )}

      {/* Initialization phase */}
      {currentPhase === "initialize" && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>
            <p className="font-medium">Initializing DAO creation...</p>
            <p className="text-sm">
              Calculating parameters and preparing deployment plan.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Script deployment phase */}
      {currentPhase === "deploy-scripts" && creationPlan && (
        <ScriptDeploymentSection
          scriptsToDeployData={creationPlan.scriptsToDeployData}
          daoParams={creationPlan.daoParams}
          onDeploymentComplete={handleScriptDeploymentComplete}
          onError={setError}
        />
      )}

      {/* Finalization phase */}
      {currentPhase === "finalize" && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">Creating DAO...</p>
              <p className="text-sm">
                Scripts deployed successfully. Now creating the DAO NFT and
                finalizing deployment.
              </p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!connected && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Please connect your wallet to deploy your DAO
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
