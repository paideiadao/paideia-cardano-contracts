import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle, AlertCircle, X } from "lucide-react";
import { TokenMintForm } from "@/components/forms/token-mint-form";
import {
  GovernanceTokenInfo,
  useDAOCreationStore,
} from "@/lib/stores/dao-creation-store";
import { TokenValidationResponse } from "@/app/api/tokens/validate/route";

function GovernanceTokenStep({ onComplete }: { onComplete: () => void }) {
  const { setGovernanceToken, governanceToken } = useDAOCreationStore();
  const [activeTab, setActiveTab] = useState<"create" | "existing">("create");

  const [policyId, setPolicyId] = useState("");
  const [assetName, setAssetName] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] =
    useState<TokenValidationResponse | null>(null);

  const validateExistingToken = async () => {
    if (!policyId.trim() || !assetName.trim()) {
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    try {
      const response = await fetch("/api/tokens/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: policyId.trim(),
          assetName: assetName.trim(),
        }),
      });

      const result = await response.json();
      setValidationResult(result);
    } catch (error) {
      setValidationResult({
        exists: false,
        policyId,
        assetName,
        error: "Failed to validate token",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleUseExistingToken = () => {
    if (!validationResult?.exists) return;

    const tokenInfo = {
      policyId: validationResult.policyId,
      assetName: validationResult.assetName,
      decimals: +(validationResult.assetInfo?.metadata.decimals ?? "6"),
      name: validationResult.assetInfo?.metadata.name ?? "Unknown Token",
      symbol:
        validationResult.assetInfo?.metadata.symbold ??
        validationResult.assetInfo?.metadata.ticker ??
        "UNK",
      isExisting: true,
    };

    setGovernanceToken(tokenInfo);
  };

  // Add function to deselect token
  const handleDeselectToken = () => {
    setGovernanceToken(null);
    // Also clear validation result when deselecting
    setValidationResult(null);
  };

  const canProceed =
    (activeTab === "create" &&
      governanceToken &&
      !governanceToken.isExisting) ||
    (activeTab === "existing" && governanceToken && governanceToken.isExisting);

  const tokenInUse = (
    usedToken: GovernanceTokenInfo | null,
    validatedToken: TokenValidationResponse
  ) => {
    if (
      usedToken?.assetName === validatedToken.assetName &&
      usedToken.policyId === validatedToken.policyId
    )
      return true;
    else return false;
  };

  return (
    <div className="space-y-6">
      {/* Add selected token display at the top */}
      {governanceToken && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Selected governance token:</p>
                <p className="text-sm">
                  {governanceToken.name} ({governanceToken.symbol})
                  {governanceToken.isExisting
                    ? " - Existing Token"
                    : " - New Token"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeselectToken}
                className="ml-4 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <X className="h-4 w-4 mr-1" />
                Deselect
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "create" | "existing")}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="create">Create New Token</TabsTrigger>
          <TabsTrigger value="existing">Use Existing Token</TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-4">
          <TokenMintForm />
        </TabsContent>

        <TabsContent value="existing" className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="policyId">Policy ID</Label>
                  <Input
                    id="policyId"
                    value={policyId}
                    onChange={(e) => setPolicyId(e.target.value)}
                    placeholder="Enter the token's policy ID"
                    className="font-mono text-sm"
                  />
                </div>

                <div>
                  <Label htmlFor="assetName">Asset Name (hex)</Label>
                  <Input
                    id="assetName"
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    placeholder="Enter the token's asset name in hex format"
                    className="font-mono text-sm"
                  />
                </div>

                <Button
                  onClick={validateExistingToken}
                  disabled={
                    !policyId.trim() || !assetName.trim() || isValidating
                  }
                  className="w-full"
                >
                  {isValidating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Validating Token...
                    </>
                  ) : (
                    "Validate Token"
                  )}
                </Button>

                {validationResult && (
                  <div className="space-y-3">
                    {validationResult.exists ? (
                      <Alert>
                        <CheckCircle className="h-4 w-4" />
                        <AlertDescription>
                          <div className="space-y-2">
                            <p className="font-medium">Token found on-chain!</p>
                            {validationResult.assetInfo && (
                              <div className="text-sm space-y-1">
                                <p>
                                  <strong>Name:</strong>{" "}
                                  {validationResult.assetInfo.metadata.name ??
                                    "Not specified"}
                                </p>
                                <p>
                                  <strong>Symbol:</strong>{" "}
                                  {validationResult.assetInfo.metadata.symbol ??
                                    validationResult.assetInfo.metadata
                                      .ticker ??
                                    "Not specified"}
                                </p>
                                <p>
                                  <strong>Decimals:</strong>{" "}
                                  {validationResult.assetInfo.metadata
                                    .decimals ?? "Not specified"}
                                </p>
                              </div>
                            )}
                            <Button
                              onClick={handleUseExistingToken}
                              size="sm"
                              className="mt-2"
                              disabled={tokenInUse(
                                governanceToken!,
                                validationResult
                              )}
                            >
                              {tokenInUse(governanceToken!, validationResult)
                                ? "Token selected"
                                : "Use This Token"}
                            </Button>
                          </div>
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {validationResult.error ?? "Token not found on-chain"}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={onComplete} disabled={!canProceed}>
          Continue to DAO Configuration
        </Button>
      </div>
    </div>
  );
}

export default GovernanceTokenStep;
