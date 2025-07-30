"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
} from "react";

export interface DAOInfo {
  policyId: string;
  name: string;
  governanceToken: string;
  threshold: number;
  minProposalTime: number;
  maxProposalTime: number;
  quorum: number;
  minGovProposalCreate: number;
  whitelistedProposals: string[];
  whitelistedActions: string[];
  deploymentTx: string;
  address: string;
  network: string;
  createdAt: string;
}

export interface ProposalStatus {
  type: "FailedQuorum" | "FailedThreshold" | "Passing";
  message: string;
  winningOption?: number;
  quorumProgress: number;
  thresholdProgress: number;
}

interface DaoContextType {
  daoInfo: DAOInfo | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateDaoInfo: (updates: Partial<DAOInfo>) => void;
  clearError: () => void;
  // Calculation methods
  canEvaluateProposal: (status: string, endTime: number) => boolean;
}

const DaoContext = createContext<DaoContextType | null>(null);

interface DaoProviderProps {
  children: ReactNode;
  daoPolicyId?: string;
  daoKey?: string;
}

export function DaoProvider({
  children,
  daoPolicyId,
  daoKey,
}: DaoProviderProps) {
  const [daoInfo, setDaoInfo] = useState<DAOInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentDaoKey, setCurrentDaoKey] = useState<string>("");

  const fetchDaoInfo = useCallback(async () => {
    if (!daoPolicyId || !daoKey) {
      setError("Missing DAO parameters");
      setIsLoading(false);
      return;
    }

    const daoIdentifier = `${daoPolicyId}-${daoKey}`;

    if (currentDaoKey !== daoIdentifier) {
      setDaoInfo(null);
      setError(null);
      setCurrentDaoKey(daoIdentifier);
    }

    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(
        `/api/dao/info?policyId=${encodeURIComponent(
          daoPolicyId
        )}&assetName=${encodeURIComponent(daoKey)}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch DAO info");
      }
      const data = await response.json();
      setDaoInfo(data);
    } catch (err) {
      console.error("Error fetching DAO info:", err);
      setError(err instanceof Error ? err.message : "Failed to load DAO info");
      setDaoInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, [daoPolicyId, daoKey, currentDaoKey]);

  useEffect(() => {
    fetchDaoInfo();
  }, [fetchDaoInfo]);

  const refetch = useCallback(async () => {
    await fetchDaoInfo();
  }, [fetchDaoInfo]);

  const updateDaoInfo = useCallback((updates: Partial<DAOInfo>) => {
    setDaoInfo((current) => (current ? { ...current, ...updates } : null));
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const canEvaluateProposal = useCallback(
    (status: string, endTime: number): boolean => {
      // If status is already "ReadyForEvaluation", it needs evaluation
      if (status === "ReadyForEvaluation") return true;

      // For "Active" status, check if time has ended
      const hasEnded = Date.now() > endTime;
      return status === "Active" && hasEnded;
    },
    []
  );

  const value: DaoContextType = {
    daoInfo,
    isLoading,
    error,
    refetch,
    updateDaoInfo,
    clearError,
    canEvaluateProposal,
  };

  return <DaoContext.Provider value={value}>{children}</DaoContext.Provider>;
}

export function useDaoContext() {
  const context = useContext(DaoContext);
  if (!context) {
    throw new Error("useDaoContext must be used within a DaoProvider");
  }
  return context;
}
