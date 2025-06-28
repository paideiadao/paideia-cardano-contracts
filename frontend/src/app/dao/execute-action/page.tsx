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

      const signedTx = await wallet.signTx(unsignedTx);
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
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading action details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (executionState.error && !actionDetails) {
    return (
      <div className="container mx-auto py-8">
        <Alert className="border-red-200 bg-red-50">
          <XCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            {executionState.error}
          </AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button onClick={() => router.back()} variant="outline">
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <Button onClick={() => router.back()} variant="ghost" className="mb-4">
          ← Back to Proposal
        </Button>
        <h1 className="text-3xl font-bold">Execute Action</h1>
        <p className="text-muted-foreground mt-2">
          Execute the treasury action for the passed proposal
        </p>
      </div>

      {/* Success Message */}
      {executionState.success && (
        <Alert className="mb-6 border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Action executed successfully!
            {executionState.txHash && (
              <a
                href={`https://cardanoscan.io/transaction/${executionState.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex items-center text-green-700 hover:text-green-900 underline"
              >
                View Transaction <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Error Message */}
      {executionState.error && (
        <Alert className="mb-6 border-red-200 bg-red-50">
          <XCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            {executionState.error}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Action Details */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{actionDetails?.name}</CardTitle>
                  <CardDescription>
                    {actionDetails?.description}
                  </CardDescription>
                </div>
                <Badge
                  variant={
                    actionStatus.status === "ready"
                      ? "default"
                      : actionStatus.status === "executed"
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {actionStatus.label}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Status</h4>
                  <p className="text-sm text-muted-foreground">
                    {actionStatus.description}
                  </p>
                </div>

                {actionDetails && actionDetails.activationTime > Date.now() && (
                  <div>
                    <h4 className="font-medium mb-2">Activation Time</h4>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        {new Date(
                          actionDetails.activationTime
                        ).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                <Separator />

                <div>
                  <h4 className="font-medium mb-3">Treasury Transfers</h4>
                  {actionDetails?.targets.length === 0 ? (
                    <div className="p-3 bg-muted/50 rounded-lg text-center text-muted-foreground">
                      No transfer targets defined for this action
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {actionDetails?.targets.map((target, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                        >
                          <div>
                            <p className="text-sm font-medium">
                              To: {truncateHash(target.address)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {target.address}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium">
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
                    </div>
                  )}
                </div>

                {totalAmount > 0 && (
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h4 className="font-medium text-blue-900 mb-1">
                      Total Amount
                    </h4>
                    <p className="text-2xl font-bold text-blue-900">
                      {formatADA(totalAmount)}
                    </p>
                  </div>
                )}
              </div>
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
              <CardTitle className="text-lg">Execute Action</CardTitle>
              <CardDescription>Execute this treasury action</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {!connected ? (
                  <div>Connect Wallet</div>
                ) : (
                  <Button
                    onClick={executeAction}
                    disabled={
                      !actionStatus.canExecute ||
                      executionState.isExecuting ||
                      executionState.success
                    }
                    className="w-full"
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
                  <div className="text-xs text-muted-foreground">
                    <p>
                      ⚠️ This action will transfer funds from the DAO treasury.
                      Make sure you understand the consequences.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Action Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Action Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Option</p>
                <p className="text-sm">{actionDetails?.option}</p>
              </div>
              {actionDetails?.treasuryAddress &&
                actionDetails.treasuryAddress !==
                  "treasury_address_placeholder" && (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Treasury Address
                    </p>
                    <p className="text-xs font-mono break-all">
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
