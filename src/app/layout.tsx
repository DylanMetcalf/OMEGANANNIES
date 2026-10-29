import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { Hydrated } from "@/components/hydrated";
import { PwaRegister } from "@/components/pwa";
import { Toaster } from "@/components/toaster";

// next/font downloads these at build time and serves them from our own origin (no runtime Google requests).
const manrope = Manrope({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-manrope", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Omega Nannies Portal", template: "%s · Omega Nannies" },
  description: "Secure portal for Omega Nannies families, nannies and team.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Omega Nannies", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#172038", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" className={`${manrope.variable} ${inter.variable}`}>
      <body>{children}<Hydrated /><PwaRegister /><Toaster /></body>
    </html>
  );
}
