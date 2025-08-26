import { Button } from "@/components/ui/button";
import { PlayCircle, Clock } from "lucide-react";
import Link from "next/link";

interface ExecuteActionButtonProps {
  daoPolicyId: string;
  daoKey: string;
  proposalPolicyId: string;
  proposalAssetName: string;
  actionIndex: number; // Changed from actionPolicyId/assetName
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "secondary";
  className?: string;
}

export function ExecuteActionButton({
  daoPolicyId,
  daoKey,
  proposalPolicyId,
  proposalAssetName,
  actionIndex,
  size = "default",
  variant = "secondary",
  className,
}: ExecuteActionButtonProps) {
  const executeUrl = `/dao/proposal/execute-action?daoPolicyId=${daoPolicyId}&daoKey=${daoKey}&proposalPolicyId=${proposalPolicyId}&proposalAssetName=${proposalAssetName}&actionIndex=${actionIndex}`;

  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link href={executeUrl}>
        <PlayCircle className="w-4 h-4 mr-2" />
        Execute Action
      </Link>
    </Button>
  );
}
