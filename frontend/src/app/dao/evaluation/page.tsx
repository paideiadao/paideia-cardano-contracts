"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import {
  ArrowLeft,
  Clock,
  Vote,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useWallet } from "@meshsdk/react";

interface ProposalToEvaluate {
  policyId: string;
  assetName: string;
  name: string;
  description: string;
  endTime: number;
  tally: number[];
  totalVotes: number;
  predictedStatus: {
    type: "FailedQuorum" | "FailedThreshold" | "Passed";
    option?: number;
  };
}

function EvaluationPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { wallet, connected } = useWallet();

  const [proposals, setProposals] = useState<ProposalToEvaluate[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluatingProposalId, setEvaluatingProposalId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const daoPolicyId = searchParams.get("daoPolicyId");
  const daoKey = searchParams.get("daoKey");

  useEffect(() => {
    if (daoPolicyId && daoKey) {
      fetchProposalsToEvaluate();
    }
  }, [daoPolicyId, daoKey]);

  if (!daoPolicyId || !daoKey) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Missing DAO parameters. Please provide daoPolicyId and daoKey
              query parameters.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const fetchProposalsToEvaluate = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/dao/proposals/find-to-evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId,
          daoKey,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch proposals");
      }

      const data = await response.json();
      setProposals(data.proposals ?? []);
    } catch (err) {
      console.error("Error fetching proposals:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch proposals"
      );
    } finally {
      setLoading(false);
    }
  };

  const evaluateProposal = async (proposal: ProposalToEvaluate) => {
    if (!connected || !wallet) {
      setError("Please connect your wallet first");
      return;
    }

    try {
      setEvaluatingProposalId(`${proposal.policyId}-${proposal.assetName}`);
      setError(null);

      const walletAddress = await wallet.getChangeAddress();
      const collateral = await wallet.getCollateral();

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
          changeAddress: walletAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ?? "Failed to build evaluation transaction"
        );
      }

      const { unsignedTx } = await response.json();

      const signedTx = await wallet.signTx(unsignedTx, true);
      const txHash = await wallet.submitTx(signedTx);

      console.log("✅ Proposal evaluated successfully:", txHash);

      // Remove the evaluated proposal from the list
      setProposals((prev) =>
        prev.filter(
          (p) =>
            !(
              p.policyId === proposal.policyId &&
              p.assetName === proposal.assetName
            )
        )
      );

      router.refresh();
    } catch (err) {
      console.error("❌ Evaluation failed:", err);
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setEvaluatingProposalId(null);
    }
  };

  const getStatusIcon = (status: ProposalToEvaluate["predictedStatus"]) => {
    switch (status.type) {
      case "Passed":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "FailedQuorum":
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case "FailedThreshold":
        return <XCircle className="h-4 w-4 text-red-600" />;
    }
  };

  const getStatusColor = (status: ProposalToEvaluate["predictedStatus"]) => {
    switch (status.type) {
      case "Passed":
        return "bg-green-100 text-green-800";
      case "FailedQuorum":
        return "bg-yellow-100 text-yellow-800";
      case "FailedThreshold":
        return "bg-red-100 text-red-800";
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="ml-2">Loading proposals...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link
          href={`/dao?policyId=${daoPolicyId}&assetName=${daoKey}`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to DAO
        </Link>

        <div>
          <h1 className="text-3xl font-bold">Proposal Evaluation</h1>
          <p className="text-muted-foreground mt-2">
            Evaluate completed proposals to finalize their results and enable
            action execution.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && proposals.length === 0 && (
          <Card>
            <CardContent className="py-8">
              <div className="text-center">
                <Vote className="h-8 w-8 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-semibold mb-2">No Proposals to Evaluate</h3>
                <p className="text-muted-foreground">
                  All proposals are either still active or have already been
                  evaluated.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {proposals.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Proposals Ready for Evaluation ({proposals.length})
              </h2>
              <Button
                onClick={fetchProposalsToEvaluate}
                variant="outline"
                size="sm"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>

            {proposals.map((proposal) => {
              const proposalId = `${proposal.policyId}-${proposal.assetName}`;
              const isEvaluating = evaluatingProposalId === proposalId;

              return (
                <Card key={proposalId}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <CardTitle className="text-lg">
                          {proposal.name}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {proposal.description}
                        </p>
                      </div>
                      <Badge
                        className={getStatusColor(proposal.predictedStatus)}
                      >
                        <div className="flex items-center gap-1">
                          {getStatusIcon(proposal.predictedStatus)}
                          {proposal.predictedStatus.type}
                          {proposal.predictedStatus.type === "Passed" &&
                            ` (Option ${proposal.predictedStatus.option! + 1})`}
                        </div>
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">Ended:</span>
                          <span>{formatDate(proposal.endTime)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Vote className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">
                            Total Votes:
                          </span>
                          <span className="font-medium">
                            {proposal.totalVotes}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">
                          Vote Distribution:
                        </h4>
                        <div className="space-y-1">
                          {proposal.tally.map((votes, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between text-sm"
                            >
                              <span>Option {index + 1}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-24 bg-gray-200 rounded-full h-2">
                                  <div
                                    className="bg-primary h-2 rounded-full"
                                    style={{
                                      width: `${
                                        proposal.totalVotes > 0
                                          ? (votes / proposal.totalVotes) * 100
                                          : 0
                                      }%`,
                                    }}
                                  />
                                </div>
                                <span className="font-medium w-12 text-right">
                                  {votes}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end pt-2">
                        <Button
                          onClick={() => evaluateProposal(proposal)}
                          disabled={!connected || isEvaluating}
                          className="min-w-24"
                        >
                          {isEvaluating ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Evaluating...
                            </>
                          ) : (
                            "Evaluate"
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProposalEvaluationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading...</span>
        </div>
      }
    >
      <EvaluationPageContent />
    </Suspense>
  );
}
