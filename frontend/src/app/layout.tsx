import type { Metadata } from "next";
import { Inter, Viga } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppBar } from "@/components/app-bar";

const inter = Inter({ subsets: ["latin"] });
const viga = Viga({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-viga",
});

export const metadata: Metadata = {
  title: "Paideia DAO",
  description: "Decentralized governance on Cardano",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} ${viga.variable}`}>
        <Providers>
          <div className="min-h-screen bg-background">
            <AppBar />
            <main className="container mx-auto px-4 py-8">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
