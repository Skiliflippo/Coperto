import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { PwaGuard } from "@/components/pwa-guard";

// Local-First fonts: system fonts for 120 FPS, no build-time Google fetch
// Google Fonts caricati via <link> client-side se online, fallback sistema se offline/PWA
// Questo evita build error offline e mantiene login iOS intatto

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
    <html lang="it" suppressHydrationWarning>
      <head>
        {/* Preconnect per font, ma non blocca build - client-side */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg text-ink font-sans antialiased min-h-dvh">
        <PwaGuard />
        {children}
      </body>
    </html>
  );
}
