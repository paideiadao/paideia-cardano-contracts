"use client";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface CopyButtonProps {
  textToCopy: string;
  children: React.ReactNode;
  popoverMessage?: string;
  popoverDuration?: number;
  className?: string;
}

export function CopyButton({
  textToCopy,
  children,
  popoverMessage = "Copied to clipboard",
  popoverDuration = 1000,
  className,
}: CopyButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(textToCopy);
    setIsOpen(true);
    setTimeout(() => {
      setIsOpen(false);
    }, popoverDuration);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild onClick={handleCopy} className={className}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        className="w-fit px-3 py-2"
        side="top"
        align="center"
        sideOffset={5}
        avoidCollisions={true}
      >
        {popoverMessage}
      </PopoverContent>
    </Popover>
  );
}
