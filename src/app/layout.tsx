import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { PwaGuard } from "@/components/pwa-guard";
import { ThemeScript } from "@/components/theme-script";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600", "700", "800"] });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", weight: ["600", "700"] });

export const metadata: Metadata = {
  title: "Coperto · Gestione sala e prenotazioni",
  description: "Tavoli in tempo reale, prenotazioni telefoniche e walk-in. Veloce come la carta.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Coperto" },
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F1E8" },
    { media: "(prefers-color-scheme: dark)", color: "#14110C" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it" className={`${inter.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="bg-bg text-ink font-sans antialiased min-h-dvh">
        <PwaGuard />
        {children}
      </body>
    </html>
  );
}
