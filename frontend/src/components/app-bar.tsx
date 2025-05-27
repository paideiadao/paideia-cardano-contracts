import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { WalletConnect } from "./wallet-connect";

export function AppBar() {
  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Logo className="text-primary" />
          <h1 className="text-2xl font-viga">PAIDEIA</h1>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <WalletConnect />
        </div>
      </div>
    </header>
  );
}
