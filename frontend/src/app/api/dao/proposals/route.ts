import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import { blazeMaestroProvider } from "@/lib/server/blaze";
import { cborToScript } from "@blaze-cardano/uplc";
import plutusJson from "@/lib/scripts/plutus.json";
import {
  addressFromScript,
  createParameterizedScript,
  getScriptPolicyId,
} from "@/lib/server/helpers/script-helpers";

export interface ProposalInfo {
  policyId: string;
  assetName: string;
  name: string;
  description: string;
  tally: number[];
  endTime: number;
  status: "Active" | "FailedThreshold" | "FailedQuorum" | "Passed";
  winningOption?: number;
  identifier: {
    txHash: string;
    outputIndex: number;
  };
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
  totalVotes: number;
  createdAt?: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const daoPolicyId = searchParams.get("daoPolicyId");
    const daoKey = searchParams.get("daoKey");

    if (!daoPolicyId || !daoKey) {
      return NextResponse.json(
        { error: "daoPolicyId and daoKey are required" },
        { status: 400 }
      );
    }

    // Get proposal script address
    const proposalValidator = plutusJson.validators.find(
      (v) => v.title === "proposal.proposal.spend"
    );

    if (!proposalValidator) {
      throw new Error("Proposal validator not found");
    }

    const votePolicyId = getScriptPolicyId("vote.vote.mint", [
      daoPolicyId,
      daoKey,
    ]);

    const proposalScript = createParameterizedScript(
      "proposal.proposal.spend",
      [daoPolicyId, daoKey, votePolicyId]
    );
    const proposalScriptAddress = addressFromScript(proposalScript);

    // Get all proposal UTXOs
    const utxos = await blazeMaestroProvider.getUnspentOutputs(
      proposalScriptAddress
    );

    const proposals: ProposalInfo[] = [];

    for (const utxo of utxos) {
      try {
        const value = utxo.output().amount().toCore();
        if (!value.assets) continue;

        // Find proposal NFT (quantity = 1)
        let proposalPolicyId = "";
        let proposalAssetName = "";

        for (const [assetId, quantity] of value.assets) {
          if (quantity === 1n) {
            proposalPolicyId = Core.AssetId.getPolicyId(assetId);
            proposalAssetName = Core.AssetId.getAssetName(assetId);
            break;
          }
        }

        if (!proposalPolicyId || !proposalAssetName) continue;

        const datum = utxo.output().datum()?.asInlineData();
        if (!datum) continue;

        const proposalData = parseProposalDatum(datum);
        if (!proposalData) continue;

        const totalVotes = proposalData.tally.reduce(
          (sum, votes) => sum + votes,
          0
        );

        proposals.push({
          policyId: proposalPolicyId,
          assetName: proposalAssetName,
          name: proposalData.name,
          description: proposalData.description,
          tally: proposalData.tally,
          endTime: proposalData.end_time,
          status: proposalData.status,
          winningOption:
            proposalData.status === "Passed"
              ? proposalData.winning_option
              : undefined,
          identifier: proposalData.identifier,
          utxoRef: {
            txHash: utxo.input().transactionId(),
            outputIndex: Number(utxo.input().index()),
          },
          totalVotes,
        });
      } catch (error) {
        console.error("Error processing proposal UTXO:", error);
        continue;
      }
    }

    // Sort by end time (newest first)
    proposals.sort((a, b) => b.endTime - a.endTime);

    return NextResponse.json({
      proposals,
      count: proposals.length,
    });
  } catch (error) {
    console.error("Error fetching proposals:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch proposals",
      },
      { status: 500 }
    );
  }
}

function parseProposalDatum(datum: Core.PlutusData): {
  name: string;
  description: string;
  tally: number[];
  end_time: number;
  status: "Active" | "FailedThreshold" | "FailedQuorum" | "Passed";
  winning_option?: number;
  identifier: {
    txHash: string;
    outputIndex: number;
  };
} | null {
  try {
    const constr = datum.asConstrPlutusData();
    if (!constr || constr.getAlternative() !== 0n) return null;

    const fields = constr.getData();
    if (fields.getLength() < 6) return null;

    // Parse fields
    const name = new TextDecoder().decode(
      fields.get(0).asBoundedBytes() ?? new Uint8Array()
    );

    const description = new TextDecoder().decode(
      fields.get(1).asBoundedBytes() ?? new Uint8Array()
    );

    const tallyList = fields.get(2).asList();
    const tally: number[] = [];
    if (tallyList) {
      for (let i = 0; i < tallyList.getLength(); i++) {
        tally.push(Number(tallyList.get(i).asInteger() ?? 0n));
      }
    }

    const end_time = Number(fields.get(3).asInteger() ?? 0n);

    const statusConstr = fields.get(4).asConstrPlutusData();
    let status: "Active" | "FailedThreshold" | "FailedQuorum" | "Passed" =
      "Active";
    let winning_option: number | undefined;

    if (statusConstr) {
      const statusAlt = Number(statusConstr.getAlternative());
      switch (statusAlt) {
        case 0:
          status = "Active";
          break;
        case 1:
          status = "FailedThreshold";
          break;
        case 2:
          status = "FailedQuorum";
          break;
        case 3:
          status = "Passed";
          const passedFields = statusConstr.getData();
          if (passedFields.getLength() > 0) {
            winning_option = Number(passedFields.get(0).asInteger() ?? 0n);
          }
          break;
      }
    }

    const identifierConstr = fields.get(5).asConstrPlutusData();
    let identifier = { txHash: "", outputIndex: 0 };
    if (identifierConstr) {
      const idFields = identifierConstr.getData();
      if (idFields.getLength() >= 2) {
        const txHashBytes = idFields.get(0).asBoundedBytes();
        const outputIndex = Number(idFields.get(1).asInteger() ?? 0n);

        if (txHashBytes) {
          identifier = {
            txHash: Core.toHex(txHashBytes),
            outputIndex,
          };
        }
      }
    }

    return {
      name,
      description,
      tally,
      end_time,
      status,
      winning_option,
      identifier,
    };
  } catch (error) {
    console.error("Error parsing proposal datum:", error);
    return null;
  }
}
