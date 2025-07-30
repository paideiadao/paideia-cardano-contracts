"use client";

import { useSearchParams } from "next/navigation";
import { DaoProvider } from "@/contexts/dao-context";
import { ReactNode } from "react";

export function DaoProviderWrapper({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const daoPolicyId = searchParams.get("policyId") ?? "";
  const daoKey = searchParams.get("assetName") ?? "";

  return (
    <DaoProvider daoPolicyId={daoPolicyId} daoKey={daoKey}>
      {children}
    </DaoProvider>
  );
}
