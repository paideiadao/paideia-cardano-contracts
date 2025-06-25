"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useWallet } from "@meshsdk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  ArrowLeft,
  Clock,
  Users,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Calendar,
  ExternalLink,
  Vote,
} from "lucide-react";
import Link from "next/link";
import { ProposalDetails } from "@/app/api/dao/proposal/details/route";
import { getExplorerUrl, formatDuration } from "@/lib/utils";
import { VotingInterface } from "@/components/dao/voting-interface";
import { ProposalEvaluation } from "@/components/dao/proposal-evaluation";

export default function ProposalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { wallet, connected } = useWallet();

  const proposalPolicyId = searchParams.get("proposalPolicyId");
  const proposalAssetName = searchParams.get("proposalAssetName");
  const daoPolicyId = searchParams.get("daoPolicyId");
  const daoKey = searchParams.get("daoKey");

  const [proposal, setProposal] = useState<ProposalDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (proposalPolicyId && proposalAssetName && daoPolicyId && daoKey) {
      fetchProposal();
    } else {
      setError("Missing proposal parameters");
      setIsLoading(false);
    }
  }, [
    proposalPolicyId,
    proposalAssetName,
    daoPolicyId,
    daoKey,
    connected,
    wallet,
  ]);

  const fetchProposal = async () => {
    setIsLoading(true);
    setError(null);

    try {
      let walletAddress = "";
      if (connected && wallet) {
        const usedAddresses = await wallet.getUsedAddresses();
        walletAddress = usedAddresses[0];
      }

      const params = new URLSearchParams({
        proposalPolicyId: proposalPolicyId!,
        proposalAssetName: proposalAssetName!,
        daoPolicyId: daoPolicyId!,
        daoKey: daoKey!,
        ...(walletAddress && { walletAddress }),
      });

      const response = await fetch(`/api/dao/proposal/details?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch proposal");
      }

      const data = await response.json();
      setProposal(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load proposal");
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Active":
        return <Clock className="h-5 w-5 text-blue-600" />;
      case "Passed":
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "FailedThreshold":
      case "FailedQuorum":
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Active":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "Passed":
        return "bg-green-100 text-green-800 border-green-200";
      case "FailedThreshold":
      case "FailedQuorum":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const formatTimeRemaining = (endTime: number) => {
    const now = Date.now();
    const timeLeft = endTime - now;

    if (timeLeft <= 0) return "Ended";

    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
  };

  const getOptionLabel = (index: number) => {
    if (index === 0) return "No / Reject";
    if (proposal?.actions.length === 0) return "Yes / Approve";
    const action = proposal?.actions.find((a) => a.index === index);
    return action ? `Execute: ${action.name}` : `Option ${index}`;
  };

  const getWinningOption = () => {
    if (!proposal?.tally.length) return null;

    const maxVotes = Math.max(...proposal.tally);
    const winningIndex = proposal.tally.findIndex(
      (votes) => votes === maxVotes
    );

    return {
      index: winningIndex,
      votes: maxVotes,
      percentage:
        proposal.totalVotes > 0
          ? Math.round((maxVotes / proposal.totalVotes) * 100)
          : 0,
    };
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading proposal...</span>
        </div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="max-w-4xl mx-auto">
        <Alert variant="destructive">
          <AlertDescription>{error ?? "Proposal not found"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const winningOption = getWinningOption();
  const isActive = proposal.status === "Active";
  const hasEnded = Date.now() > proposal.endTime;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link
        href={`/dao?policyId=${daoPolicyId}&assetName=${daoKey}`}
        className="inline-flex items-center text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to DAO
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                {getStatusIcon(proposal.status)}
                <h1 className="text-2xl font-bold">{proposal.name}</h1>
                <div
                  className={`px-2 py-1 rounded-full border text-sm font-medium ${getStatusColor(
                    proposal.status
                  )}`}
                >
                  {proposal.status}
                </div>
              </div>
              <p className="text-muted-foreground">{proposal.description}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                window.open(
                  getExplorerUrl(`/transaction/${proposal.identifier.txHash}`),
                  "_blank"
                )
              }
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          {/* Voting Results */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Vote className="h-5 w-5" />
                Voting Results
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {proposal.tally.map((votes, index) => {
                const percentage =
                  proposal.totalVotes > 0
                    ? Math.round((votes / proposal.totalVotes) * 100)
                    : 0;
                const isWinning = winningOption?.index === index;

                return (
                  <div key={index} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">
                        {getOptionLabel(index)}
                        {isWinning && proposal.status === "Passed" && (
                          <Badge variant="default" className="ml-2">
                            Winner
                          </Badge>
                        )}
                      </span>
                      <div className="text-right">
                        <span className="font-semibold">{percentage}%</span>
                        <span className="text-sm text-muted-foreground ml-1">
                          ({votes.toLocaleString()} votes)
                        </span>
                      </div>
                    </div>
                    <Progress
                      value={percentage}
                      className={`h-2 ${isWinning ? "bg-green-100" : ""}`}
                    />
                  </div>
                );
              })}

              {proposal.totalVotes === 0 && (
                <p className="text-center text-muted-foreground py-4">
                  No votes cast yet
                </p>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          {proposal.actions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Proposal Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {proposal.actions.map((action) => (
                  <div key={action.index} className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline">Option {action.index}</Badge>
                      <h3 className="font-semibold">{action.name}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {action.description}
                    </p>
                    {action.targets && action.targets.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Recipients:</h4>
                        {action.targets.map((target, idx) => (
                          <div
                            key={idx}
                            className="text-sm bg-muted rounded p-2"
                          >
                            <p className="font-mono text-xs mb-1">
                              {target.address}
                            </p>
                            <div className="flex gap-2 flex-wrap">
                              {target.assets.map((asset, assetIdx) => (
                                <span
                                  key={assetIdx}
                                  className="inline-flex items-center px-2 py-1 bg-white dark:bg-gray-800 rounded text-xs"
                                >
                                  {asset.unit === "lovelace"
                                    ? `₳${(
                                        parseInt(asset.quantity) / 1_000_000
                                      ).toFixed(2)}`
                                    : `${parseInt(
                                        asset.quantity
                                      ).toLocaleString()} ${asset.unit.slice(
                                        0,
                                        8
                                      )}...`}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* Voting Interface */}
          {isActive && !hasEnded && (
            <VotingInterface
              proposal={proposal}
              daoPolicyId={daoPolicyId!}
              daoKey={daoKey!}
              onVoteSuccess={fetchProposal}
            />
          )}

          {/* Proposal Evaluation */}
          {proposal.status === "Active" && Date.now() > proposal.endTime && (
            <ProposalEvaluation
              proposal={proposal}
              daoPolicyId={daoPolicyId!}
              daoKey={daoKey!}
              onEvaluationSuccess={fetchProposal}
            />
          )}

          {/* Proposal Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Proposal Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Votes</span>
                <span className="font-semibold">
                  {proposal.totalVotes.toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="font-semibold">{proposal.status}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">End Time</span>
                <div className="text-right">
                  <p className="font-semibold">
                    {isActive ? formatTimeRemaining(proposal.endTime) : "Ended"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(proposal.endTime).toLocaleString()}
                  </p>
                </div>
              </div>

              {proposal.userVoteInfo && (
                <div className="pt-3 border-t">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Your Vote</span>
                    <span className="font-semibold">
                      {proposal.userVoteInfo.hasVoted
                        ? `Option ${proposal.userVoteInfo.votedOption}`
                        : "Not voted"}
                    </span>
                  </div>
                  {proposal.userVoteInfo.votePower && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Voting Power
                      </span>
                      <span className="font-semibold">
                        {proposal.userVoteInfo.votePower.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Proposal Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <div>
                  <p className="text-sm font-medium">Proposal Created</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(
                      proposal.identifier.txHash
                        ? Date.now() - 86400000
                        : Date.now()
                    ).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    proposal.status === "Active"
                      ? "bg-blue-500"
                      : "bg-green-500"
                  }`}
                ></div>
                <div>
                  <p className="text-sm font-medium">Voting Period</p>
                  <p className="text-xs text-muted-foreground">
                    {isActive ? "Currently active" : "Completed"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    hasEnded ? "bg-green-500" : "bg-gray-300"
                  }`}
                ></div>
                <div>
                  <p className="text-sm font-medium">
                    {proposal.status === "Passed"
                      ? "Action Available"
                      : "Proposal Concluded"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {hasEnded
                      ? "Completed"
                      : formatTimeRemaining(proposal.endTime)}
                  </p>
                </div>
              </div>

              {proposal.status === "Passed" && proposal.actions.length > 0 && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    This proposal passed! Actions can now be executed by anyone.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
