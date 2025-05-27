import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 16.2578 24"
      className={cn("w-8 h-8", className)}
      fill="currentColor"
    >
      <rect width="3.56138" height="16.1036" rx="0.5" />
      <rect x="12.6965" y="7.89648" width="3.56138" height="16.1036" rx="0.5" />
      <rect x="6.34839" width="3.56138" height="9.75509" rx="0.5" />
      <rect x="6.34839" y="14.2446" width="3.56138" height="9.75509" rx="0.5" />
    </svg>
  );
}
