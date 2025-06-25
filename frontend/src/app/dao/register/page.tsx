"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useWallet } from "@meshsdk/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  ArrowLeft,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  Info,
  Vote,
} from "lucide-react";
import { DAOInfo } from "@/app/api/dao/info/route";
import { getExplorerUrl } from "@/lib/utils";

type RegistrationState = "idle" | "building" | "signing" | "submitting";

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { wallet, connected } = useWallet();

  const policyId = searchParams.get("policyId");
  const assetName = searchParams.get("assetName");

  const [daoInfo, setDaoInfo] = useState<DAOInfo | null>(null);
  const [isLoadingDAO, setIsLoadingDAO] = useState(true);
  const [governanceBalance, setGovernanceBalance] = useState<number>(0);
  const [registrationAmount, setRegistrationAmount] = useState<number>(0);
  const [registrationState, setRegistrationState] =
    useState<RegistrationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    txHash: string;
    // votePolicyId: string;
    voteNftAssetName: string;
    voteScriptHash: string;
  } | null>(null);

  useEffect(() => {
    if (policyId && assetName) {
      fetchDAOInfo();
    } else {
      setError("Missing DAO parameters");
      setIsLoadingDAO(false);
    }
  }, [policyId, assetName]);

  useEffect(() => {
    if (daoInfo && connected && wallet) {
      fetchGovernanceBalance();
    }
  }, [daoInfo, connected, wallet]);

  const fetchDAOInfo = async () => {
    if (!policyId || !assetName) return;

    setIsLoadingDAO(true);
    try {
      const response = await fetch(
        `/api/dao/info?policyId=${encodeURIComponent(
          policyId
        )}&assetName=${encodeURIComponent(assetName)}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch DAO info");
      }

      const data = await response.json();
      setDaoInfo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load DAO");
    } finally {
      setIsLoadingDAO(false);
    }
  };

  const fetchGovernanceBalance = async () => {
    if (!daoInfo || !wallet) return;

    try {
      const assets = await wallet.getAssets();
      const govAssetId = daoInfo.governanceToken.fullAssetId;

      // Find the governance token in user's assets
      const govAsset = assets.find((asset: any) => asset.unit === govAssetId);
      const balance = govAsset ? parseInt(govAsset.quantity) : 0;

      setGovernanceBalance(balance);
      // Auto-fill with full balance as default
      setRegistrationAmount(balance);
    } catch (err) {
      console.error("Failed to fetch governance balance:", err);
      setGovernanceBalance(0);
    }
  };
  const handleRegister = async () => {
    if (!connected || !wallet || !daoInfo || !policyId || !assetName) {
      setError("Missing required data for registration");
      return;
    }

    if (registrationAmount < daoInfo.minGovProposalCreate) {
      setError(
        `Minimum registration amount is ${daoInfo.minGovProposalCreate} tokens`
      );
      return;
    }

    if (registrationAmount > governanceBalance) {
      setError("Registration amount exceeds your balance");
      return;
    }

    setError(null);
    setRegistrationState("building");

    try {
      const usedAddresses = await wallet.getUsedAddresses();
      const address = usedAddresses[0];
      const collateral = await wallet.getCollateral();
      const changeAddress = await wallet.getChangeAddress();

      if (!collateral?.length) {
        throw new Error("No collateral available");
      }

      console.log("✓ Building registration transaction");
      console.log("Request params:", {
        daoPolicyId: policyId,
        daoKey: assetName,
        governanceTokenAmount: registrationAmount,
        walletAddress: address,
        changeAddress,
        collateralCount: collateral.length,
      });

      const response = await fetch("/api/dao/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId: policyId,
          daoKey: assetName,
          governanceTokenAmount: registrationAmount,
          walletAddress: address,
          collateral,
          changeAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("❌ Server response error:", errorData);
        throw new Error(
          errorData.error ?? "Failed to build registration transaction"
        );
      }

      const { unsignedTx, voteScriptHash, governanceTokensLocked } =
        await response.json();

      console.log("✓ Transaction built successfully");
      console.log("Response data:", {
        voteScriptHash,
        governanceTokensLocked,
        unsignedTxLength: unsignedTx.length,
      });

      setRegistrationState("signing");
      console.log("🖊️ Requesting wallet signature...");

      let signedTx;
      try {
        signedTx = await wallet.signTx(unsignedTx, true);
        console.log("✓ Transaction signed successfully");
        console.log("Signed tx length:", signedTx.length);
      } catch (signError) {
        console.error("❌ Signing failed:", signError);
        throw new Error(
          `Failed to sign transaction: ${
            signError instanceof Error
              ? signError.message
              : "Unknown signing error"
          }`
        );
      }

      setRegistrationState("submitting");
      console.log("📤 Submitting transaction to blockchain...");

      let txHash;
      try {
        txHash = await wallet.submitTx(signedTx);
        console.log("✓ Transaction submitted successfully");
        console.log("TX Hash:", txHash);
      } catch (submitError) {
        console.error("❌ Transaction submission failed:", submitError);
        console.error("Submit error details:", {
          error: submitError,
          message:
            submitError instanceof Error
              ? submitError.message
              : "Unknown submit error",
          stack: submitError instanceof Error ? submitError.stack : undefined,
        });

        // Try to extract more specific error information
        if (submitError instanceof Error) {
          const errorMessage = submitError.message.toLowerCase();

          if (errorMessage.includes("insufficient")) {
            throw new Error(
              "Insufficient funds for transaction fees or minimum UTxO requirements"
            );
          } else if (errorMessage.includes("collateral")) {
            throw new Error(
              "Collateral validation failed - please check your collateral UTxOs"
            );
          } else if (errorMessage.includes("script")) {
            throw new Error(
              "Script validation failed - the transaction was rejected by smart contracts"
            );
          } else if (errorMessage.includes("reference")) {
            throw new Error("Reference script not found or invalid");
          } else if (errorMessage.includes("mint")) {
            throw new Error(
              "Minting validation failed - token creation was rejected"
            );
          } else if (errorMessage.includes("utxo")) {
            throw new Error(
              "UTxO validation failed - some inputs may have been spent"
            );
          } else {
            throw new Error(`Transaction failed: ${submitError.message}`);
          }
        } else {
          throw new Error("Transaction submission failed with unknown error");
        }
      }

      console.log("🎉 Registration completed successfully!");
      setSuccess({
        txHash,
        voteScriptHash,
        voteNftAssetName: `0001${voteScriptHash.slice(0, 56)}`, // Construct NFT name
      });
      setRegistrationState("idle");
    } catch (err: any) {
      console.error("❌ Complete registration error:", err);
      console.error("Error type:", typeof err);
      console.error("Error constructor:", err?.constructor?.name);

      let userFriendlyMessage = "Failed to register";

      if (err instanceof Error) {
        userFriendlyMessage = err.message;
      } else if (typeof err === "string") {
        userFriendlyMessage = err;
      } else if (err?.message) {
        userFriendlyMessage = err.message;
      }

      setError(userFriendlyMessage);
      setRegistrationState("idle");
    }
  };

  const handleBackToDAO = () => {
    router.push(
      `/dao?policyId=${encodeURIComponent(
        policyId!
      )}&assetName=${encodeURIComponent(assetName!)}`
    );
  };

  const getButtonText = () => {
    switch (registrationState) {
      case "building":
        return "Building Transaction...";
      case "signing":
        return "Waiting for Signature...";
      case "submitting":
        return "Submitting Transaction...";
      default:
        return "Register for Governance";
    }
  };

  const isFormDisabled =
    registrationState !== "idle" || !connected || success !== null;

  if (isLoadingDAO) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading DAO...</span>
        </div>
      </div>
    );
  }

  if (error && !daoInfo) {
    return (
      <div className="max-w-4xl mx-auto">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Button variant="ghost" onClick={handleBackToDAO}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to {daoInfo?.name}
        </Button>

        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">
                🎉 Successfully registered for governance!
              </p>
              <p className="text-sm">
                You can now create proposals and vote in {daoInfo?.name}.
              </p>
              <div className="flex items-center gap-2 mt-3">
                <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
                  {success.txHash}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(
                      getExplorerUrl(`/transaction/${success.txHash}`),
                      "_blank"
                    )
                  }
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  View
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Your Voting Power</CardTitle>
            <CardDescription>
              You've successfully registered{" "}
              {registrationAmount.toLocaleString()} governance tokens
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
              <div className="flex items-center gap-3">
                <Vote className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-medium">Voting Power</p>
                  <p className="text-sm text-muted-foreground">
                    Your influence in governance decisions
                  </p>
                </div>
              </div>
              <p className="text-xl font-bold text-blue-600">
                {registrationAmount.toLocaleString()}
              </p>
            </div>

            <div className="text-center">
              <Button onClick={handleBackToDAO} size="lg">
                Return to DAO & Create Proposals
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" onClick={handleBackToDAO}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to {daoInfo?.name}
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Register for {daoInfo?.name} Governance
            <Info className="h-4 w-4 text-muted-foreground" />
          </CardTitle>
          <CardDescription>
            Lock your governance tokens to participate in voting and proposal
            creation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="mb-6">
            <AccordionItem value="what-is-registration">
              <AccordionTrigger>What does registration mean?</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="space-y-3">
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-semibold text-blue-700">
                      Lock Governance Tokens
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Your tokens are locked in a smart contract to prove your
                      commitment to the DAO. This gives you voting power.
                    </p>
                  </div>

                  <div className="border-l-4 border-green-500 pl-4">
                    <h4 className="font-semibold text-green-700">
                      Receive Vote NFT
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      You get a Vote NFT that represents your registered tokens.
                      This NFT lets you vote and create proposals.
                    </p>
                  </div>

                  <div className="border-l-4 border-purple-500 pl-4">
                    <h4 className="font-semibold text-purple-700">
                      Unlock Anytime*
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      You can unregister and get your tokens back anytime you're
                      not actively voting on proposals.
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="voting-power">
              <AccordionTrigger>How does voting power work?</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Your voting power equals the number of tokens you register:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                  <li>
                    • <strong>More tokens = More influence</strong> in
                    governance decisions
                  </li>
                  <li>
                    • <strong>Minimum required:</strong>{" "}
                    {daoInfo?.minGovProposalCreate.toLocaleString()} tokens to
                    create proposals
                  </li>
                  <li>
                    • <strong>You can register any amount</strong> you own, from
                    minimum to your full balance
                  </li>
                  <li>
                    • <strong>Partial registration:</strong> Keep some tokens
                    liquid if you want
                  </li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="unlocking">
              <AccordionTrigger>When can I unlock my tokens?</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  You can unregister and unlock your tokens when:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                  <li>• You're not actively voting on any proposals</li>
                  <li>
                    • All your previous votes have been "cleaned up" (happens
                    automatically after proposals end)
                  </li>
                  <li>• You no longer want to participate in DAO governance</li>
                </ul>
                <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-950/30 rounded border">
                  <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                    💡 Pro tip: You can register more tokens later if you want
                    to increase your voting power.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Your Token Balance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Available:</span>
                      <span className="font-mono font-medium">
                        {governanceBalance.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Min. Required:
                      </span>
                      <span className="font-mono font-medium">
                        {daoInfo?.minGovProposalCreate.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Token:</span>
                      <span className="font-mono">
                        {daoInfo?.governanceToken.policyId.slice(0, 8)}...
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Registration Amount</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="amount">Tokens to Register</Label>
                      <Input
                        id="amount"
                        type="number"
                        value={registrationAmount}
                        onChange={(e) =>
                          setRegistrationAmount(parseInt(e.target.value) || 0)
                        }
                        min={daoInfo?.minGovProposalCreate}
                        max={governanceBalance}
                        disabled={isFormDisabled}
                      />
                      <div className="flex justify-between mt-1">
                        <p className="text-xs text-muted-foreground">
                          Your voting power will be{" "}
                          {registrationAmount.toLocaleString()}
                        </p>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() =>
                            setRegistrationAmount(governanceBalance)
                          }
                          disabled={isFormDisabled}
                        >
                          Use Max
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {governanceBalance === 0 && connected && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  You don't have any governance tokens. You need to acquire some
                  before registering for this DAO.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={handleBackToDAO}>
                Cancel
              </Button>

              <Button
                onClick={handleRegister}
                disabled={
                  isFormDisabled ||
                  governanceBalance === 0 ||
                  registrationAmount < (daoInfo?.minGovProposalCreate ?? 0)
                }
                className="min-w-[200px]"
              >
                {registrationState !== "idle" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {getButtonText()}
                  </>
                ) : (
                  getButtonText()
                )}
              </Button>
            </div>

            {!connected && (
              <p className="text-sm text-muted-foreground text-center">
                Please connect your wallet to register for governance
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
