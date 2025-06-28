import { formatADA } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { type ActionTarget } from "@/lib/server/helpers/proposal-helpers";

interface ActionTargetsDisplayProps {
  targets: ActionTarget[];
  showDetails?: boolean;
}

interface ActionTargetCardProps {
  target: ActionTarget;
  index: number;
}

export function ActionTargetsDisplay({
  targets,
  showDetails = true,
}: ActionTargetsDisplayProps) {
  const totalADA = targets.reduce((sum, target) => sum + target.coins, 0);

  const totalTokenTypes = targets.reduce(
    (sum, target) => sum + target.tokens.length,
    0
  );

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium text-blue-900 mb-2">Total Distribution</h4>
        <div className="flex items-center gap-4">
          <div>
            <p className="text-2xl font-bold text-blue-900">
              {formatADA(totalADA)}
            </p>
            <p className="text-xs text-blue-700">Total ADA</p>
          </div>
          {totalTokenTypes > 0 && (
            <div>
              <p className="text-lg font-semibold text-blue-900">
                {totalTokenTypes}
              </p>
              <p className="text-xs text-blue-700">Token Types</p>
            </div>
          )}
          <div>
            <p className="text-lg font-semibold text-blue-900">
              {targets.length}
            </p>
            <p className="text-xs text-blue-700">Recipients</p>
          </div>
        </div>
      </div>

      {/* Individual Targets */}
      {showDetails && (
        <div className="space-y-3">
          <h4 className="font-medium">Recipients</h4>
          {targets.map((target, index) => (
            <ActionTargetCard key={index} target={target} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionTargetCard({ target, index }: ActionTargetCardProps) {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <p className="text-sm font-medium">Recipient {index + 1}</p>
          <p className="text-xs text-muted-foreground font-mono break-all">
            {target.address}
          </p>
        </div>
        <Badge variant="outline">#{index + 1}</Badge>
      </div>

      <div className="space-y-2">
        {target.coins > 0 && (
          <div className="flex items-center justify-between p-2 bg-green-50 rounded">
            <span className="text-sm font-medium">ADA</span>
            <span className="font-bold text-green-700">
              {formatADA(target.coins)}
            </span>
          </div>
        )}

        {target.tokens.map((token, tokenIndex) => (
          <div
            key={tokenIndex}
            className="flex items-center justify-between p-2 bg-muted/50 rounded"
          >
            <span className="text-sm font-mono">
              {token.policyId.length > 10
                ? `${token.policyId.slice(0, 10)}...`
                : token.policyId}
              {token.assetName && `.${token.assetName.slice(0, 10)}...`}
            </span>
            <span className="font-medium">
              {token.quantity.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
