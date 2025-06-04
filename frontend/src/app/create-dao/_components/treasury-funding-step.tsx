"use client";

import { useState, useEffect } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Copy,
  ExternalLink,
  Loader2,
  Wallet,
  Info,
  CheckCircle,
} from "lucide-react";
import { useDAOCreationStore } from "@/lib/stores/dao-creation-store";
import { Transaction, BrowserWallet } from "@meshsdk/core";
import { getExplorerUrl } from "@/lib/utils";

interface TreasuryAsset {
  unit: string;
  quantity: string;
  metadata?: {
    name?: string;
    ticker?: string;
    decimals?: number;
  };
}

interface TreasuryFundingStepProps {
  onComplete: () => void;
}

export function TreasuryFundingStep({ onComplete }: TreasuryFundingStepProps) {
  const { wallet, connected } = useWallet();
  const { daoPolicyId, daoAssetName } = useDAOCreationStore();

  const [treasuryAddress, setTreasuryAddress] = useState<string>("");
  const [treasuryAssets, setTreasuryAssets] = useState<TreasuryAsset[]>([]);
  const [adaAmount, setAdaAmount] = useState<string>("100");
  const [isLoading, setIsLoading] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string>("");

  useEffect(() => {
    loadTreasuryInfo();
  }, [daoPolicyId]);

  const loadTreasuryInfo = async () => {
    if (!daoPolicyId || !daoAssetName) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/dao/treasury/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId,
          daoKey: daoAssetName,
        }),
      });

      if (!response.ok) throw new Error("Failed to load treasury info");

      const { address, assets, network } = await response.json();
      setTreasuryAddress(address);
      setTreasuryAssets(assets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load treasury");
    } finally {
      setIsLoading(false);
    }
  };

  const copyAddress = async () => {
    if (treasuryAddress) {
      await navigator.clipboard.writeText(treasuryAddress);
    }
  };

  const fundTreasury = async () => {
    if (!connected || !wallet || !treasuryAddress) {
      setError("Wallet not connected or treasury address not available");
      return;
    }

    const adaAmountLovelace = parseFloat(adaAmount) * 1_000_000;
    if (isNaN(adaAmountLovelace) || adaAmountLovelace <= 0) {
      setError("Please enter a valid ADA amount");
      return;
    }

    setIsFunding(true);
    setError(null);

    try {
      const tx = new Transaction({ initiator: wallet as BrowserWallet });

      tx.sendLovelace(treasuryAddress, adaAmountLovelace.toString());

      const unsignedTx = await tx.build();
      const signedTx = await wallet.signTx(unsignedTx);
      const txHash = await wallet.submitTx(signedTx);

      setLastTxHash(txHash);

      // Refresh treasury assets after funding
      setTimeout(() => {
        loadTreasuryInfo();
      }, 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fund treasury");
    } finally {
      setIsFunding(false);
    }
  };

  const formatAssetQuantity = (quantity: string, decimals = 0) => {
    const num = parseInt(quantity);
    if (decimals === 0) return num.toLocaleString();
    return (num / Math.pow(10, decimals)).toLocaleString();
  };

  const getTreasuryAdaBalance = () => {
    const lovelace = treasuryAssets.find((asset) => asset.unit === "lovelace");
    if (!lovelace) return "0";
    return (parseInt(lovelace.quantity) / 1_000_000).toFixed(2);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Fund DAO Treasury
          </CardTitle>
          <CardDescription>
            Send assets to your DAO's treasury. Anyone can fund the treasury by
            sending to this address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Treasury Address */}
          <div className="space-y-3">
            <Label>Treasury Address</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 bg-muted rounded-md font-mono text-sm break-all">
                {treasuryAddress}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={copyAddress}
                className="flex-shrink-0"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(
                    `${getExplorerUrl(`/address/${treasuryAddress}`)}`,
                    "_blank"
                  )
                }
                className="flex-shrink-0"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Current Treasury Holdings */}
          <div className="space-y-3">
            <Label>Current Treasury Holdings</Label>
            <div className="border rounded-lg p-4">
              {treasuryAssets.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  Treasury is currently empty
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">ADA</span>
                    <span className="font-mono">
                      ₳{getTreasuryAdaBalance()}
                    </span>
                  </div>
                  {treasuryAssets
                    .filter((asset) => asset.unit !== "lovelace")
                    .map((asset, index) => (
                      <div
                        key={index}
                        className="flex justify-between items-center text-sm"
                      >
                        <span>
                          {asset.metadata?.name ?? asset.unit.slice(0, 16)}...
                        </span>
                        <span className="font-mono">
                          {formatAssetQuantity(
                            asset.quantity,
                            asset.metadata?.decimals
                          )}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Quick Funding Form */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Quick Fund with ADA</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="adaAmount">Amount (ADA)</Label>
                <Input
                  id="adaAmount"
                  type="number"
                  value={adaAmount}
                  onChange={(e) => setAdaAmount(e.target.value)}
                  placeholder="100"
                  min="1"
                  step="1"
                />
              </div>

              <Button
                onClick={fundTreasury}
                disabled={!connected || isFunding}
                className="w-full"
              >
                {isFunding ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending to Treasury...
                  </>
                ) : (
                  `Send ${adaAmount} ADA to Treasury`
                )}
              </Button>

              {!connected && (
                <p className="text-sm text-muted-foreground text-center">
                  Connect your wallet to fund the treasury
                </p>
              )}
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {lastTxHash && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-medium">Treasury funded successfully!</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
                      {lastTxHash}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(
                          getExplorerUrl(`/transaction/${lastTxHash}`),
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
          )}
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <div className="space-y-2">
            <p className="font-medium">Treasury Funding Notes:</p>
            <ul className="text-sm space-y-1 ml-4">
              <li>• Treasury funding is completely optional</li>
              <li>• Anyone can send assets to this address anytime</li>
              <li>• Only governance proposals can spend from the treasury</li>
              <li>• You can add more funds later through this same address</li>
            </ul>
          </div>
        </AlertDescription>
      </Alert>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => window.history.back()}>
          Back to DAO Summary
        </Button>
        <Button onClick={onComplete}>Complete DAO Setup</Button>
      </div>
    </div>
  );
}
