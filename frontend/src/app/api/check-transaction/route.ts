import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { txHash } = await request.json();

    // Use Maestro's REST API directly
    const response = await fetch(
      `https://${process.env.NETWORK}.gomaestro-api.org/v1/transactions/${txHash}`,
      {
        headers: {
          "api-key": process.env.MAESTRO_API_KEY!,
        },
      }
    );

    return NextResponse.json({
      confirmed: response.ok,
      blockHeight: response.ok ? (await response.json()).block?.height : null,
    });
  } catch (error) {
    return NextResponse.json({ confirmed: false });
  }
}
