import { NextRequest, NextResponse } from "next/server";
import { Core } from "@blaze-cardano/sdk";
import {
  createParameterizedScript,
  addressFromScript,
  getUTXOsWithFallback,
  getScriptPolicyId,
} from "@/lib/server/helpers/script-helpers";
import {
  parseProposalDatum,
  parseActionDatum,
} from "@/lib/server/helpers/proposal-helpers";
import { fetchDAOInfo } from "@/lib/server/helpers/dao-helpers";
import { findUTXOWithAsset } from "@/lib/server/helpers/utxo-helpers";

interface ActionDetailsRequest {
  daoPolicyId: string;
  daoKey: string;
  proposalPolicyId: string;
  proposalAssetName: string;
  actionIndex: number;
}

function getActionIdentifier(
  proposalPolicyId: string,
  proposalIdentifier: string,
  actionIndex: number
): string {
  const actionIdentifierData = Core.PlutusData.newConstrPlutusData(
    new Core.ConstrPlutusData(
      0n,
      (() => {
        const list = new Core.PlutusList();
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalPolicyId)));
        list.add(Core.PlutusData.newBytes(Core.fromHex(proposalIdentifier)));
        list.add(Core.PlutusData.newInteger(BigInt(actionIndex)));
        return list;
      })()
    )
  );

  return Core.blake2b_256(actionIdentifierData.toCbor());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      daoPolicyId,
      daoKey,
      proposalPolicyId,
      proposalAssetName,
      actionIndex,
    } = body as ActionDetailsRequest;

    if (
      !daoPolicyId?.trim() ||
      !daoKey?.trim() ||
      !proposalPolicyId?.trim() ||
      !proposalAssetName?.trim() ||
      actionIndex === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required parameters: daoPolicyId, daoKey, proposalPolicyId, proposalAssetName, and actionIndex are all required",
        },
        { status: 400 }
      );
    }

    const daoInfo = await fetchDAOInfo(daoPolicyId, daoKey);

    const actionScript = createParameterizedScript(
      "action_send_funds.action_send_funds.spend",
      [daoPolicyId, daoKey]
    );
    const actionPolicyId = actionScript.hash();

    const actionAssetName = getActionIdentifier(
      proposalPolicyId,
      proposalAssetName,
      actionIndex
    );

    const actionAddress = addressFromScript(actionScript);
    const actionUtxos = await getUTXOsWithFallback(actionAddress);

    const actionUtxo = findUTXOWithAsset(
      actionUtxos,
      actionPolicyId,
      actionAssetName,
      1n
    );

    if (!actionUtxo) {
      return NextResponse.json(
        { error: "Action UTXO not found or already executed" },
        { status: 404 }
      );
    }

    const actionDatum = actionUtxo.output().datum()?.asInlineData();
    if (!actionDatum) {
      return NextResponse.json(
        { error: "Action UTXO missing inline datum" },
        { status: 400 }
      );
    }

    const parsedAction = parseActionDatum(actionDatum);
    if (!parsedAction) {
      return NextResponse.json(
        { error: "Invalid action datum" },
        { status: 400 }
      );
    }

    const votePolicyId = getScriptPolicyId("vote.vote.mint", [
      daoPolicyId,
      daoKey,
    ]);

    const proposalScript = createParameterizedScript(
      "proposal.proposal.spend",
      [daoPolicyId, daoKey, votePolicyId]
    );
    const proposalAddress = addressFromScript(proposalScript);
    const proposalUtxos = await getUTXOsWithFallback(proposalAddress);

    const proposalUtxo = findUTXOWithAsset(
      proposalUtxos,
      proposalPolicyId,
      proposalAssetName,
      1n
    );

    let proposalInfo = null;
    if (proposalUtxo) {
      const proposalDatum = proposalUtxo.output().datum()?.asInlineData();
      if (proposalDatum) {
        const parsedProposal = parseProposalDatum(proposalDatum, daoInfo);
        if (parsedProposal) {
          proposalInfo = {
            name: parsedProposal.name,
            description: parsedProposal.description,
            status: parsedProposal.status,
            winningOption: parsedProposal.winningOption,
            endTime: parsedProposal.endTime,
          };
        }
      }
    }

    let actionStatus: "pending" | "ready" | "executed" = "pending";

    if (proposalInfo?.status === "Passed") {
      actionStatus = "ready";
    }

    return NextResponse.json({
      action: {
        name: parsedAction.name,
        description: parsedAction.description,
        activationTime: parsedAction.activationTime ?? null,
        proposalPolicyId: parsedAction.actionIdentifier.proposal_policy_id,
        proposalIdentifier: parsedAction.actionIdentifier.proposal_identifier,
        option: parsedAction.option ?? null,
        targets: parsedAction.targets,
        treasuryAddress: parsedAction.treasuryAddress ?? null,
        status: actionStatus,
      },
      proposal: proposalInfo,
    });
  } catch (error) {
    console.error("Error fetching action details:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch action details",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
