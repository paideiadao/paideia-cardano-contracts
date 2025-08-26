"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useWallet } from "@meshsdk/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  ArrowLeft,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { RegistrationStatus } from "@/app/api/dao/check-registration/route";
import { formatDuration } from "@/lib/utils";
import { useDaoContext } from "@/contexts/dao-context";

interface ProposalTarget {
  address: string;
  assets: Array<{
    unit: string;
    quantity: string;
    metadata?: {
      name?: string;
      ticker?: string;
      decimals?: number;
    };
  }>;
}

interface ProposalForm {
  name: string;
  description: string;
  startTime: Date | null;
  endTime: Date | null;
}

interface ActionForm {
  name: string;
  description: string;
  activationTime: Date | null;
  targets: ProposalTarget[];
}

type CreationState = "idle" | "building" | "signing" | "submitting";

export default function CreateProposalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { wallet, connected } = useWallet();
  const { daoInfo, isLoading } = useDaoContext();

  const policyId = searchParams.get("daoPolicyId");
  const assetName = searchParams.get("daoKey");

  const [registrationStatus, setRegistrationStatus] =
    useState<RegistrationStatus | null>(null);
  const [creationState, setCreationState] = useState<CreationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    txHash: string;
    proposalIdentifier: string;
    proposalPolicyId: string;
  } | null>(null);

  const [proposal, setProposal] = useState<ProposalForm>({
    name: "",
    description: "",
    startTime: null,
    endTime: null,
  });

  const [includeAction, setIncludeAction] = useState(false);
  const [action, setAction] = useState<ActionForm>({
    name: "",
    description: "",
    activationTime: null,
    targets: [{ address: "", assets: [] }],
  });

  useEffect(() => {
    if (connected && wallet && policyId && assetName) {
      checkRegistrationStatus();
    }
  }, [connected, wallet, policyId, assetName]);

  // Set default times when DAO info loads
  useEffect(() => {
    if (daoInfo) {
      const defaultStartTime = new Date(Date.now() + 2 * 60 * 1000); // 2 min from now
      // End time: respects minimum duration
      const defaultEndTime = new Date(
        defaultStartTime.getTime() + daoInfo.minProposalTime // Already in ms
      );
      // Action activation: 1 hour after voting ends
      const defaultActivationTime = new Date(
        defaultEndTime.getTime() + 60 * 60 * 1000 // 1 hour in ms
      );

      setProposal((prev) => ({
        ...prev,
        startTime: defaultStartTime,
        endTime: defaultEndTime,
      }));

      setAction((prev) => ({
        ...prev,
        activationTime: defaultActivationTime,
      }));
    }
  }, [daoInfo]);

  const checkRegistrationStatus = async () => {
    if (!connected || !wallet || !policyId || !assetName) return;

    try {
      const usedAddresses = await wallet.getUsedAddresses();
      const walletAddress = usedAddresses[0];

      const response = await fetch("/api/dao/check-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId: policyId,
          daoKey: assetName,
          walletAddress,
        }),
      });

      if (!response.ok) throw new Error("Failed to check registration");
      const status = await response.json();
      setRegistrationStatus(status);
    } catch (err) {
      console.error("Registration check failed:", err);
      setRegistrationStatus({ isRegistered: false });
    }
  };

  const handleProposalChange = (field: string, value: string | Date) => {
    if (field === "startTime" || field === "endTime") {
      const dateValue =
        typeof value === "string" ? parseDateTimeLocal(value) : value;
      setProposal((prev) => ({ ...prev, [field]: dateValue }));

      // Auto-adjust dependent times
      if (field === "startTime" && dateValue && daoInfo) {
        const minEndTime = new Date(
          dateValue.getTime() + daoInfo.minProposalTime // already in ms
        );
        if (!proposal.endTime || proposal.endTime < minEndTime) {
          setProposal((prev) => ({ ...prev, endTime: minEndTime }));
        }
      }
    } else {
      setProposal((prev) => ({ ...prev, [field]: value }));
    }
    setError(null);
  };

  const handleActionChange = (
    field: keyof ActionForm,
    value: string | Date
  ) => {
    if (field === "activationTime") {
      const dateValue =
        typeof value === "string" ? parseDateTimeLocal(value) : value;
      setAction((prev) => ({ ...prev, activationTime: dateValue }));
    } else {
      setAction((prev) => ({ ...prev, [field]: value }));
    }
    setError(null);
  };

  const getTimeConstraints = () => {
    const now = new Date();
    const minStartTime = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes from now

    let minEndTime = new Date();
    let maxEndTime = new Date();

    if (proposal.startTime && daoInfo) {
      // daoInfo times are already in milliseconds
      minEndTime = new Date(
        proposal.startTime.getTime() + daoInfo.minProposalTime
      );
      maxEndTime = new Date(
        proposal.startTime.getTime() + daoInfo.maxProposalTime
      );
    }

    return {
      minStart: formatDateTimeLocal(minStartTime),
      minEnd: formatDateTimeLocal(minEndTime),
      maxEnd: formatDateTimeLocal(maxEndTime),
      minActivation: proposal.endTime
        ? formatDateTimeLocal(
            new Date(proposal.endTime.getTime() + 60 * 60 * 1000)
          ) // 1 hour after end
        : "",
    };
  };

  const addTarget = () => {
    setAction((prev) => ({
      ...prev,
      targets: [...prev.targets, { address: "", assets: [] }],
    }));
  };

  const removeTarget = (index: number) => {
    setAction((prev) => ({
      ...prev,
      targets: prev.targets.filter((_, i) => i !== index),
    }));
  };

  const updateTarget = (
    index: number,
    field: keyof ProposalTarget,
    value: any
  ) => {
    setAction((prev) => ({
      ...prev,
      targets: prev.targets.map((target, i) =>
        i === index ? { ...target, [field]: value } : target
      ),
    }));
  };

  const addAssetToTarget = (targetIndex: number) => {
    setAction((prev) => ({
      ...prev,
      targets: prev.targets.map((target, i) =>
        i === targetIndex
          ? {
              ...target,
              assets: [...target.assets, { unit: "", quantity: "" }],
            }
          : target
      ),
    }));
  };

  const removeAssetFromTarget = (targetIndex: number, assetIndex: number) => {
    setAction((prev) => ({
      ...prev,
      targets: prev.targets.map((target, i) =>
        i === targetIndex
          ? {
              ...target,
              assets: target.assets.filter((_, j) => j !== assetIndex),
            }
          : target
      ),
    }));
  };

  const updateTargetAsset = (
    targetIndex: number,
    assetIndex: number,
    field: string,
    value: string
  ) => {
    setAction((prev) => ({
      ...prev,
      targets: prev.targets.map((target, i) =>
        i === targetIndex
          ? {
              ...target,
              assets: target.assets.map((asset, j) =>
                j === assetIndex ? { ...asset, [field]: value } : asset
              ),
            }
          : target
      ),
    }));
  };

  const validateForm = () => {
    if (!proposal.name.trim()) return "Proposal name is required";
    if (!proposal.description.trim()) return "Proposal description is required";
    if (!proposal.startTime) return "Proposal start time is required";
    if (!proposal.endTime) return "Proposal end time is required";

    const now = new Date();
    if (proposal.startTime <= new Date(now.getTime() + 60000)) {
      return "Start time must be at least 1 minute in the future";
    }

    if (proposal.endTime <= proposal.startTime) {
      return "End time must be after start time";
    }

    if (daoInfo && proposal.startTime && proposal.endTime) {
      const duration =
        proposal.endTime.getTime() - proposal.startTime.getTime();
      if (duration < daoInfo.minProposalTime) {
        return `Proposal duration must be at least ${formatDuration(
          daoInfo.minProposalTime
        )}`;
      }
      if (duration > daoInfo.maxProposalTime) {
        return `Proposal duration cannot exceed ${formatDuration(
          daoInfo.maxProposalTime
        )}`;
      }
    }

    if (includeAction) {
      if (!action.name.trim()) return "Action name is required";
      if (!action.description.trim()) return "Action description is required";
      if (!action.activationTime) return "Action activation time is required";

      if (
        action.activationTime &&
        proposal.endTime &&
        action.activationTime <= proposal.endTime
      ) {
        return "Action activation must be after proposal end time";
      }
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!connected || !wallet) {
      setError("Please connect your wallet");
      return;
    }

    setCreationState("building");
    setError(null);

    try {
      const usedAddresses = await wallet.getUsedAddresses();
      const address = usedAddresses[0];
      const collateral = await wallet.getCollateral();
      const changeAddress = await wallet.getChangeAddress();

      if (!collateral?.length) {
        throw new Error("No collateral available");
      }

      console.log("✓ Building proposal creation transaction");

      const requestBody = {
        daoPolicyId: policyId,
        daoKey: assetName,
        walletAddress: address,
        collateral,
        changeAddress,
        proposal: {
          ...proposal,
          endTime: proposal.endTime?.toISOString(),
        },
        ...(includeAction && {
          action: {
            ...action,
            activationTime: action.activationTime?.toISOString(),
          },
        }),
      };

      const response = await fetch("/api/dao/proposal/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error ?? "Failed to build transaction");
      }

      const { unsignedTx, proposalIdentifier, proposalName, proposalPolicyId } =
        await response.json();

      setCreationState("signing");
      console.log("Transaction built, signing...");
      const signedTx = await wallet.signTx(unsignedTx, true);

      setCreationState("submitting");
      console.log("Submitting transaction...");
      const txHash = await wallet.submitTx(signedTx);

      console.log("✓ Proposal created:", txHash);

      setSuccess({
        txHash,
        proposalIdentifier,
        proposalPolicyId,
      });
      setCreationState("idle");
    } catch (err: any) {
      console.error("❌ Proposal creation error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to create proposal"
      );
      setCreationState("idle");
    }
  };

  const getButtonText = () => {
    switch (creationState) {
      case "building":
        return "Building Transaction...";
      case "signing":
        return "Waiting for Signature...";
      case "submitting":
        return "Submitting Transaction...";
      default:
        return "Create Proposal";
    }
  };

  const timeConstraints = getTimeConstraints();

  if (isLoading) {
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

  if (!registrationStatus?.isRegistered) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">Registration Required</p>
              <p>You must be registered to vote to create proposals.</p>
              <Link
                href={`/dao/register?policyId=${policyId}&assetName=${assetName}`}
              >
                <Button size="sm" className="mt-2">
                  Register to Vote
                </Button>
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">🎉 Proposal Created Successfully!</p>
              <p>Your proposal is now live and open for voting.</p>
              <div className="flex items-center gap-2 mt-3">
                <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
                  {success.txHash}
                </span>
              </div>
            </div>
          </AlertDescription>
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle>What&apos;s Next?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 dark:text-blue-300 text-sm font-bold">
                    1
                  </span>
                </div>
                <div>
                  <p className="font-medium">Share Your Proposal</p>
                  <p className="text-sm text-muted-foreground">
                    Let the community know about your proposal
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                  <span className="text-green-600 dark:text-green-300 text-sm font-bold">
                    2
                  </span>
                </div>
                <div>
                  <p className="font-medium">Community Voting</p>
                  <p className="text-sm text-muted-foreground">
                    Registered members can now vote on your proposal
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center">
                  <span className="text-purple-600 dark:text-purple-300 text-sm font-bold">
                    3
                  </span>
                </div>
                <div>
                  <p className="font-medium">Automatic Execution</p>
                  <p className="text-sm text-muted-foreground">
                    {includeAction
                      ? "Treasury actions will be available for execution if the proposal passes"
                      : "No automatic actions - this is a governance-only proposal"}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  router.push(
                    `/dao/proposal?proposalPolicyId=${success.proposalPolicyId}&proposalAssetName=${success.proposalIdentifier}&daoPolicyId=${policyId}&daoKey=${assetName}`
                  )
                }
                className="flex-1"
              >
                View Your Proposal
              </Button>
              <Button
                onClick={() =>
                  router.push(
                    `/dao?policyId=${policyId}&assetName=${assetName}`
                  )
                }
                variant="outline"
                className="flex-1"
              >
                Return to DAO
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create New Proposal</CardTitle>
          <CardDescription>
            Submit a proposal for community voting. All registered members can
            vote.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Proposal Details */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Proposal Details</h3>

              <div>
                <Label htmlFor="name">Proposal Title</Label>
                <Input
                  id="name"
                  value={proposal.name}
                  onChange={(e) => handleProposalChange("name", e.target.value)}
                  placeholder="Brief, descriptive title for your proposal"
                  maxLength={100}
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {proposal.name.length}/100 characters
                </p>
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={proposal.description}
                  onChange={(e) =>
                    handleProposalChange("description", e.target.value)
                  }
                  placeholder="Detailed explanation of what you're proposing and why..."
                  rows={4}
                  maxLength={2000}
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {proposal.description.length}/2000 characters
                </p>
              </div>

              <div>
                <Label htmlFor="startTime">Voting Start Time</Label>
                <Input
                  id="startTime"
                  type="datetime-local"
                  value={formatDateTimeLocal(proposal.startTime)}
                  onChange={(e) =>
                    handleProposalChange("startTime", e.target.value)
                  }
                  min={timeConstraints.minStart}
                  required
                />
                <div className="flex items-center gap-2 mt-1">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    Voting will begin at this time (
                    {Intl.DateTimeFormat().resolvedOptions().timeZone})
                  </p>
                </div>
              </div>

              <div>
                <Label htmlFor="endTime">Voting End Time</Label>
                <Input
                  id="endTime"
                  type="datetime-local"
                  value={formatDateTimeLocal(proposal.endTime)}
                  onChange={(e) =>
                    handleProposalChange("endTime", e.target.value)
                  }
                  min={timeConstraints.minEnd}
                  max={timeConstraints.maxEnd}
                  required
                />
                <div className="flex items-center gap-2 mt-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    Duration: {formatDuration(daoInfo?.minProposalTime ?? 0)} to{" "}
                    {formatDuration(daoInfo?.maxProposalTime ?? 0)}
                    {proposal.startTime && proposal.endTime && (
                      <span className="ml-2 font-medium">
                        (Current:{" "}
                        {formatDuration(
                          proposal.endTime.getTime() -
                            proposal.startTime.getTime()
                        )}
                        )
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Treasury Action */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeAction"
                  checked={includeAction}
                  onCheckedChange={() => setIncludeAction(!includeAction)}
                />
                <Label htmlFor="includeAction">Include Treasury Action</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Optional: Create an action that will be executed if this
                proposal passes
              </p>

              {includeAction && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Treasury Action Details
                    </CardTitle>
                    <CardDescription>
                      This action will be available for execution if the
                      &quot;Yes&quot; vote wins
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="actionName">Action Name</Label>
                      <Input
                        id="actionName"
                        value={action.name}
                        onChange={(e) =>
                          handleActionChange("name", e.target.value)
                        }
                        placeholder="Brief name for this action"
                        maxLength={100}
                        required={includeAction}
                      />
                    </div>

                    <div>
                      <Label htmlFor="actionDescription">
                        Action Description
                      </Label>
                      <Textarea
                        id="actionDescription"
                        value={action.description}
                        onChange={(e) =>
                          handleActionChange("description", e.target.value)
                        }
                        placeholder="Explain what this action will do..."
                        rows={3}
                        maxLength={1000}
                        required={includeAction}
                      />
                    </div>

                    <div>
                      <Label htmlFor="activationTime">
                        Action Activation Time
                      </Label>
                      <Input
                        id="activationTime"
                        type="datetime-local"
                        value={formatDateTimeLocal(action.activationTime)}
                        onChange={(e) =>
                          handleActionChange("activationTime", e.target.value)
                        }
                        min={timeConstraints.minActivation}
                        required={includeAction}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Must be after voting ends (
                        {Intl.DateTimeFormat().resolvedOptions().timeZone})
                      </p>
                    </div>

                    {/* Recipients */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Recipients</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addTarget}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add Recipient
                        </Button>
                      </div>

                      {action.targets.map((target, targetIndex) => (
                        <Card key={targetIndex} className="p-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="font-medium">
                                Recipient {targetIndex + 1}
                              </h4>
                              {action.targets.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeTarget(targetIndex)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>

                            <div>
                              <Label>Cardano Address</Label>
                              <Input
                                value={target.address}
                                onChange={(e) =>
                                  updateTarget(
                                    targetIndex,
                                    "address",
                                    e.target.value
                                  )
                                }
                                placeholder="addr1..."
                                required={includeAction}
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label>Assets to Send</Label>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => addAssetToTarget(targetIndex)}
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  Add Asset
                                </Button>
                              </div>

                              {target.assets.map((asset, assetIndex) => (
                                <div
                                  key={assetIndex}
                                  className="flex gap-2 items-end"
                                >
                                  <div className="flex-1">
                                    <Label className="text-xs">Asset</Label>
                                    <Select
                                      value={asset.unit}
                                      onValueChange={(value) =>
                                        updateTargetAsset(
                                          targetIndex,
                                          assetIndex,
                                          "unit",
                                          value
                                        )
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select asset" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="lovelace">
                                          ADA (₳
                                          {(
                                            parseInt(
                                              daoInfo?.treasury.assets.find(
                                                (a) => a.unit === "lovelace"
                                              )?.quantity ?? "0"
                                            ) / 1_000_000
                                          ).toFixed(2)}{" "}
                                          available)
                                        </SelectItem>
                                        {daoInfo?.treasury.assets
                                          .filter((a) => a.unit !== "lovelace")
                                          .map((treasuryAsset) => (
                                            <SelectItem
                                              key={treasuryAsset.unit}
                                              value={treasuryAsset.unit}
                                            >
                                              {treasuryAsset.metadata?.name ??
                                                `${treasuryAsset.unit.slice(
                                                  0,
                                                  8
                                                )}...`}{" "}
                                              (
                                              {parseInt(
                                                treasuryAsset.quantity
                                              ).toLocaleString()}{" "}
                                              available)
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="flex-1">
                                    <Label className="text-xs">Quantity</Label>
                                    <Input
                                      type="number"
                                      value={asset.quantity}
                                      onChange={(e) =>
                                        updateTargetAsset(
                                          targetIndex,
                                          assetIndex,
                                          "quantity",
                                          e.target.value
                                        )
                                      }
                                      placeholder={
                                        asset.unit === "lovelace"
                                          ? "ADA amount"
                                          : "Token amount"
                                      }
                                      min="1"
                                      step={
                                        asset.unit === "lovelace"
                                          ? "0.000001"
                                          : "1"
                                      }
                                      required={includeAction}
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      removeAssetFromTarget(
                                        targetIndex,
                                        assetIndex
                                      )
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}

                              {target.assets.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                  Click &quot;Add Asset&quot; to specify what to
                                  send to this recipient
                                </p>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Registration Info */}
            {registrationStatus && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <p className="font-medium">Registered to Vote</p>
                    <p className="text-sm">
                      You have{" "}
                      {registrationStatus.lockedGovernanceTokens?.toLocaleString()}{" "}
                      governance tokens locked
                      {daoInfo &&
                        registrationStatus.lockedGovernanceTokens &&
                        registrationStatus.lockedGovernanceTokens >=
                          daoInfo.minGovProposalCreate && (
                          <span className="text-green-600">
                            {" "}
                            ✓ Sufficient for proposal creation
                          </span>
                        )}
                    </p>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-between pt-4">
              <Button type="button" variant="outline" asChild>
                <Link href={`/dao?policyId=${policyId}&assetName=${assetName}`}>
                  Cancel
                </Link>
              </Button>

              <Button
                type="submit"
                disabled={
                  creationState !== "idle" ||
                  !connected ||
                  !registrationStatus?.isRegistered ||
                  (registrationStatus?.lockedGovernanceTokens ?? 0) <
                    (daoInfo?.minGovProposalCreate ?? 0)
                }
                className="min-w-[150px]"
              >
                {creationState !== "idle" ? (
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
                Please connect your wallet to create proposals
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const formatDateTimeLocal = (date: Date | null): string => {
  if (!date) return "";

  // Get local timezone offset and adjust
  const offset = date.getTimezoneOffset() * 60000;
  const localDate = new Date(date.getTime() - offset);
  return localDate.toISOString().slice(0, 16);
};

const parseDateTimeLocal = (dateTimeString: string): Date | null => {
  if (!dateTimeString) return null;
  // This creates a Date in the user's local timezone
  return new Date(dateTimeString);
};
