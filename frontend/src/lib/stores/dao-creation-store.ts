import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface GovernanceTokenInfo {
  policyId: string;
  assetName: string;
  decimals: number;
  name: string;
  symbol: string;
  isExisting: boolean;
  txHash?: string; // For newly minted tokens
}

export interface DAOConfig {
  name: string;
  description: string;
  threshold: number; // Percentage needed to pass
  minProposalTime: number; // Minutes
  maxProposalTime: number; // Minutes
  quorum: number; // Minimum votes needed
  minGovProposalCreate: number; // Min tokens needed to create proposal
}

export interface TreasuryFunding {
  initialAda?: number;
  additionalAssets?: Array<{
    policyId: string;
    assetName: string;
    amount: number;
  }>;
}

interface DAOCreationState {
  // Current step (0-indexed)
  currentStep: number;

  // Step data
  governanceToken: GovernanceTokenInfo | null;
  daoConfig: DAOConfig | null;
  treasuryFunding: TreasuryFunding | null;

  // Deploy results
  daoTxHash: string | null;
  daoPolicyId: string | null;
  daoAssetName: string | null;

  // Actions
  setCurrentStep: (step: number) => void;
  setGovernanceToken: (token: GovernanceTokenInfo | null) => void;
  setDAOConfig: (config: DAOConfig) => void;
  setTreasuryFunding: (funding: TreasuryFunding) => void;
  setDeployResults: (
    txHash: string,
    policyId: string,
    assetName: string
  ) => void;

  // Utilities
  canProceedToStep: (step: number) => boolean;
  reset: () => void;
}

const initialState = {
  currentStep: 0,
  governanceToken: null,
  daoConfig: null,
  treasuryFunding: null,
  daoTxHash: null,
  daoPolicyId: null,
  daoAssetName: null,
};

export const useDAOCreationStore = create<DAOCreationState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setCurrentStep: (step) => set({ currentStep: step }),

      setGovernanceToken: (token) => set({ governanceToken: token }),

      setDAOConfig: (config) => set({ daoConfig: config }),

      setTreasuryFunding: (funding) => set({ treasuryFunding: funding }),

      setDeployResults: (txHash, policyId, assetName) =>
        set({
          daoTxHash: txHash,
          daoPolicyId: policyId,
          daoAssetName: assetName,
        }),

      canProceedToStep: (step) => {
        const state = get();
        switch (step) {
          case 0:
            return true; // Can always access step 1
          case 1:
            return state.governanceToken !== null; // Need token for step 2
          case 2:
            return state.governanceToken !== null && state.daoConfig !== null; // Need both for step 3
          case 3:
            return state.daoTxHash !== null; // Need deployed DAO for step 4
          default:
            return false;
        }
      },

      reset: () => set(initialState),
    }),
    {
      name: "dao-creation-storage",
      storage: createJSONStorage(() => localStorage),
      // Only persist the data, not UI state like currentStep
      partialize: (state) => ({
        governanceToken: state.governanceToken,
        daoConfig: state.daoConfig,
        treasuryFunding: state.treasuryFunding,
        daoTxHash: state.daoTxHash,
        daoPolicyId: state.daoPolicyId,
        daoAssetName: state.daoAssetName,
      }),
    }
  )
);
