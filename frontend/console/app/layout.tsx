import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppFrame } from "../components/AppFrame.tsx";

/* Geist, as on vercel.com. Both are variable fonts, so no weight array —
   the whole 100–900 axis ships in one file and every weight below is free. */
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "AXIS — atomic payments for AI agents",
  description: "N paid API calls · one atomic payment · one receipt. On Algorand.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser extensions inject attributes onto <html>/<body> before React
    // hydrates (ColorZilla's cz-shortcut-listen, Grammarly's data-gr-*). React
    // sees a mismatch it "won't patch up" and can bail out of hydrating — which
    // silently kills every useEffect, and with them the polling that keeps the
    // dashboard live. Suppressing here covers only these two elements' own
    // attributes, not their subtree, so real mismatches still surface.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
