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
        return <Clock className="h-5 w-5 text-info" />;
      case "Passed":
        return <CheckCircle className="h-5 w-5 text-success" />;
      case "FailedThreshold":
      case "FailedQuorum":
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Active":
        return "bg-info/10 text-info border-info/20";
      case "Passed":
        return "bg-success/10 text-success border-success/20";
      case "FailedThreshold":
      case "FailedQuorum":
        return "bg-destructive/10 text-destructive border-destructive/20";
      default:
        return "bg-muted text-muted-foreground border-muted";
    }
  };

  const getLiveStatusColor = (type: string) => {
    switch (type) {
      case "Passing":
        return "bg-success/10 text-success border-success/20";
      case "FailedQuorum":
      case "FailedThreshold":
        return "bg-warning/10 text-warning border-warning/20";
      default:
        return "bg-info/10 text-info border-info/20";
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
                {isActive && !hasEnded && (
                  <div className="px-2 py-1 rounded-full border text-sm font-medium bg-secondary/10 text-secondary border-secondary/20">
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Your Vote
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg mb-4">
                <span className="text-sm font-medium">Total Voting Power</span>
                <span className="font-semibold">
                  {proposal.userVoteInfo?.votePower?.toLocaleString() ?? 0}{" "}
                  tokens
                </span>
              </div>

              {proposal.userVoteInfo?.hasVoted && !showVotingInterface ? (
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-muted-foreground">
                        Current Vote
                      </span>
                      <span className="font-semibold">
                        {proposal.userVoteInfo.votedAmount?.toLocaleString() ??
                          "Unknown"}{" "}
                        votes
                      </span>
                    </div>
                    <p className="font-medium">
                      {getOptionLabel(proposal.userVoteInfo.votedOption ?? 0)}
                    </p>
                  </div>

                  {proposal.status === "Active" &&
                  Date.now() <= proposal.endTime ? (
                    <>
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
                          Changing your vote will completely replace your
                          previous vote with your full voting power.
                        </AlertDescription>
                      </Alert>
                    </>
                  ) : (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        Voting is currently closed for this proposal.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {proposal.userVoteInfo?.hasVoted && (
                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <span className="text-sm text-muted-foreground">
                        Currently voted:{" "}
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
                            className="bg-success/10 text-success border-success/20"
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
                      <div className="mt-3 p-2 bg-success/5 rounded border border-success/20">
                        <p className="text-xs text-success">
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
                          <Badge variant="outline" className="ml-2">
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
                        isWinning || isLiveWinner ? "[&>div]:bg-success" : ""
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-success rounded-full"></div>
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
                    proposal.status === "Active" ? "bg-info" : "bg-success"
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
                    hasEnded ? "bg-success" : "bg-secondary"
                  }`}
                ></div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Voting Ends</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(proposal.endTime).toLocaleString()}
                  </p>
                  {!hasEnded && (
                    <p className="text-xs font-medium text-secondary">
                      {formatTimeRemaining(proposal.endTime)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    ["Passed", "FailedThreshold", "FailedQuorum"].includes(
                      proposal.status
                    )
                      ? "bg-success"
                      : proposal.status === "ReadyForEvaluation" ||
                        showEvaluationButton
                      ? "bg-warning"
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

              {proposal.actions.length > 0 && (
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      proposal.actions.every((action) => action.isExecuted)
                        ? "bg-success"
                        : proposal.status === "Passed" &&
                          proposal.actions.some((action) => action.isExecuted)
                        ? "bg-warning"
                        : proposal.status === "Passed"
                        ? "bg-info"
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
