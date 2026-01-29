import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PrimeProvider } from "@/components/providers/prime-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sampolio - Personal Finance Planner",
  description: "A personal finance planning tool that replaces your budgeting spreadsheet with a cleaner, more powerful workflow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PrimeProvider>
          {children}
        </PrimeProvider>
      </body>
    </html>
  );
}
