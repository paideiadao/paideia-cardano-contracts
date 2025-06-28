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
  CheckCircle,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Vote,
  Target,
  User,
  Info,
} from "lucide-react";
import Link from "next/link";
import { ProposalDetails } from "@/app/api/dao/proposal/details/route";
import { DAOInfo } from "@/app/api/dao/info/route";
import { getExplorerUrl } from "@/lib/utils";
import { VotingInterface } from "@/components/dao/voting-interface";
import { ProposalEvaluation } from "@/components/dao/proposal-evaluation";
import { ExecuteActionButton } from "@/components/dao/execute-action-button";
import { ActionTargetsDisplay } from "@/components/dao/action-targets-display";

interface LiveStatus {
  type: "FailedQuorum" | "FailedThreshold" | "Passing" | "Active";
  message: string;
  winningOption?: number;
  quorumProgress: number;
  thresholdProgress: number;
}

export default function ProposalPage() {
  const searchParams = useSearchParams();
  const { wallet, connected } = useWallet();

  const proposalPolicyId = searchParams.get("proposalPolicyId");
  const proposalAssetName = searchParams.get("proposalAssetName");
  const daoPolicyId = searchParams.get("daoPolicyId");
  const daoKey = searchParams.get("daoKey");

  const [proposal, setProposal] = useState<ProposalDetails | null>(null);
  const [daoInfo, setDaoInfo] = useState<DAOInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        await Promise.all([fetchProposal(), fetchDAOInfo()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };

    if (proposalPolicyId && proposalAssetName && daoPolicyId && daoKey) {
      loadData();
    } else {
      setIsLoading(false); // Stop loading if params are missing
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
    }
  };

  const fetchDAOInfo = async () => {
    try {
      const response = await fetch(
        `/api/dao/info?policyId=${encodeURIComponent(
          daoPolicyId!
        )}&assetName=${encodeURIComponent(daoKey!)}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch DAO info");
      }

      const data = await response.json();
      setDaoInfo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load DAO info");
    } finally {
      setIsLoading(false);
    }
  };

  const calculateLiveStatus = (): LiveStatus => {
    if (!proposal || !daoInfo) {
      return {
        type: "Active",
        message: "Loading...",
        quorumProgress: 0,
        thresholdProgress: 0,
      };
    }

    const totalVotes = proposal.tally.reduce((sum, votes) => sum + votes, 0);
    const quorumProgress = totalVotes / daoInfo.quorum;

    if (totalVotes < daoInfo.quorum) {
      return {
        type: "FailedQuorum",
        message: `Need ${(
          daoInfo.quorum - totalVotes
        ).toLocaleString()} more votes to reach quorum`,
        quorumProgress,
        thresholdProgress: 0,
      };
    }

    const maxVotes = Math.max(...proposal.tally);
    const winningIndex = proposal.tally.findIndex(
      (votes) => votes === maxVotes
    );
    const winningPercentage = (maxVotes / totalVotes) * 100;
    const thresholdProgress = winningPercentage / daoInfo.threshold;

    if (winningPercentage >= daoInfo.threshold) {
      return {
        type: "Passing",
        message: `Currently passing with ${winningPercentage.toFixed(
          1
        )}% support`,
        winningOption: winningIndex,
        quorumProgress,
        thresholdProgress,
      };
    }

    return {
      type: "FailedThreshold",
      message: `Leading option has ${winningPercentage.toFixed(1)}% (needs ${
        daoInfo.threshold
      }%)`,
      winningOption: winningIndex,
      quorumProgress,
      thresholdProgress,
    };
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

  const getLiveStatusColor = (type: string) => {
    switch (type) {
      case "Passing":
        return "bg-green-100 text-green-800 border-green-200";
      case "FailedQuorum":
      case "FailedThreshold":
        return "bg-orange-100 text-orange-800 border-orange-200";
      default:
        return "bg-blue-100 text-blue-800 border-blue-200";
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

  if (!proposalPolicyId || !proposalAssetName || !daoPolicyId || !daoKey) {
    return (
      <div className="max-w-4xl mx-auto">
        <Alert variant="destructive">
          <AlertDescription>
            Missing required proposal parameters in URL
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (error || !proposal || !daoInfo) {
    return (
      <div className="max-w-4xl mx-auto">
        <Alert variant="destructive">
          <AlertDescription>
            {error ?? "Proposal or DAO not found"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const winningOption = getWinningOption();
  const isActive = proposal.status === "Active";
  const hasEnded = Date.now() > proposal.endTime;
  const liveStatus = calculateLiveStatus();

  console.log(proposal);

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
                {isActive && !hasEnded && (
                  <div
                    className={`px-2 py-1 rounded-full border text-sm font-medium ${getLiveStatusColor(
                      liveStatus.type
                    )}`}
                  >
                    {liveStatus.type === "Passing"
                      ? "Currently Passing"
                      : liveStatus.type === "FailedQuorum"
                      ? "Below Quorum"
                      : liveStatus.type === "FailedThreshold"
                      ? "Below Threshold"
                      : "Active"}
                  </div>
                )}
              </div>
              <p className="text-muted-foreground">{proposal.description}</p>
              {isActive && !hasEnded && (
                <p className="text-sm text-muted-foreground mt-2">
                  {liveStatus.message}
                </p>
              )}
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
                const isLiveWinner = liveStatus.winningOption === index;

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
                        {isLiveWinner && isActive && !hasEnded && (
                          <Badge variant="outline" className="ml-2">
                            Leading
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
                      className={`h-2 ${
                        isWinning || isLiveWinner ? "bg-green-100" : ""
                      }`}
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

          {/* Governance Requirements & Proposal Info - Combined Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                Proposal Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Governance Requirements Section */}
              {isActive && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Governance Requirements
                  </h4>

                  <div className="space-y-3">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">
                          Quorum Progress
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {proposal.totalVotes.toLocaleString()} /{" "}
                          {daoInfo.quorum.toLocaleString()} votes
                        </span>
                      </div>
                      <Progress
                        value={Math.min(liveStatus.quorumProgress * 100, 100)}
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        {liveStatus.quorumProgress >= 1
                          ? "✓ Quorum reached"
                          : `Need ${(
                              daoInfo.quorum - proposal.totalVotes
                            ).toLocaleString()} more votes`}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">
                          Threshold Progress
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {winningOption?.percentage ?? 0}% /{" "}
                          {daoInfo.threshold}% required
                        </span>
                      </div>
                      <Progress
                        value={Math.min(
                          liveStatus.thresholdProgress * 100,
                          100
                        )}
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        {liveStatus.thresholdProgress >= 1
                          ? "✓ Threshold met"
                          : `Leading option needs ${(
                              daoInfo.threshold -
                              (winningOption?.percentage ?? 0)
                            ).toFixed(1)}% more support`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Proposal Details Section */}
              <div className="space-y-3 pt-4 border-t">
                <h4 className="font-semibold text-sm">Proposal Details</h4>

                <div className="grid grid-cols-2 gap-4">
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
                    <span className="text-muted-foreground">
                      Required Quorum
                    </span>
                    <span className="font-semibold">
                      {daoInfo.quorum.toLocaleString()}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Required Threshold
                    </span>
                    <span className="font-semibold">{daoInfo.threshold}%</span>
                  </div>
                </div>

                <div className="flex justify-between">
                  <span className="text-muted-foreground">End Time</span>
                  <div className="text-right">
                    <p className="font-semibold">
                      {isActive
                        ? formatTimeRemaining(proposal.endTime)
                        : "Ended"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(proposal.endTime).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Your Voting Status - Prominent Section */}
              {connected && proposal.userVoteInfo && (
                <div className="space-y-3 pt-4 border  rounded-lg p-4">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Your Voting Status
                  </h4>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Current Vote</span>
                      <span className="font-semibold">
                        {proposal.userVoteInfo.hasVoted ? (
                          <div className="text-right">
                            <div className="text-green-600 dark:text-green-400">
                              {proposal.userVoteInfo.votedAmount?.toLocaleString() ??
                                "Unknown"}{" "}
                              votes on{" "}
                              {getOptionLabel(
                                proposal.userVoteInfo.votedOption ?? 0
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Voting again will replace this vote
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">
                            Not voted yet
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">
                        Total Voting Power
                      </span>
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        {proposal.userVoteInfo.votePower?.toLocaleString() ?? 0}{" "}
                        tokens
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Can Vote</span>
                      <span className="font-semibold">
                        {proposal.userVoteInfo.canVote ? (
                          <span className="text-green-600 dark:text-green-400">
                            ✓ Yes
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">
                            ✗ No
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {proposal.userVoteInfo.hasVoted && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        You can vote again with up to your full voting power (
                        {proposal.userVoteInfo.votePower?.toLocaleString()}{" "}
                        tokens). This will completely replace your previous
                        vote.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
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
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">Option {action.index}</Badge>
                        <h3 className="font-semibold">{action.name}</h3>
                      </div>
                      {proposal.status === "Passed" && (
                        <ExecuteActionButton
                          daoPolicyId={daoPolicyId}
                          daoKey={daoKey}
                          proposalPolicyId={proposal.policyId}
                          proposalAssetName={proposal.assetName}
                          actionIndex={action.index}
                          size="sm"
                        />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {action.description}
                    </p>
                    {action.targets && action.targets.length > 0 && (
                      <ActionTargetsDisplay
                        targets={action.targets}
                        showDetails={false} // Just show summary on proposal page
                      />
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
