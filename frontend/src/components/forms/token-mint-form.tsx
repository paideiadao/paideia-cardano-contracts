"use client";

import { useState } from "react";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Info } from "lucide-react";

export interface TokenFormData {
  name: string;
  symbol: string;
  description: string;
  supply: number;
  decimals: number;
  url: string;
  logo: string;
}

export function TokenMintForm() {
  const { wallet, connected } = useWallet();
  const [formData, setFormData] = useState<TokenFormData>({
    name: "",
    symbol: "",
    description: "",
    supply: 1000000,
    decimals: 6,
    url: "",
    logo: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleInputChange = (
    field: keyof TokenFormData,
    value: string | number
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !wallet) {
      setError("Please connect your wallet first");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      console.log("=== Starting CIP-68 Token Mint ===");

      const usedAddresses = await wallet.getUsedAddresses();
      const address = usedAddresses[0];
      const utxos = await wallet.getUtxos();
      const collateral = await wallet.getCollateral();
      const changeAddress = await wallet.getChangeAddress();

      if (!utxos?.length) {
        throw new Error("No UTXOs available");
      }
      if (!collateral?.length) {
        throw new Error("No collateral available");
      }

      console.log("✓ Wallet data obtained");

      const response = await fetch("/api/tokens/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formData,
          walletAddress: address,
          collateral,
          changeAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error ?? "Failed to build transaction");
      }

      const { unsignedTx, tokenInfo } = await response.json();

      console.log("Transaction built on server, signing...");
      const signedTx = await wallet.signTx(unsignedTx, true);

      console.log("Submitting transaction...");
      const txHash = await wallet.submitTx(signedTx);

      console.log("✓ Transaction submitted:", txHash);
      console.log("✓ Token info:", tokenInfo);
      setSuccess(
        `CIP-68 token minted successfully! Transaction hash: ${txHash}`
      );
    } catch (err: any) {
      console.error("❌ Full error object:", JSON.stringify(err, null, 2));
      setError(err instanceof Error ? err.message : "Failed to mint token");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Create Governance Token
            <Info className="h-4 w-4 text-muted-foreground" />
          </CardTitle>
          <CardDescription>
            Create a CIP-68 compliant fungible token for DAO governance with
            immutable metadata
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="mb-6">
            <AccordionItem value="token-info">
              <AccordionTrigger>What tokens will be created?</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="space-y-3">
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-semibold text-blue-700">
                      Governance Token ({formData.symbol || "SYMBOL"})
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Fungible tokens (CIP-68 label 333) used for voting in your
                      DAO. These will be distributed to your community for
                      governance participation.
                    </p>
                  </div>

                  <div className="border-l-4 border-purple-500 pl-4">
                    <h4 className="font-semibold text-purple-700">
                      Minting Authority (AUTH_{formData.symbol || "SYMBOL"})
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Authority NFT (CIP-68 label 222) that allows future
                      minting of governance tokens. Keep this secure - it
                      controls the token supply.
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="metadata-info">
              <AccordionTrigger>
                How does CIP-68 metadata work?
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Each token type gets a <strong>reference NFT</strong> that
                  stores its metadata on-chain:
                </p>
                <ul className="text-sm text-muted-foreground space-y-2 ml-4">
                  <li>
                    • <strong>Reference NFTs are burned</strong> - making
                    metadata permanently immutable
                  </li>
                  <li>
                    • <strong>No central server dependency</strong> - metadata
                    lives on Cardano forever
                  </li>
                  <li>
                    • <strong>Governance stability</strong> - token properties
                    cannot be changed mid-vote
                  </li>
                  <li>
                    • <strong>Full CIP-68 compliance</strong> - works with all
                    compatible wallets and dApps
                  </li>
                </ul>

                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded border">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    💡 Future Enhancement: The DAO could vote to update metadata
                    by storing reference NFTs in a governance script instead of
                    burning them.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="supply-info">
              <AccordionTrigger>Can I mint more tokens later?</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Yes! The Authority NFT allows you to mint additional
                  governance tokens:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                  <li>
                    • Hold the AUTH_{formData.symbol || "SYMBOL"} NFT in your
                    wallet
                  </li>
                  <li>• Use it to authorize future minting transactions</li>
                  <li>
                    • Consider multi-sig or DAO-controlled minting for
                    decentralization
                  </li>
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Token Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  placeholder="My DAO Token"
                  required
                />
              </div>
              <div>
                <Label htmlFor="symbol">Symbol (Ticker)</Label>
                <Input
                  id="symbol"
                  value={formData.symbol}
                  onChange={(e) =>
                    handleInputChange("symbol", e.target.value.toUpperCase())
                  }
                  placeholder="MYDAO"
                  maxLength={8}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  handleInputChange("description", e.target.value)
                }
                placeholder="Governance token for My DAO"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="supply">Initial Supply</Label>
                <Input
                  id="supply"
                  type="number"
                  value={formData.supply}
                  onChange={(e) =>
                    handleInputChange("supply", parseInt(e.target.value) || 0)
                  }
                  min={1}
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Can mint more later with authority NFT
                </p>
              </div>
              <div>
                <Label htmlFor="decimals">Decimals</Label>
                <Input
                  id="decimals"
                  type="number"
                  value={formData.decimals}
                  onChange={(e) =>
                    handleInputChange("decimals", parseInt(e.target.value) || 0)
                  }
                  min={0}
                  max={18}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="url">Project URL (Optional)</Label>
              <Input
                id="url"
                type="url"
                value={formData.url}
                onChange={(e) => handleInputChange("url", e.target.value)}
                placeholder="https://mydao.org"
              />
            </div>

            <div>
              <Label htmlFor="logo">Logo URL (Optional)</Label>
              <Input
                id="logo"
                type="url"
                value={formData.logo}
                onChange={(e) => handleInputChange("logo", e.target.value)}
                placeholder="https://mydao.org/logo.png or ipfs://..."
              />
              <p className="text-xs text-muted-foreground mt-1">
                Supports HTTPS and IPFS URLs
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={!connected || isLoading}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating CIP-68 Tokens...
                </>
              ) : (
                "Create Governance Token & Authority NFT"
              )}
            </Button>

            {!connected && (
              <p className="text-sm text-muted-foreground text-center">
                Please connect your wallet to mint tokens
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
