import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { WalletConnect } from "./wallet-connect";
import Link from "next/link";

export function AppBar() {
  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link href="/">
          <div className="flex items-center gap-2">
            <Logo className="text-primary" />
            <h1 className="text-2xl font-viga">PAIDEIA</h1>
          </div>
        </Link>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <WalletConnect />
        </div>
      </div>
    </header>
  );
}
