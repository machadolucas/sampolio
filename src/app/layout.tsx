import type { Metadata } from "next";
import { Bodoni_Moda, Quicksand } from "next/font/google";
import { PrimeProvider } from "@/components/providers/prime-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import "./globals.css";

const bodoniModa = Bodoni_Moda({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

const quicksand = Quicksand({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
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
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${bodoniModa.variable} ${quicksand.variable} antialiased`}
      >
        <ThemeProvider>
          <PrimeProvider>
            {children}
          </PrimeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
