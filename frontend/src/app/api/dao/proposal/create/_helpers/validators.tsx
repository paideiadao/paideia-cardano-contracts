import { Core } from "@blaze-cardano/sdk";
import { ActionData, ProposalData } from "../route";
import { FullDAODatum } from "@/lib/server/helpers/dao-helpers";

export function validateProposalData(proposal: ProposalData): void {
  if (!proposal.name?.trim()) {
    throw new Error("Proposal name is required");
  }
  if (proposal.name.length > 100) {
    throw new Error("Proposal name must be 100 characters or less");
  }
  if (!proposal.description?.trim()) {
    throw new Error("Proposal description is required");
  }
  if (proposal.description.length > 2000) {
    throw new Error("Proposal description must be 2000 characters or less");
  }
  if (!proposal.startTime) {
    throw new Error("Proposal start time is required");
  }
  if (!proposal.endTime) {
    throw new Error("Proposal end time is required");
  }
}

export function validateActionData(action: ActionData): void {
  if (!action.name?.trim()) {
    throw new Error("Action name is required");
  }
  if (!action.description?.trim()) {
    throw new Error("Action description is required");
  }
  if (!action.targets?.length) {
    throw new Error("At least one recipient is required for treasury actions");
  }

  for (const target of action.targets) {
    if (!target.address?.trim()) {
      throw new Error("Recipient address is required");
    }
    try {
      Core.addressFromBech32(target.address);
    } catch {
      throw new Error(`Invalid Cardano address: ${target.address}`);
    }
    if (!target.assets?.length) {
      throw new Error("At least one asset must be specified per recipient");
    }
    for (const asset of target.assets) {
      if (!asset.quantity || parseInt(asset.quantity) <= 0) {
        throw new Error("Asset quantity must be greater than 0");
      }
    }
  }
}

export async function validateProposalTiming(
  proposal: ProposalData,
  daoInfo: FullDAODatum
): Promise<void> {
  const startTime = new Date();
  const endTime = new Date(proposal.endTime);
  const now = new Date();

  if (endTime <= startTime) {
    throw new Error("Proposal end time must be after start time");
  }

  // Duration validation in seconds
  const durationSeconds = Math.floor(
    (endTime.getTime() - startTime.getTime()) / 1000
  );

  if (durationSeconds < daoInfo.min_proposal_time / 1000) {
    throw new Error(
      `Proposal must run for at least ${Math.floor(
        daoInfo.min_proposal_time / 60
      )} minutes`
    );
  }

  if (durationSeconds > daoInfo.max_proposal_time) {
    throw new Error(
      `Proposal cannot run longer than ${Math.floor(
        daoInfo.max_proposal_time / 60
      )} minutes`
    );
  }

  const maxStartTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (startTime > maxStartTime) {
    throw new Error(
      "Proposal start time cannot be more than 7 days in the future"
    );
  }
}

export async function validateActionTiming(
  activationTimeStr: string,
  proposal: ProposalData
): Promise<void> {
  const activationTime = new Date(activationTimeStr);
  const endTime = new Date(proposal.endTime);

  if (activationTime <= endTime) {
    throw new Error("Action activation time must be after proposal end time");
  }

  const minActivationTime = new Date(endTime.getTime() + 60 * 1000);
  if (activationTime < minActivationTime) {
    throw new Error(
      "Action activation time must be at least 1 minute after proposal end time"
    );
  }
}
