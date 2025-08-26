"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  ExternalLink,
  ArrowLeft,
  Wallet,
  Coins,
  Target,
  AlertTriangle,
} from "lucide-react";
import { useWallet } from "@meshsdk/react";
import { Separator } from "@/components/ui/separator";
import { formatADA, truncateHash } from "@/lib/utils";
import { type ActionTarget } from "@/lib/server/helpers/proposal-helpers";

interface ActionDetails {
  name: string;
  description: string;
  activationTime: number;
  proposalPolicyId: string;
  proposalIdentifier: string;
  option: number;
  targets: ActionTarget[];
  treasuryAddress: string;
  status: "pending" | "ready" | "executed";
}

interface ProposalInfo {
  name: string;
  description: string;
  status: "Passed" | "FailedThreshold" | "FailedQuorum" | "Active";
  winningOption?: number;
  endTime: number;
}

interface ExecutionState {
  isLoading: boolean;
  isExecuting: boolean;
  error: string | null;
  success: boolean;
  txHash?: string;
}

export default function ExecuteActionPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { wallet, connected } = useWallet();

  const [actionDetails, setActionDetails] = useState<ActionDetails | null>(
    null
  );
  const [proposalInfo, setProposalInfo] = useState<ProposalInfo | null>(null);
  const [executionState, setExecutionState] = useState<ExecutionState>({
    isLoading: true,
    isExecuting: false,
    error: null,
    success: false,
  });

  const daoPolicyId = searchParams.get("daoPolicyId") as string;
  const daoKey = searchParams.get("daoKey") as string;
  const proposalPolicyId = searchParams.get("proposalPolicyId") as string;
  const proposalAssetName = searchParams.get("proposalAssetName") as string;
  const actionIndexStr = searchParams.get("actionIndex") as string;
  const actionIndex = actionIndexStr !== null ? actionIndexStr : "0";

  useEffect(() => {
    console.log("actionIndex", actionIndex);
    console.log("proposalPolicyId", proposalPolicyId);
    console.log("proposalAssetName", proposalAssetName);
    console.log("daoPolicyId", daoPolicyId);
    console.log("daoKey", daoKey);
    if (
      actionIndex &&
      proposalPolicyId &&
      proposalAssetName &&
      daoPolicyId &&
      daoKey
    ) {
      fetchActionDetails();
    }
  }, [actionIndex, proposalPolicyId, proposalAssetName, daoPolicyId, daoKey]);

  const fetchActionDetails = async () => {
    try {
      setExecutionState((prev) => ({ ...prev, isLoading: true, error: null }));

      const response = await fetch("/api/dao/action/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionIndex,
          proposalPolicyId,
          proposalAssetName,
          daoPolicyId,
          daoKey,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch action details");
      }

      const data = await response.json();
      setActionDetails(data.action);
      setProposalInfo(data.proposal);
    } catch (error) {
      setExecutionState((prev) => ({
        ...prev,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load action details",
      }));
    } finally {
      setExecutionState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const executeAction = async () => {
    if (!connected || !wallet) {
      return;
    }

    try {
      setExecutionState((prev) => ({
        ...prev,
        isExecuting: true,
        error: null,
      }));

      const walletAddress = await wallet.getChangeAddress();
      const collateralUtxos = await wallet.getCollateral();

      const response = await fetch("/api/dao/action/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId,
          daoKey,
          actionIndex,
          proposalPolicyId,
          proposalAssetName,
          walletAddress: walletAddress,
          collateral: collateralUtxos,
          changeAddress: walletAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || "Failed to build execution transaction"
        );
      }

      const { unsignedTx } = await response.json();

      const signedTx = await wallet.signTx(unsignedTx, true);
      const txHash = await wallet.submitTx(signedTx);

      setExecutionState((prev) => ({
        ...prev,
        success: true,
        txHash,
      }));

      setTimeout(() => {
        fetchActionDetails();
      }, 3000);
    } catch (error) {
      console.error("Execution error:", error);
      setExecutionState((prev) => ({
        ...prev,
        error:
          error instanceof Error ? error.message : "Failed to execute action",
      }));
    } finally {
      setExecutionState((prev) => ({ ...prev, isExecuting: false }));
    }
  };

  const getActionStatus = (): {
    status: "pending" | "ready" | "executed";
    label: string;
    description: string;
    canExecute: boolean;
  } => {
    if (!actionDetails || !proposalInfo) {
      return {
        status: "pending",
        label: "Loading",
        description: "Loading action status...",
        canExecute: false,
      };
    }

    if (actionDetails.status === "executed") {
      return {
        status: "executed",
        label: "Executed",
        description: "This action has already been executed",
        canExecute: false,
      };
    }

    if (
      proposalInfo.status !== "Passed" ||
      proposalInfo.winningOption !== actionDetails.option
    ) {
      return {
        status: "pending",
        label: "Cannot Execute",
        description: `Proposal did not pass with option ${actionDetails.option}`,
        canExecute: false,
      };
    }

    const now = Date.now();
    if (now < actionDetails.activationTime) {
      return {
        status: "pending",
        label: "Pending Activation",
        description: `Action can be executed after ${new Date(
          actionDetails.activationTime
        ).toLocaleString()}`,
        canExecute: false,
      };
    }

    return {
      status: "ready",
      label: "Ready to Execute",
      description: "All conditions met - action can be executed",
      canExecute: true,
    };
  };

  const actionStatus = getActionStatus();
  const totalAmount =
    actionDetails?.targets.reduce((sum, target) => sum + target.coins, 0) ?? 0;

  if (executionState.isLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading action details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (executionState.error && !actionDetails) {
    return (
      <div className="container mx-auto py-8">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{executionState.error}</AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button onClick={() => router.back()} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Target className="h-8 w-8" />
          <h1 className="text-3xl font-bold">Execute Action</h1>
        </div>
        <p className="text-muted-foreground">
          Execute the treasury action for the passed proposal
        </p>
      </div>

      {/* Success Message */}
      {executionState.success && (
        <Alert className="mb-6 bg-success/10 border-success/20">
          <CheckCircle className="h-4 w-4 text-success" />
          <AlertDescription className="text-success">
            Action executed successfully!
            {executionState.txHash && (
              <a
                href={`https://cardanoscan.io/transaction/${executionState.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex items-center text-success hover:text-success/80 underline"
              >
                View Transaction <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Error Message */}
      {executionState.error && (
        <Alert variant="destructive" className="mb-6">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{executionState.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Action Overview Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl">
                    {actionDetails?.name}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {actionDetails?.description}
                  </CardDescription>
                </div>
                <Badge
                  variant={
                    actionStatus.status === "ready"
                      ? "default"
                      : actionStatus.status === "executed"
                      ? "secondary"
                      : "outline"
                  }
                  className={
                    actionStatus.status === "ready"
                      ? "bg-success/10 text-success border-success/20"
                      : actionStatus.status === "executed"
                      ? "bg-secondary/10 text-secondary border-secondary/20"
                      : "bg-warning/10 text-warning border-warning/20"
                  }
                >
                  {actionStatus.label}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-muted/50">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    Status
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {actionStatus.description}
                  </p>
                </div>

                {actionDetails && actionDetails.activationTime > Date.now() && (
                  <div className="p-4 rounded-lg bg-secondary/5 border border-secondary/20">
                    <h4 className="font-medium mb-2 flex items-center gap-2 text-secondary">
                      <Clock className="h-4 w-4" />
                      Activation Time
                    </h4>
                    <span className="text-sm text-secondary">
                      {new Date(actionDetails.activationTime).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Treasury Transfers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Treasury Transfers
              </CardTitle>
            </CardHeader>
            <CardContent>
              {actionDetails?.targets.length === 0 ? (
                <div className="p-6 bg-muted/30 rounded-lg text-center">
                  <Target className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground">
                    No transfer targets defined for this action
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {actionDetails?.targets.map((target, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between gap-4 p-4 bg-muted/30 rounded-lg border"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Wallet className="h-4 w-4 text-muted-foreground" />
                          <p className="text-sm font-medium">
                            To: {truncateHash(target.address)}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono wrap-anywhere">
                          {target.address}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-primary">
                          {formatADA(target.coins)}
                        </p>
                        {target.tokens.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            + {target.tokens.length} token(s)
                          </p>
                        )}
                      </div>
                    </div>
                  ))}

                  {totalAmount > 0 && (
                    <div className="mt-4 p-4 bg-primary/5 border border-primary/20 rounded-lg">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-primary flex items-center gap-2">
                          <Coins className="h-4 w-4" />
                          Total Amount
                        </h4>
                        <p className="text-2xl font-bold text-primary">
                          {formatADA(totalAmount)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Related Proposal */}
          {proposalInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Related Proposal</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-medium">{proposalInfo.name}</h4>
                    <p className="text-sm text-muted-foreground">
                      {proposalInfo.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge
                      variant={
                        proposalInfo.status === "Passed"
                          ? "default"
                          : "secondary"
                      }
                      className={
                        proposalInfo.status === "Passed"
                          ? "bg-success/10 text-success border-success/20"
                          : ""
                      }
                    >
                      {proposalInfo.status}
                    </Badge>
                    {proposalInfo.winningOption !== undefined && (
                      <span className="text-sm text-muted-foreground">
                        Winning Option: {proposalInfo.winningOption}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Execute Action Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5" />
                Execute Action
              </CardTitle>
              <CardDescription>Execute this treasury action</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {!connected ? (
                  <div className="p-4 bg-warning/5 border border-warning/20 rounded-lg text-center">
                    <Wallet className="h-6 w-6 text-warning mx-auto mb-2" />
                    <p className="text-sm text-warning font-medium">
                      Connect your wallet to execute actions
                    </p>
                  </div>
                ) : (
                  <Button
                    onClick={executeAction}
                    disabled={
                      !actionStatus.canExecute ||
                      executionState.isExecuting ||
                      executionState.success
                    }
                    className="w-full"
                    variant="secondary"
                    size="lg"
                  >
                    {executionState.isExecuting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Executing...
                      </>
                    ) : executionState.success ? (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Executed
                      </>
                    ) : (
                      <>
                        Execute Action
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                )}

                {actionStatus.canExecute && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      This action will transfer funds from the DAO treasury.
                      Make sure you understand the consequences.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Action Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Action Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 bg-muted/30 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Option</p>
                <p className="font-semibold">{actionDetails?.option}</p>
              </div>

              {actionDetails?.treasuryAddress &&
                actionDetails.treasuryAddress !==
                  "treasury_address_placeholder" && (
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">
                      Treasury Address
                    </p>
                    <p className="text-xs font-mono break-all text-primary">
                      {truncateHash(actionDetails.treasuryAddress)}
                    </p>
                  </div>
                )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
