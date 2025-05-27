"use client";
import { useState, useEffect } from "react";
import { useWallet, useWalletList } from "@meshsdk/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Wallet, ChevronDown } from "lucide-react";

const WALLET_STORAGE_KEY = "selectedWallet";

export function WalletConnect() {
  const { wallet, connected, connect, disconnect, connecting, name } =
    useWallet();
  const wallets = useWalletList();
  const [mounted, setMounted] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string>("");

  useEffect(() => {
    setMounted(true);

    const storedWallet = localStorage.getItem(WALLET_STORAGE_KEY);
    if (storedWallet && !connected && !connecting) {
      connect(storedWallet);
    }
  }, [connect, connected, connecting]);

  useEffect(() => {
    const getAddress = async () => {
      if (connected && wallet) {
        try {
          const changeAddress = await wallet.getChangeAddress();
          setWalletAddress(changeAddress);
        } catch (error) {
          console.error("Failed to get wallet address:", error);
        }
      } else {
        setWalletAddress("");
      }
    };

    getAddress();
  }, [connected, wallet]);

  const handleConnect = (walletName: string) => {
    localStorage.setItem(WALLET_STORAGE_KEY, walletName);
    connect(walletName);
  };

  const handleDisconnect = () => {
    localStorage.removeItem(WALLET_STORAGE_KEY);
    disconnect();
  };

  const formatAddress = (address: string) => {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getWalletIcon = () => {
    const walletInfo = wallets.find((w) => w.name === name);
    return walletInfo?.icon;
  };

  if (!mounted) {
    return (
      <Button variant="outline" disabled>
        <Wallet className="mr-1 h-4 w-4" />
        Connect Wallet
      </Button>
    );
  }

  if (connected && wallet) {
    const walletIcon = getWalletIcon();

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            {walletIcon ? (
              <img
                src={walletIcon}
                alt={name ?? "Wallet"}
                className="mr-1 h-4 w-4"
              />
            ) : (
              <Wallet className="mr-1 h-4 w-4" />
            )}
            {walletAddress ? formatAddress(walletAddress) : "Loading..."}
            <ChevronDown className="ml-1 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleDisconnect}>
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={connecting}>
          <Wallet className="mr-1 h-4 w-4" />
          {connecting ? "Connecting..." : "Connect Wallet"}
          <ChevronDown className="ml-1 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {wallets.map((walletInfo) => (
          <DropdownMenuItem
            key={walletInfo.name}
            onClick={() => handleConnect(walletInfo.name)}
          >
            <img
              src={walletInfo.icon}
              alt={walletInfo.name}
              className="mr-1 h-4 w-4"
            />
            {walletInfo.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
