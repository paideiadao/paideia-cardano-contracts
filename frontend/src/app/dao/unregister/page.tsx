"use client";

import { UnregisterAnalysis } from "@/app/api/dao/unregister/analysis/route";
import { useWallet } from "@meshsdk/react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
  Users,
  Vote,
  Clock,
  Shield,
  Coins,
} from "lucide-react";
import Link from "next/link";

type RegistrationState =
  | "idle"
  | "loading"
  | "analyzing"
  | "building"
  | "signing"
  | "submitting";

export default function UnregisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { wallet, connected } = useWallet();

  const policyId = searchParams.get("policyId");
  const assetName = searchParams.get("assetName");

  const [analysis, setAnalysis] = useState<UnregisterAnalysis | null>(null);
  const [registrationState, setRegistrationState] =
    useState<RegistrationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    txHash: string;
    votePolicyId: string;
    voteNftAssetName: string;
  } | null>(null);

  useEffect(() => {
    loadAnalysis();
  }, [policyId, assetName, connected]);

  const loadAnalysis = async () => {
    try {
      setRegistrationState("analyzing");
      setError(null);

      const usedAddresses = await wallet.getUsedAddresses();
      const address = usedAddresses[0];

      const response = await fetch("/api/dao/unregister/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId: policyId,
          daoKey: assetName,
          walletAddress: address,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error ?? `Analysis failed with status: ${response.status}`
        );
      }

      const analysisData = (await response.json()) as UnregisterAnalysis;
      setAnalysis(analysisData);
      setRegistrationState("idle");
    } catch (error) {
      console.error("Analysis failed:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to load registration status"
      );
      setRegistrationState("idle");
    }
  };

  const handleUnregister = async () => {
    if (!analysis) return;

    const usedAddresses = await wallet.getUsedAddresses();
    const address = usedAddresses[0];
    const collateral = await wallet.getCollateral();
    const changeAddress = await wallet.getChangeAddress();

    try {
      setRegistrationState("building");
      setError(null);

      const response = await fetch("/api/dao/unregister", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId: policyId,
          daoKey: assetName,
          walletAddress: address,
          collateral,
          changeAddress,
          voteUtxoRef: analysis.voteUtxo?.utxo,
          voteNftAssetName: analysis.voteUtxo?.voteNftAssetName,
          referenceAssetName: analysis.voteUtxo?.referenceAssetName,
          endedVoteReceipts: analysis.endedVotes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error ??
            `Failed to build unregister transaction (${response.status})`
        );
      }

      const { unsignedTx, votePolicyId, voteNftAssetName } =
        await response.json();

      setRegistrationState("signing");
      const signedTx = await wallet.signTx(unsignedTx, true);

      setRegistrationState("submitting");
      const txHash = await wallet.submitTx(signedTx);

      setSuccess({
        txHash,
        votePolicyId,
        voteNftAssetName,
      });

      setRegistrationState("idle");
      setTimeout(() => loadAnalysis(), 2000);
    } catch (error: any) {
      console.error("Unregistration failed:", error);

      let errorMessage = "An unexpected error occurred";

      if (error?.message?.includes("User declined")) {
        errorMessage = "Transaction was cancelled by user";
      } else if (error?.message?.includes("Insufficient funds")) {
        errorMessage = "Insufficient funds for transaction";
      } else if (
        error instanceof TypeError &&
        error.message.includes("fetch")
      ) {
        errorMessage = "Network error - please check your connection";
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      setError(errorMessage);
      setRegistrationState("idle");
    }
  };

  const getButtonText = () => {
    switch (registrationState) {
      case "analyzing":
        return "Loading...";
      case "building":
        return "Building Transaction...";
      case "signing":
        return "Please Sign Transaction...";
      case "submitting":
        return "Submitting Transaction...";
      default:
        return "Unregister";
    }
  };

  const isLoading = registrationState === "analyzing";
  const isProcessing =
    registrationState !== "idle" && registrationState !== "analyzing";

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Analyzing registration status...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back Navigation */}
      <Link
        href={`/dao?policyId=${policyId}&assetName=${assetName}`}
        className="inline-flex items-center text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to DAO
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">DAO Unregistration</h1>
          <p className="text-muted-foreground mt-2">
            Withdraw your governance tokens and leave the DAO
          </p>
        </div>
        <Button
          variant="outline"
          onClick={loadAnalysis}
          disabled={isProcessing}
          className="flex items-center gap-2"
        >
          <RefreshCw
            className={`h-4 w-4 ${isProcessing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setError(null)}
              className="h-auto p-1 text-xs"
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Success Alert */}
      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Unregistration successful!</p>
                <p className="text-sm mt-1">
                  Transaction: {success.txHash.slice(0, 20)}...
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSuccess(null)}
                className="h-auto p-1 text-xs"
              >
                Dismiss
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Registration Status */}
      {analysis && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Registration Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analysis.voteUtxo ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-success text-success-foreground">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Currently Registered
                    </Badge>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <Coins className="h-4 w-4 text-success" />
                      <div>
                        <p className="text-sm font-medium">Locked Tokens</p>
                        <p className="text-lg font-bold text-success">
                          {analysis.voteUtxo.lockedGovernanceTokens}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <Shield className="h-4 w-4 text-info" />
                      <div>
                        <p className="text-sm font-medium">Vote NFT</p>
                        <p className="text-xs font-mono text-muted-foreground break-all">
                          {analysis.voteUtxo.voteNftAssetName}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <Badge variant="secondary">Not Currently Registered</Badge>
                  <p className="text-sm text-muted-foreground mt-2">
                    You are not currently registered with this DAO
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Voting Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Vote className="h-5 w-5" />
                Voting Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Active Votes */}
              {analysis.activeVotes.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className="bg-warning text-warning-foreground"
                    >
                      <Clock className="h-3 w-3 mr-1" />
                      {analysis.activeVotes.length} Active Vote
                      {analysis.activeVotes.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      You have votes in progress that may prevent unregistration
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    {analysis.activeVotes.map((vote, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-2 border-l-2 border-warning bg-warning/5 rounded-r"
                      >
                        <Clock className="h-4 w-4 text-warning" />
                        <span className="text-sm">
                          {vote.proposalName ?? `Vote ${vote.proposalId}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">No active votes</span>
                </div>
              )}

              {/* Completed Votes */}
              {analysis.endedVotes.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-success" />
                    <span className="text-sm font-medium text-success">
                      {analysis.endedVotes.length} Completed Vote
                      {analysis.endedVotes.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    These will be processed during unregistration
                  </p>
                </div>
              )}

              {analysis.activeVotes.length === 0 &&
                analysis.endedVotes.length === 0 && (
                  <div className="text-center py-4">
                    <Vote className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No voting history
                    </p>
                  </div>
                )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Blocking Message */}
      {analysis?.blockingMessage && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{analysis.blockingMessage}</AlertDescription>
        </Alert>
      )}

      {/* Action Card */}
      {analysis && (
        <Card>
          <CardContent className="pt-6">
            {analysis.voteUtxo ? (
              <div className="text-center space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">
                    Ready to Unregister?
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    This will withdraw your{" "}
                    {analysis.voteUtxo.lockedGovernanceTokens} governance tokens
                    and remove your voting rights from this DAO.
                  </p>
                </div>

                <Button
                  onClick={handleUnregister}
                  disabled={!analysis.canUnregister || isProcessing}
                  variant={analysis.canUnregister ? "destructive" : "secondary"}
                  size="lg"
                  className="min-w-48"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {getButtonText()}
                    </>
                  ) : (
                    getButtonText()
                  )}
                </Button>

                {!analysis.canUnregister && (
                  <p className="text-xs text-muted-foreground">
                    Complete or withdraw from active votes to enable
                    unregistration
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Not Registered</h3>
                <p className="text-muted-foreground mb-4">
                  You are not currently registered with this DAO
                </p>
                <Button variant="outline" asChild>
                  <Link
                    href={`/dao/register?policyId=${policyId}&assetName=${assetName}`}
                  >
                    Register for Governance
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
