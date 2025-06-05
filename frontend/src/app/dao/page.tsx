"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@meshsdk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  Search,
  ExternalLink,
  Users,
  Clock,
  Coins,
  TrendingUp,
  Calendar,
  Copy,
  Vote,
  Wallet,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { DAOInfo } from "@/app/api/dao/info/route";
import { RegistrationStatus } from "@/app/api/dao/check-registration/route";
import Link from "next/link";
import { getExplorerUrl } from "@/lib/utils";
import { ProposalsSection } from "@/components/dao/proposals-section";

export default function ViewDAOPage() {
  const searchParams = useSearchParams();
  const { wallet, connected } = useWallet();
  const policyId = searchParams.get("policyId");
  const assetName = searchParams.get("assetName");

  const [daoInfo, setDaoInfo] = useState<DAOInfo | null>(null);
  const [registrationStatus, setRegistrationStatus] =
    useState<RegistrationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingRegistration, setIsCheckingRegistration] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  useEffect(() => {
    if (policyId && assetName) {
      fetchDAOInfo();
    } else {
      setError("Missing policyId or assetName parameters");
      setIsLoading(false);
    }
  }, [policyId, assetName]);

  useEffect(() => {
    if (connected && wallet && policyId && assetName) {
      checkRegistrationStatus();
    } else {
      setRegistrationStatus(null);
    }
  }, [connected, wallet, policyId, assetName]);

  const fetchDAOInfo = async () => {
    if (!policyId || !assetName) return;

    setIsLoading(true);
    setError(null);

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
      setIsLoading(false);
    }
  };

  const checkRegistrationStatus = async () => {
    if (!connected || !wallet || !policyId || !assetName) return;

    setIsCheckingRegistration(true);

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

      if (!response.ok) {
        throw new Error("Failed to check registration");
      }

      const status = await response.json();
      setRegistrationStatus(status);
    } catch (err) {
      console.error("Registration check failed:", err);
      setRegistrationStatus({ isRegistered: false });
    } finally {
      setIsCheckingRegistration(false);
    }
  };

  const copyAddress = async (address: string) => {
    await navigator.clipboard.writeText(address);
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  const formatAssetQuantity = (quantity: string, decimals = 0) => {
    const num = parseInt(quantity);
    if (decimals === 0) return num.toLocaleString();
    return (num / Math.pow(10, decimals)).toLocaleString();
  };

  const renderActionButtons = () => {
    if (!connected) {
      return (
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">
            Connect your wallet to participate
          </p>
          <Button variant="outline" disabled>
            Connect Wallet to Continue
          </Button>
        </div>
      );
    }

    if (isCheckingRegistration) {
      return (
        <Button disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Checking Registration...
        </Button>
      );
    }

    if (!registrationStatus) {
      return (
        <Button variant="outline" disabled>
          Unable to Check Registration
        </Button>
      );
    }

    if (!registrationStatus.isRegistered) {
      return (
        <Link
          href={`/dao/register?policyId=${daoInfo?.policyId}&assetName=${assetName}`}
        >
          <Button>
            <Vote className="mr-1 h-4 w-4" />
            Register to Vote
          </Button>
        </Link>
      );
    }

    return (
      <div>
        <div className="flex flex-row gap-2 justify-end">
          <Link
            href={`/dao/unregister?policyId=${daoInfo?.policyId}&assetName=${assetName}`}
          >
            <Button variant="outline">Unregister Tokens</Button>
          </Link>
          <Link
            href={`/dao/create-proposal?policyId=${daoInfo?.policyId}&assetName=${assetName}`}
          >
            <Button>Create Proposal</Button>
          </Link>
        </div>
        {registrationStatus?.lockedGovernanceTokens && (
          <div className="p-3 mt-3 bg-green-50 dark:bg-green-950/30 rounded border">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-800 dark:text-green-200">
                Registered to Vote
              </span>
            </div>
            <p className="text-sm text-green-700 dark:text-green-300">
              {registrationStatus.lockedGovernanceTokens.toLocaleString()}{" "}
              governance tokens locked
            </p>

            {!registrationStatus.voteUtxoExists && (
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Warning: Vote NFT found but vote UTXO is missing. Your
                  registration may be invalid.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading DAO...</span>
        </div>
      </div>
    );
  }

  if (error || !daoInfo) {
    return (
      <div className="max-w-6xl mx-auto">
        <Alert variant="destructive">
          <AlertDescription>{error ?? "DAO not found"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold">{daoInfo.name}</h1>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    window.open(
                      getExplorerUrl(`/transaction/${daoInfo.utxoRef.txHash}`),
                      "_blank"
                    )
                  }
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>{renderActionButtons()}</div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium">Active Proposals</span>
            </div>
            <p className="text-2xl font-bold">
              {daoInfo.stats.activeProposals}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium">Total Proposals</span>
            </div>
            <p className="text-2xl font-bold">{daoInfo.stats.totalProposals}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium">Treasury</span>
            </div>
            <p className="text-2xl font-bold">
              ₳{daoInfo.treasury.totalValueAda}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-medium">Quorum</span>
            </div>
            <p className="text-2xl font-bold">
              {daoInfo.quorum.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="proposals">Proposals</TabsTrigger>
          <TabsTrigger value="treasury">Treasury</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Governance Parameters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Passing Threshold
                    </p>
                    <p className="text-lg font-semibold">
                      {daoInfo.threshold}%
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Quorum</p>
                    <p className="text-lg font-semibold">
                      {daoInfo.quorum.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Min Duration
                    </p>
                    <p className="text-lg font-semibold">
                      {formatDuration(daoInfo.minProposalTime / 1000)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Max Duration
                    </p>
                    <p className="text-lg font-semibold">
                      {formatDuration(daoInfo.maxProposalTime / 1000)}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Min Tokens to Create Proposal
                  </p>
                  <p className="text-lg font-semibold">
                    {daoInfo.minGovProposalCreate.toLocaleString()}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Governance Token</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Policy ID</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm break-all">
                      {daoInfo.governanceToken.policyId}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyAddress(daoInfo.governanceToken.policyId)
                      }
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Asset Name</p>
                  <p className="font-mono text-sm break-all">
                    {daoInfo.governanceToken.assetName}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    window.open(
                      getExplorerUrl(
                        `/token/${daoInfo.governanceToken.fullAssetId}`
                      ),
                      "_blank"
                    )
                  }
                >
                  <ExternalLink className="mr-2 h-3 w-3" />
                  View Token
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="proposals" className="space-y-6">
          <ProposalsSection
            daoPolicyId={daoInfo.policyId}
            daoKey={assetName!}
            isUserRegistered={registrationStatus?.isRegistered ?? false}
          />
        </TabsContent>

        <TabsContent value="treasury" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Treasury Assets</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyAddress(daoInfo.treasury.address)}
                  >
                    <Copy className="mr-2 h-3 w-3" />
                    Copy Address
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(
                        getExplorerUrl(`/address/${daoInfo.treasury.address}`),
                        "_blank"
                      )
                    }
                  >
                    <ExternalLink className="mr-2 h-3 w-3" />
                    View Address
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">
                    Treasury Address
                  </p>
                  <p className="font-mono text-sm break-all">
                    {daoInfo.treasury.address}
                  </p>
                </div>

                {daoInfo.treasury.assets.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      Treasury is currently empty
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {daoInfo.treasury.assets.map((asset, index) => (
                      <div
                        key={index}
                        className="flex justify-between items-center p-3 border rounded-lg"
                      >
                        <div>
                          <p className="font-medium">
                            {asset.unit === "lovelace"
                              ? "ADA"
                              : asset.metadata?.name ??
                                `${asset.unit.slice(0, 8)}...`}
                          </p>
                          {asset.unit !== "lovelace" && (
                            <p className="text-sm text-muted-foreground font-mono">
                              {asset.unit}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-mono">
                            {asset.unit === "lovelace"
                              ? `₳${(
                                  parseInt(asset.quantity) / 1_000_000
                                ).toFixed(2)}`
                              : formatAssetQuantity(
                                  asset.quantity,
                                  asset.metadata?.decimals
                                )}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
