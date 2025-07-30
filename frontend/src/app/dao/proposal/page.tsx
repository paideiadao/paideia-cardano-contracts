"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
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
  History,
  Target,
  User,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { ProposalDetails } from "@/app/api/dao/proposal/details/route";
import { useDaoContext } from "@/contexts/dao-context";
import { getExplorerUrl } from "@/lib/utils";
import { VotingInterface } from "@/components/dao/voting-interface";
import { ProposalEvaluationButton } from "@/components/dao/evaluation/proposal-evaluation-button";
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
  const {
    daoInfo,
    canEvaluateProposal,
    isLoading: isDaoLoading,
  } = useDaoContext();

  const proposalPolicyId = searchParams.get("proposalPolicyId");
  const proposalAssetName = searchParams.get("proposalAssetName");
  const daoPolicyId = searchParams.get("daoPolicyId");
  const daoKey = searchParams.get("daoKey");

  const [proposal, setProposal] = useState<ProposalDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVotingInterface, setShowVotingInterface] = useState(false);

  useEffect(() => {
    if (proposalPolicyId && proposalAssetName && daoPolicyId && daoKey) {
      fetchProposal();
    } else {
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
    try {
      setIsLoading(true);
      setError(null);

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
        return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800";
      case "Passed":
        return "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-800";
      case "FailedThreshold":
      case "FailedQuorum":
        return "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800";
      default:
        return "bg-muted text-muted-foreground border-muted";
    }
  };

  const getLiveStatusColor = (type: string) => {
    switch (type) {
      case "Passing":
        return "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-800";
      case "FailedQuorum":
      case "FailedThreshold":
        return "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-200 dark:border-yellow-800";
      default:
        return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800";
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

  if (isLoading || isDaoLoading) {
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
  const showEvaluationButton = canEvaluateProposal(
    proposal.status,
    proposal.endTime
  );

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
                {/* Time remaining badge */}
                {isActive && !hasEnded && (
                  <div className="px-2 py-1 rounded-full border text-sm font-medium bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-800">
                    <Clock className="h-3 w-3 inline mr-1" />
                    {formatTimeRemaining(proposal.endTime)}
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
            <div className="flex items-center gap-2">
              {/* Evaluation Button */}
              {showEvaluationButton && (
                <ProposalEvaluationButton
                  proposal={{
                    policyId: proposal.policyId,
                    assetName: proposal.assetName,
                    name: proposal.name,
                    description: proposal.description,
                    endTime: proposal.endTime,
                    totalVotes: proposal.totalVotes,
                    tally: proposal.tally,
                    status: proposal.status,
                  }}
                  daoPolicyId={daoPolicyId!}
                  daoKey={daoKey!}
                  onSuccess={() => window.location.reload()}
                  variant="outline"
                  size="sm"
                />
              )}

              {/* External Link Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  window.open(
                    getExplorerUrl(
                      `/transaction/${proposal.identifier.txHash}`
                    ),
                    "_blank"
                  )
                }
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          {/* Voting Section */}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Your Vote
              </CardTitle>
            </CardHeader>
            <CardContent>
              {proposal.userVoteInfo?.hasVoted && !showVotingInterface ? (
                // Show current vote status with change vote button
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-green-700 dark:text-green-300">
                        Your Current Vote
                      </span>
                      <span className="font-semibold text-green-600 dark:text-green-400">
                        {proposal.userVoteInfo.votedAmount?.toLocaleString() ??
                          "Unknown"}{" "}
                        votes
                      </span>
                    </div>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Voted for:{" "}
                      {getOptionLabel(proposal.userVoteInfo.votedOption ?? 0)}
                    </p>
                  </div>

                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      Total Voting Power
                    </span>
                    <span className="font-medium">
                      {proposal.userVoteInfo.votePower?.toLocaleString() ?? 0}{" "}
                      tokens
                    </span>
                  </div>

                  <Button
                    onClick={() => setShowVotingInterface(true)}
                    className="w-full"
                    variant="outline"
                  >
                    Change Vote
                  </Button>

                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      Changing your vote will completely replace your previous
                      vote with your full voting power.
                    </AlertDescription>
                  </Alert>
                </div>
              ) : (
                // Show voting interface
                <div className="space-y-4">
                  {proposal.userVoteInfo?.hasVoted && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Currently voted for:{" "}
                        {getOptionLabel(proposal.userVoteInfo.votedOption ?? 0)}
                      </span>
                      <Button
                        onClick={() => setShowVotingInterface(false)}
                        variant="ghost"
                        size="sm"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}

                  <VotingInterface
                    proposal={proposal}
                    daoPolicyId={daoPolicyId!}
                    daoKey={daoKey!}
                    onVoteSuccess={() => {
                      fetchProposal();
                      setShowVotingInterface(false);
                    }}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Webhook className="h-5 w-5" />
                Proposal Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {proposal.actions.length > 0 ? (
                proposal.actions.map((action) => (
                  <div
                    key={action.index}
                    className={`border rounded-lg p-4 ${
                      action.isExecuted ? "bg-muted/20" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">Option {action.index}</Badge>
                        <h3 className="font-semibold">{action.name}</h3>
                        {action.isExecuted && (
                          <Badge
                            variant="secondary"
                            className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          >
                            ✓ Executed
                          </Badge>
                        )}
                      </div>
                      {proposal.status === "Passed" && !action.isExecuted && (
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
                        showDetails={true}
                      />
                    )}
                    {action.isExecuted && (
                      <div className="mt-3 p-2 bg-green-50 dark:bg-green-950/30 rounded border border-green-200 dark:border-green-800">
                        <p className="text-xs text-green-700 dark:text-green-300">
                          This action has been executed and is now complete.
                        </p>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <>This proposal has no actions, it is a basic opinion vote. </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
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

          {/* Governance Requirements */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Governance Requirements
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Quorum Progress</span>
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
                    {winningOption?.percentage ?? 0}% / {daoInfo.threshold}%
                    required
                  </span>
                </div>
                <Progress
                  value={Math.min(liveStatus.thresholdProgress * 100, 100)}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {liveStatus.thresholdProgress >= 1
                    ? "✓ Threshold met"
                    : `Leading option needs ${(
                        daoInfo.threshold - (winningOption?.percentage ?? 0)
                      ).toFixed(1)}% more support`}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Timeline with end time details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Proposal Created */}
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

              {/* Voting Period */}
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

              {/* UPDATED: Voting Ends with detailed time info */}
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    hasEnded ? "bg-green-500" : "bg-orange-500"
                  }`}
                ></div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Voting Ends</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(proposal.endTime).toLocaleString()}
                  </p>
                  {!hasEnded && (
                    <p className="text-xs font-medium text-orange-600 dark:text-orange-400">
                      {formatTimeRemaining(proposal.endTime)}
                    </p>
                  )}
                </div>
              </div>

              {/* Proposal Evaluation */}
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    ["Passed", "FailedThreshold", "FailedQuorum"].includes(
                      proposal.status
                    )
                      ? "bg-green-500"
                      : proposal.status === "ReadyForEvaluation" ||
                        showEvaluationButton
                      ? "bg-yellow-500"
                      : "bg-muted-foreground/30"
                  }`}
                ></div>
                <div>
                  <p className="text-sm font-medium">Proposal Evaluation</p>
                  <p className="text-xs text-muted-foreground">
                    {["Passed", "FailedThreshold", "FailedQuorum"].includes(
                      proposal.status
                    )
                      ? "Completed"
                      : proposal.status === "ReadyForEvaluation" ||
                        showEvaluationButton
                      ? "Ready for evaluation"
                      : "Pending"}
                  </p>
                </div>
              </div>

              {/* Action Execution Step */}
              {proposal.actions.length > 0 && (
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      proposal.actions.every((action) => action.isExecuted)
                        ? "bg-green-500"
                        : proposal.status === "Passed" &&
                          proposal.actions.some((action) => action.isExecuted)
                        ? "bg-yellow-500"
                        : proposal.status === "Passed"
                        ? "bg-blue-500"
                        : "bg-muted-foreground/30"
                    }`}
                  ></div>
                  <div>
                    <p className="text-sm font-medium">Action Execution</p>
                    <p className="text-xs text-muted-foreground">
                      {proposal.actions.every((action) => action.isExecuted)
                        ? "All actions executed"
                        : proposal.status === "Passed" &&
                          proposal.actions.some((action) => action.isExecuted)
                        ? `${
                            proposal.actions.filter((a) => a.isExecuted).length
                          }/${proposal.actions.length} actions executed`
                        : proposal.status === "Passed"
                        ? "Actions available for execution"
                        : "Pending proposal outcome"}
                    </p>
                  </div>
                </div>
              )}

              {/* Status-specific alerts */}
              {proposal.status === "Passed" && proposal.actions.length > 0 && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    This proposal passed!
                    {proposal.actions.every((action) => action.isExecuted)
                      ? " All actions have been executed."
                      : " Actions can now be executed by anyone."}
                  </AlertDescription>
                </Alert>
              )}

              {hasEnded && proposal.status === "Active" && (
                <Alert>
                  <Clock className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    Voting has ended. This proposal is ready for evaluation.
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
