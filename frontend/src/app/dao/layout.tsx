import { DaoProviderWrapper } from "@/components/dao/dao-provider-wrapper";
import { ReactNode, Suspense } from "react";

export default function DaoLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DaoProviderWrapper>{children}</DaoProviderWrapper>
    </Suspense>
  );
}
