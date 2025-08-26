import { DaoProviderWrapper } from "@/components/dao/dao-provider-wrapper";
import { DaoBreadcrumb } from "@/components/dao/breadcrumb";
import { ReactNode, Suspense } from "react";

export default function DaoLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DaoProviderWrapper>
        <div className="container mx-auto">
          <DaoBreadcrumb />
          {children}
        </div>
      </DaoProviderWrapper>
    </Suspense>
  );
}
