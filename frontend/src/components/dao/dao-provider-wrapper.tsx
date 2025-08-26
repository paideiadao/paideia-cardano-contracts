"use client";

import { useSearchParams } from "next/navigation";
import { DaoProvider } from "@/contexts/dao-context";
import { ReactNode } from "react";

export function DaoProviderWrapper({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const daoPolicyId = searchParams.get("daoPolicyId") ?? "";
  const daoKey = searchParams.get("daoKey") ?? "";

  return (
    <DaoProvider daoPolicyId={daoPolicyId} daoKey={daoKey}>
      {children}
    </DaoProvider>
  );
}
