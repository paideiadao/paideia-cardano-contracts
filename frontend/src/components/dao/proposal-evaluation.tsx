"use client";

import { useState } from "react";
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
} from "lucide-react";
import { ProposalDetails } from "@/app/api/dao/proposal/details/route";
import { getExplorerUrl } from "@/lib/utils";

interface ProposalEvaluationProps {
  proposal: ProposalDetails;
  daoPolicyId: string;
  daoKey: string;
  onEvaluationSuccess: () => void;
}

type EvaluationState = "idle" | "building" | "signing" | "submitting";

export function ProposalEvaluation({
  proposal,
  daoPolicyId,
  daoKey,
  onEvaluationSuccess,
}: ProposalEvaluationProps) {
  const { wallet, connected } = useWallet();

  const [evaluationState, setEvaluationState] =
    useState<EvaluationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    txHash: string;
    newStatus: string;
    winningOption?: number;
  } | null>(null);

  const hasEnded = Date.now() > proposal.endTime;
  const canEvaluate = proposal.status === "Active" && hasEnded;

  const handleEvaluate = async () => {
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

      console.log("✓ Building evaluation transaction");

      const response = await fetch("/api/dao/proposal/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId,
          daoKey,
          proposalPolicyId: proposal.policyId,
          proposalAssetName: proposal.assetName,
          walletAddress,
          collateral,
          changeAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ?? "Failed to build evaluation transaction"
        );
      }

      const { unsignedTx, newStatus, winningOption } = await response.json();

      setEvaluationState("signing");
      console.log("Transaction built, signing...");
      const signedTx = await wallet.signTx(unsignedTx, true);

      setEvaluationState("submitting");
      console.log("Submitting transaction...");
      const txHash = await wallet.submitTx(signedTx);

      console.log("✓ Proposal evaluated successfully:", txHash);

      setSuccess({
        txHash,
        newStatus,
        winningOption,
      });
      setEvaluationState("idle");
      onEvaluationSuccess();
    } catch (err: any) {
      console.error("❌ Evaluation error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to evaluate proposal"
      );
      setEvaluationState("idle");
    }
  };

  const getButtonText = () => {
    switch (evaluationState) {
      case "building":
        return "Building Transaction...";
      case "signing":
        return "Waiting for Signature...";
      case "submitting":
        return "Submitting Evaluation...";
      default:
        return "Evaluate Proposal";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Passed":
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "FailedThreshold":
      case "FailedQuorum":
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Gavel className="h-5 w-5" />;
    }
  };

  if (!hasEnded) {
    return null; // Don't show evaluation until proposal ends
  }

  if (proposal.status !== "Active") {
    return null; // Already evaluated
  }

  if (!connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5" />
            Proposal Evaluation Required
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This proposal has ended and needs to be evaluated. Connect your
              wallet to finalize the results.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (success) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {getStatusIcon(success.newStatus)}
            Proposal Evaluated
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-medium">Proposal evaluation completed!</p>
                <p className="text-sm">
                  Final status:{" "}
                  <span className="font-medium">{success.newStatus}</span>
                  {success.winningOption !== undefined && (
                    <span> (Option {success.winningOption} won)</span>
                  )}
                </p>
              </div>
            </AlertDescription>
          </Alert>

          <div className="flex items-center gap-2">
            <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
              {success.txHash}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(
                  getExplorerUrl(`/transaction/${success.txHash}`),
                  "_blank"
                )
              }
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View
            </Button>
          </div>

          {success.newStatus === "Passed" && proposal.actions.length > 0 && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  <p className="font-medium">Treasury Actions Available</p>
                  <p className="text-sm">
                    This proposal passed with executable actions. They can now
                    be triggered by anyone.
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="h-5 w-5" />
          Evaluate Proposal Results
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">
                Voting has ended - evaluation required
              </p>
              <p className="text-sm">
                The voting period has concluded. Anyone can finalize the results
                by evaluating this proposal.
              </p>
              <div className="text-sm space-y-1 mt-2">
                <p>Total votes: {proposal.totalVotes.toLocaleString()}</p>
                <p>Ended: {new Date(proposal.endTime).toLocaleString()}</p>
              </div>
            </div>
          </AlertDescription>
        </Alert>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleEvaluate}
          disabled={evaluationState !== "idle" || !canEvaluate}
          className="w-full"
        >
          {evaluationState !== "idle" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {getButtonText()}
            </>
          ) : (
            <>
              <Gavel className="mr-2 h-4 w-4" />
              {getButtonText()}
            </>
          )}
        </Button>

        <div className="text-xs text-muted-foreground">
          <p>• Evaluation is permissionless - anyone can trigger it</p>
          <p>• Results are calculated automatically based on DAO rules</p>
          <p>• This transaction only finalizes the voting outcome</p>
        </div>
      </CardContent>
    </Card>
  );
}
