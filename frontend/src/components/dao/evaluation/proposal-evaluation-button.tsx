"use client";
import { Button } from "@/components/ui/button";
import { Loader2, Gavel } from "lucide-react";
import {
  useProposalEvaluation,
  ProposalToEvaluate,
} from "@/hooks/useProposalEvaluation";
import { getExplorerUrl } from "@/lib/utils";
import { toast } from "sonner";

interface ProposalEvaluationButtonProps {
  proposal: ProposalToEvaluate;
  daoPolicyId: string;
  daoKey: string;
  onSuccess?: () => void;
  variant?: "default" | "outline";
  size?: "default" | "sm" | "lg";
  className?: string;
}

export function ProposalEvaluationButton({
  proposal,
  daoPolicyId,
  daoKey,
  onSuccess,
  variant = "default",
  size = "default",
  className,
}: ProposalEvaluationButtonProps) {
  const {
    evaluationState,
    error,
    result,
    evaluateProposal,
    getButtonText,
    canEvaluate,
    connected,
  } = useProposalEvaluation();

  const handleEvaluate = async () => {
    const success = await evaluateProposal(proposal, daoPolicyId, daoKey);

    if (success && result) {
      const statusText = `Final status: ${result.newStatus}${
        result.winningOption !== undefined
          ? ` (Option ${result.winningOption + 1} won)`
          : ""
      }`;

      toast.message("Proposal evaluated successfully!", {
        description: statusText,
        action: {
          label: "View Transaction",
          onClick: () =>
            window.open(
              getExplorerUrl(`/transaction/${result.txHash}`),
              "_blank"
            ),
        },
      });
      onSuccess?.();
    } else if (error) {
      toast.error("Proposal evaluation failed", {
        description: error,
      });
    }
  };

  const isEvaluating = evaluationState !== "idle";
  const showButton = canEvaluate(proposal.status, proposal.endTime);

  if (!showButton) return null;

  return (
    <Button
      onClick={handleEvaluate}
      disabled={!connected || isEvaluating}
      variant={variant}
      size={size}
      className={className}
    >
      {isEvaluating ? (
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
  );
}
