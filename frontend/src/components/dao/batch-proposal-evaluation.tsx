"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@meshsdk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Gavel,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { getExplorerUrl } from "@/lib/utils";

interface BatchEvaluationProps {
  daoPolicyId: string;
  daoKey: string;
  onEvaluationSuccess: () => void;
}

interface EvaluationResult {
  policyId: string;
  assetName: string;
  name: string;
  newStatus: { type: string; option?: number };
  totalVotes: number;
  winningOption?: number;
}

type EvaluationState =
  | "idle"
  | "checking"
  | "building"
  | "signing"
  | "submitting";

export function BatchProposalEvaluation({
  daoPolicyId,
  daoKey,
  onEvaluationSuccess,
}: BatchEvaluationProps) {
  const { wallet, connected } = useWallet();

  const [evaluationState, setEvaluationState] =
    useState<EvaluationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    txHash: string;
    evaluatedCount: number;
    results: EvaluationResult[];
  } | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Check for pending evaluations on mount and refresh
  const checkPendingEvaluations = async () => {
    if (!connected || !wallet) return;

    setLoading(true);
    try {
      const usedAddresses = await wallet.getUsedAddresses();
      const walletAddress = usedAddresses[0];
      const collateral = await wallet.getCollateral();
      const changeAddress = await wallet.getChangeAddress();

      if (!collateral?.length) {
        setPendingCount(0);
        return;
      }

      const response = await fetch("/api/dao/proposal/evaluate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId,
          daoKey,
          walletAddress,
          collateral,
          changeAddress,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.evaluatedCount !== undefined) {
          setPendingCount(data.evaluatedCount);
        }
      }
    } catch (error) {
      console.warn("Failed to check pending evaluations:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkPendingEvaluations();
  }, [connected, wallet, daoPolicyId, daoKey]);

  const handleBatchEvaluate = async () => {
    if (!connected || !wallet) {
      setError("Please connect your wallet");
      return;
    }

    setEvaluationState("building");
    setError(null);

    try {
      const usedAddresses = await wallet.getUsedAddresses();
      const walletAddress = usedAddresses[0];
      const collateral = await wallet.getCollateral();
      const changeAddress = await wallet.getChangeAddress();

      if (!collateral?.length) {
        throw new Error("No collateral available");
      }

      console.log("✓ Building batch evaluation transaction");

      const response = await fetch("/api/dao/proposal/evaluate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId,
          daoKey,
          walletAddress,
          collateral,
          changeAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ?? "Failed to build batch evaluation transaction"
        );
      }

      const { unsignedTx, evaluatedCount, results } = await response.json();

      if (evaluatedCount === 0) {
        setError("No proposals found that need evaluation");
        setEvaluationState("idle");
        return;
      }

      setEvaluationState("signing");
      console.log(
        `Transaction built for ${evaluatedCount} proposals, signing...`
      );
      const signedTx = await wallet.signTx(unsignedTx, true);

      setEvaluationState("submitting");
      console.log("Submitting batch evaluation transaction...");
      const txHash = await wallet.submitTx(signedTx);

      console.log("✓ Batch evaluation successful:", txHash);

      setSuccess({
        txHash,
        evaluatedCount,
        results,
      });
      setEvaluationState("idle");
      setPendingCount(0);
      onEvaluationSuccess();
    } catch (err: any) {
      console.error("❌ Batch evaluation error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to evaluate proposals"
      );
      setEvaluationState("idle");
    }
  };

  const getButtonText = () => {
    switch (evaluationState) {
      case "checking":
        return "Checking Proposals...";
      case "building":
        return "Building Transaction...";
      case "signing":
        return "Waiting for Signature...";
      case "submitting":
        return "Submitting Evaluation...";
      default:
        return `Evaluate ${pendingCount} Proposal${
          pendingCount !== 1 ? "s" : ""
        }`;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Passed":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "FailedThreshold":
      case "FailedQuorum":
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Gavel className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Checking for proposals to evaluate...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5" />
            Proposal Evaluation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Connect your wallet to check for proposals that need evaluation.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (pendingCount === 0 && !success) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            All Proposals Up to Date
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            No proposals found that need evaluation.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={checkPendingEvaluations}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="h-5 w-5" />
          Batch Proposal Evaluation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <div>
                Successfully evaluated {success.evaluatedCount} proposal
                {success.evaluatedCount !== 1 ? "s" : ""}!
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={getExplorerUrl(success.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline flex items-center gap-1"
                >
                  View Transaction <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {success.results.length > 0 && (
                <div className="mt-3 space-y-2">
                  <h4 className="font-semibold text-sm">Evaluation Results:</h4>
                  {success.results.map((result, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 text-sm"
                    >
                      {getStatusIcon(result.newStatus.type)}
                      <span className="font-medium">{result.name}</span>
                      <span className="text-muted-foreground">→</span>
                      <span
                        className={
                          result.newStatus.type === "Passed"
                            ? "text-green-600 font-medium"
                            : "text-red-600"
                        }
                      >
                        {result.newStatus.type === "Passed"
                          ? `Passed (Option ${result.newStatus.option})`
                          : result.newStatus.type === "FailedQuorum"
                          ? "Failed (Low Turnout)"
                          : "Failed (No Majority)"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({result.totalVotes} votes)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {pendingCount > 0 && !success && (
          <div className="space-y-3">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {pendingCount} proposal{pendingCount !== 1 ? "s have" : " has"}{" "}
                ended and need{pendingCount === 1 ? "s" : ""} evaluation to
                finalize the results.
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <Button
                onClick={handleBatchEvaluate}
                disabled={evaluationState !== "idle"}
                className="flex-1"
              >
                {evaluationState !== "idle" && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {getButtonText()}
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={checkPendingEvaluations}
                disabled={loading || evaluationState !== "idle"}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
