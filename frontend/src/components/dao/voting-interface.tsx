"use client";

import { useState } from "react";
import { useWallet } from "@meshsdk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import {
  Loader2,
  Vote,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
} from "lucide-react";
import { ProposalDetails } from "@/app/api/dao/proposal/details/route";
import { getExplorerUrl } from "@/lib/utils";

interface VotingInterfaceProps {
  proposal: ProposalDetails;
  daoPolicyId: string;
  daoKey: string;
  onVoteSuccess: () => void;
}

type VotingState = "idle" | "building" | "signing" | "submitting";

export function VotingInterface({
  proposal,
  daoPolicyId,
  daoKey,
  onVoteSuccess,
}: VotingInterfaceProps) {
  const { wallet, connected } = useWallet();

  const [selectedOption, setSelectedOption] = useState<string>("");
  const [votePower, setVotePower] = useState<number>(0);
  const [votingState, setVotingState] = useState<VotingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const maxVotePower = proposal.userVoteInfo?.votePower ?? 0;
  const canVote = proposal.userVoteInfo?.canVote ?? false;
  const hasVoted = proposal.userVoteInfo?.hasVoted ?? false;

  const getOptionLabel = (index: number) => {
    if (index === 0) return "No / Reject";
    if (proposal.actions.length === 0) return "Yes / Approve";
    const action = proposal.actions.find((a) => a.index === index);
    return action ? `Execute: ${action.name}` : `Option ${index}`;
  };

  const getOptionDescription = (index: number) => {
    if (index === 0) return "Vote against this proposal";
    if (proposal.actions.length === 0) return "Vote in favor of this proposal";
    const action = proposal.actions.find((a) => a.index === index);
    return action?.description ?? `Vote for option ${index}`;
  };

  const handleVote = async () => {
    if (!connected || !wallet || !selectedOption || votePower <= 0) {
      setError("Please select an option and vote amount");
      return;
    }

    setVotingState("building");
    setError(null);

    try {
      const usedAddresses = await wallet.getUsedAddresses();
      const walletAddress = usedAddresses[0];
      const collateral = await wallet.getCollateral();
      const changeAddress = await wallet.getChangeAddress();

      if (!collateral?.length) {
        throw new Error("No collateral available");
      }

      console.log("✓ Building vote transaction");

      const response = await fetch("/api/dao/vote/cast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId,
          daoKey,
          proposalPolicyId: proposal.policyId,
          proposalAssetName: proposal.assetName,
          votedOption: parseInt(selectedOption),
          votePower,
          walletAddress,
          collateral,
          changeAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error ?? "Failed to build vote transaction");
      }

      const { unsignedTx, voteReceiptAssetName } = await response.json();

      setVotingState("signing");
      console.log("Transaction built, signing...");
      const signedTx = await wallet.signTx(unsignedTx, true);

      setVotingState("submitting");
      console.log("Submitting transaction...");
      const txHash = await wallet.submitTx(signedTx);

      console.log("✓ Vote cast successfully:", txHash);

      setSuccess(txHash);
      setVotingState("idle");
      onVoteSuccess();
    } catch (err: any) {
      console.error("❌ Voting error:", err);
      setError(err instanceof Error ? err.message : "Failed to cast vote");
      setVotingState("idle");
    }
  };

  const getButtonText = () => {
    switch (votingState) {
      case "building":
        return "Building Transaction...";
      case "signing":
        return "Waiting for Signature...";
      case "submitting":
        return "Submitting Vote...";
      default:
        return hasVoted ? "Change Vote" : "Cast Vote";
    }
  };

  if (!connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Vote className="h-5 w-5" />
            Cast Your Vote
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Connect your wallet to participate in voting
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!canVote) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Vote className="h-5 w-5" />
            Cast Your Vote
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              You must be registered to vote to participate in this proposal
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
            <CheckCircle className="h-5 w-5 text-green-600" />
            Vote Cast Successfully
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-medium">Your vote has been recorded!</p>
                <p className="text-sm">
                  You voted for: {getOptionLabel(parseInt(selectedOption))}
                </p>
                <p className="text-sm">
                  Vote power used: {votePower.toLocaleString()}
                </p>
              </div>
            </AlertDescription>
          </Alert>

          <div className="flex items-center gap-2">
            <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
              {success}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(getExplorerUrl(`/transaction/${success}`), "_blank")
              }
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View
            </Button>
          </div>

          <Button
            variant="outline"
            onClick={() => {
              setSuccess(null);
              setSelectedOption("");
              setVotePower(0);
            }}
            className="w-full"
          >
            Vote Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Vote className="h-5 w-5" />
          Cast Your Vote
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasVoted && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              You have already voted on this proposal. Voting again will change
              your vote.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <Label>Choose your vote:</Label>
          <RadioGroup value={selectedOption} onValueChange={setSelectedOption}>
            {proposal.tally.map((_, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem
                    value={index.toString()}
                    id={`option-${index}`}
                  />
                  <Label htmlFor={`option-${index}`} className="font-medium">
                    {getOptionLabel(index)}
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground ml-6">
                  {getOptionDescription(index)}
                </p>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Label>Vote Power: {votePower.toLocaleString()}</Label>
            <span className="text-sm text-muted-foreground">
              Max: {maxVotePower.toLocaleString()}
            </span>
          </div>

          <Slider
            value={[votePower]}
            onValueChange={(value) => setVotePower(value[0])}
            max={maxVotePower}
            min={1}
            step={1}
            className="w-full"
          />

          <div className="flex gap-2">
            <Input
              type="number"
              value={votePower}
              onChange={(e) => {
                const value = parseInt(e.target.value) || 0;
                setVotePower(Math.min(Math.max(value, 0), maxVotePower));
              }}
              min={1}
              max={maxVotePower}
              placeholder="Enter vote amount"
            />
            <Button
              variant="outline"
              onClick={() => setVotePower(maxVotePower)}
              disabled={votingState !== "idle"}
            >
              Max
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleVote}
          disabled={
            votingState !== "idle" ||
            !selectedOption ||
            votePower <= 0 ||
            votePower > maxVotePower
          }
          className="w-full"
        >
          {votingState !== "idle" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {getButtonText()}
            </>
          ) : (
            getButtonText()
          )}
        </Button>

        <div className="text-xs text-muted-foreground">
          <p>• Vote power represents the weight of your vote</p>
          <p>• Changing your vote will update your previous choice</p>
        </div>
      </CardContent>
    </Card>
  );
}
