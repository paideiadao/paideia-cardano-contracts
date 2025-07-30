"use client";
import { useState } from "react";
import { useWallet } from "@meshsdk/react";
import { useDaoContext } from "@/contexts/dao-context";

export type EvaluationState = "idle" | "building" | "signing" | "submitting";

export interface EvaluationResult {
  txHash: string;
  newStatus: string;
  winningOption?: number;
}

export interface ProposalToEvaluate {
  policyId: string;
  assetName: string;
  name: string;
  description: string;
  endTime: number;
  totalVotes: number;
  tally: number[];
  status: string;
}

export function useProposalEvaluation() {
  const { wallet, connected } = useWallet();
  const { canEvaluateProposal } = useDaoContext();
  const [evaluationState, setEvaluationState] =
    useState<EvaluationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluationResult | null>(null);

  const evaluateProposal = async (
    proposal: ProposalToEvaluate,
    daoPolicyId: string,
    daoKey: string
  ) => {
    if (!connected || !wallet) {
      setError("Please connect your wallet");
      return false;
    }

    setEvaluationState("building");
    setError(null);
    setResult(null);

    try {
      const usedAddresses = await wallet.getUsedAddresses();
      const walletAddress = usedAddresses[0];
      const collateral = await wallet.getCollateral();
      const changeAddress = await wallet.getChangeAddress();

      if (!collateral?.length) {
        throw new Error("No collateral available");
      }

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
      const signedTx = await wallet.signTx(unsignedTx, true);

      setEvaluationState("submitting");
      const txHash = await wallet.submitTx(signedTx);

      const evaluationResult = {
        txHash,
        newStatus,
        winningOption,
      };

      setResult(evaluationResult);
      setEvaluationState("idle");
      return evaluationResult;
    } catch (err: any) {
      setError(
        err instanceof Error ? err.message : "Failed to evaluate proposal"
      );
      setEvaluationState("idle");
      return false;
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

  const reset = () => {
    setError(null);
    setResult(null);
    setEvaluationState("idle");
  };

  return {
    evaluationState,
    error,
    result,
    evaluateProposal,
    getButtonText,
    reset,
    canEvaluate: canEvaluateProposal,
    connected,
  };
}
