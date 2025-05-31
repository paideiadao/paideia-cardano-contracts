import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { maestroProvider } from "@/lib/server/maestro";

export interface MaestroAssetMetadata {
  purpose: string;
  version: number;
  metadata: {
    name: string;
    description?: string;
    ticker?: string;
    decimals?: string;
    logo?: string;
    url?: string;
    [key: string]: any;
  };
  extra?: string;
  fingerprint: string;
  totalSupply: string;
  mintingTxHash: string;
  mintCount: number;
}

export interface TokenValidationResponse {
  exists: boolean;
  policyId: string;
  assetName: string;
  assetInfo?: MaestroAssetMetadata;
  error?: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<TokenValidationResponse>> {
  try {
    const { policyId, assetName } = await request.json();

    if (!policyId || !assetName) {
      return NextResponse.json(
        {
          exists: false,
          policyId: policyId ?? "",
          assetName: assetName ?? "",
          error: "Policy ID and Asset Name are required",
        },
        { status: 400 }
      );
    }

    const assetId = Core.AssetId.fromParts(
      Core.PolicyId(policyId),
      Core.AssetName(assetName)
    );

    try {
      const assetInfo = await maestroProvider.fetchAssetMetadata(assetId);

      return NextResponse.json({
        exists: true,
        policyId,
        assetName,
        assetInfo,
      });
    } catch (assetError) {
      return NextResponse.json({
        exists: false,
        policyId,
        assetName,
        error: "Token not found on-chain",
      });
    }
  } catch (error) {
    console.error("Token validation error:", error);
    return NextResponse.json(
      {
        exists: false,
        policyId: "",
        assetName: "",
        error: error instanceof Error ? error.message : "Validation failed",
      },
      { status: 500 }
    );
  }
}
