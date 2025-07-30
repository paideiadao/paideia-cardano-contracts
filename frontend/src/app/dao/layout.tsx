import { DaoProviderWrapper } from "@/components/dao/dao-provider-wrapper";
import { ReactNode } from "react";

export default function DaoLayout({ children }: { children: ReactNode }) {
  return <DaoProviderWrapper>{children}</DaoProviderWrapper>;
}
