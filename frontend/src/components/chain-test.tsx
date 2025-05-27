"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ChainTest() {
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const testConnection = async () => {
    setLoading(true);
    setStatus("Testing connection...");

    try {
      const response = await fetch("/api/test-connection");
      const data = await response.json();

      if (data.success) {
        setStatus(
          `✅ Connection successful! Found ${data.utxoCount} UTXOs at test address`
        );
      } else {
        setStatus(`❌ Connection failed: ${data.error}`);
      }
    } catch (error) {
      setStatus(
        `❌ Connection failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chain Connection Test</CardTitle>
        <CardDescription>
          Test the Blaze + Maestro connection to preview testnet
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={testConnection} disabled={loading} className="w-full">
          {loading ? "Testing..." : "Test Connection"}
        </Button>
        {status && (
          <div className="p-3 bg-muted rounded-md text-sm font-mono">
            {status}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
