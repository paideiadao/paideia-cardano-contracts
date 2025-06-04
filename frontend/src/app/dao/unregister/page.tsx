"use client";

import { UnregisterAnalysis } from "@/app/api/dao/unregister/analysis/route";
import { useWallet } from "@meshsdk/react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState, useEffect } from "react";

type RegistrationState =
  | "idle"
  | "loading"
  | "analyzing"
  | "building"
  | "signing"
  | "submitting";

export default function UnregisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { wallet, connected } = useWallet();

  const policyId = searchParams.get("policyId");
  const assetName = searchParams.get("assetName");

  const [analysis, setAnalysis] = useState<UnregisterAnalysis | null>(null);
  const [registrationState, setRegistrationState] =
    useState<RegistrationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    txHash: string;
    votePolicyId: string;
    voteNftAssetName: string;
  } | null>(null);

  // Load analysis on component mount
  useEffect(() => {
    loadAnalysis();
  }, [policyId, assetName, connected]);

  const loadAnalysis = async () => {
    try {
      setRegistrationState("analyzing");
      setError(null);

      const usedAddresses = await wallet.getUsedAddresses();
      const address = usedAddresses[0];

      const response = await fetch("/api/dao/unregister/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId: policyId,
          daoKey: assetName,
          walletAddress: address,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error ?? `Analysis failed with status: ${response.status}`
        );
      }

      const analysisData = (await response.json()) as UnregisterAnalysis;
      setAnalysis(analysisData);
      setRegistrationState("idle");
    } catch (error) {
      console.error("Analysis failed:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to load registration status"
      );
      setRegistrationState("idle");
    }
  };

  const handleUnregister = async () => {
    if (!analysis) return;

    const usedAddresses = await wallet.getUsedAddresses();
    const address = usedAddresses[0];
    const collateral = await wallet.getCollateral();
    const changeAddress = await wallet.getChangeAddress();

    try {
      setRegistrationState("building");
      setError(null);

      const response = await fetch("/api/dao/unregister", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daoPolicyId: policyId,
          daoKey: assetName,
          walletAddress: address,
          collateral,
          changeAddress,
          voteUtxoRef: analysis.voteUtxo?.utxo,
          voteNftAssetName: analysis.voteUtxo?.voteNftAssetName,
          referenceAssetName: analysis.voteUtxo?.referenceAssetName,
          endedVoteReceipts: analysis.endedVotes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error ??
            `Failed to build unregister transaction (${response.status})`
        );
      }

      const { unsignedTx, votePolicyId, voteNftAssetName } =
        await response.json();

      setRegistrationState("signing");
      const signedTx = await wallet.signTx(unsignedTx, true);

      setRegistrationState("submitting");
      const txHash = await wallet.submitTx(signedTx);

      setSuccess({
        txHash,
        votePolicyId,
        voteNftAssetName,
      });

      setRegistrationState("idle");

      // Refresh analysis after successful unregistration
      setTimeout(() => loadAnalysis(), 2000);
    } catch (error: any) {
      console.error("Unregistration failed:", error);

      let errorMessage = "An unexpected error occurred";

      if (error?.message?.includes("User declined")) {
        errorMessage = "Transaction was cancelled by user";
      } else if (error?.message?.includes("Insufficient funds")) {
        errorMessage = "Insufficient funds for transaction";
      } else if (
        error instanceof TypeError &&
        error.message.includes("fetch")
      ) {
        errorMessage = "Network error - please check your connection";
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      setError(errorMessage);
      setRegistrationState("idle");
    }
  };

  const renderAnalysisInfo = () => {
    if (!analysis) return null;

    return (
      <div className="space-y-4">
        {/* Registration Status */}
        <div className="p-4 border rounded-lg">
          <h3 className="font-semibold mb-2">Registration Status</h3>
          {analysis.voteUtxo ? (
            <div>
              <p className="text-green-600 mb-2">✓ Currently registered</p>
              <p className="text-sm text-gray-600">
                Locked tokens: {analysis.voteUtxo.lockedGovernanceTokens}
              </p>
              <p className="text-sm text-gray-600">
                Vote NFT: {analysis.voteUtxo.voteNftAssetName}
              </p>
            </div>
          ) : (
            <p className="text-gray-600">Not currently registered</p>
          )}
        </div>

        {/* Active Votes */}
        {analysis.activeVotes.length > 0 && (
          <div className="p-4 border rounded-lg">
            <h3 className="font-semibold mb-2 text-orange-600">
              Active Votes ({analysis.activeVotes.length})
            </h3>
            <p className="text-sm text-gray-600 mb-2">
              You have votes in progress that may prevent unregistration
            </p>
            {analysis.activeVotes.map((vote, index) => (
              <div
                key={index}
                className="text-sm border-l-2 border-orange-200 pl-2 mb-1"
              >
                {vote.proposalName || `Vote ${vote.proposalId}`}
              </div>
            ))}
          </div>
        )}

        {/* Ended Votes */}
        {analysis.endedVotes.length > 0 && (
          <div className="p-4 border rounded-lg">
            <h3 className="font-semibold mb-2">
              Completed Votes ({analysis.endedVotes.length})
            </h3>
            <p className="text-sm text-gray-600">
              These will be processed during unregistration
            </p>
          </div>
        )}

        {/* Blocking Message */}
        {analysis.blockingMessage && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700">{analysis.blockingMessage}</p>
          </div>
        )}
      </div>
    );
  };

  const getButtonText = () => {
    switch (registrationState) {
      case "analyzing":
        return "Loading...";
      case "building":
        return "Building Transaction...";
      case "signing":
        return "Please Sign Transaction...";
      case "submitting":
        return "Submitting Transaction...";
      default:
        return "Unregister";
    }
  };

  if (registrationState === "analyzing") {
    return (
      <div className="p-6 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p>Analyzing registration status...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">DAO Unregistration</h2>
        <button
          onClick={loadAnalysis}
          disabled={registrationState !== "idle"}
          className="text-blue-600 hover:text-blue-800 text-sm"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-red-600 hover:text-red-800 text-sm mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-700 font-semibold">
            ✓ Unregistration successful!
          </p>
          <p className="text-sm text-green-600 mt-1">
            Transaction: {success.txHash.slice(0, 20)}...
          </p>
          <button
            onClick={() => setSuccess(null)}
            className="text-green-600 hover:text-green-800 text-sm mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {analysis && renderAnalysisInfo()}

      {analysis && analysis.voteUtxo && (
        <div className="flex justify-center pt-4">
          <button
            onClick={handleUnregister}
            disabled={!analysis.canUnregister || registrationState !== "idle"}
            className={`px-6 py-3 rounded-lg font-semibold ${
              analysis.canUnregister && registrationState === "idle"
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
            }`}
          >
            {getButtonText()}
          </button>
        </div>
      )}

      {analysis && !analysis.voteUtxo && (
        <div className="text-center p-4 bg-gray-50 rounded-lg">
          <p className="text-gray-600">
            You are not currently registered with this DAO
          </p>
        </div>
      )}
    </div>
  );
}
