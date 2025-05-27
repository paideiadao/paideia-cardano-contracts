import { maestroProvider, Core } from "@/lib/server/blaze";

export async function GET() {
  try {
    const testAddress = Core.addressFromBech32(
      "addr_test1qpvx0sacufuypa2k4sngk7q40zc5c4npl337uusdh64kv0uafhxhu32dys6pvn6wlw8dav6cmp4pmtv7cc3yel9uu0nq93swx9"
    );

    const utxos = await maestroProvider.getUnspentOutputs(testAddress);

    return Response.json({
      success: true,
      utxoCount: utxos.length,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
