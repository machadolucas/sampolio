import { ThemeProvider } from '@/components/providers/theme-provider';
import { ServiceWorkerRegister } from '@/components/providers/service-worker-register';
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  applicationName: 'Sampolio',
  title: 'Sampolio - Personal Finance Planner',
  description:
    'A personal finance planning tool that replaces your budgeting spreadsheet with a cleaner, more powerful workflow',
  // Keeps the existing src/app/favicon.ico convention; adds PWA + apple icons.
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      {
        url: '/icons/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: 'Sampolio',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
  // `appleWebApp.capable` already emits the modern `mobile-web-app-capable`.
  // Add the legacy `apple-mobile-web-app-capable` here for older iOS versions.
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Let content extend under the iOS status bar / home indicator so our
  // safe-area-inset padding can position the mobile chrome correctly.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F6F4' },
    { media: '(prefers-color-scheme: dark)', color: '#0F1412' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `var t = null, reduced = null; try { t = localStorage.getItem("sampolio-theme"); reduced = localStorage.getItem("sampolio-reduce-transparency"); } catch (_) {} var d = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.classList.toggle("dark", d); document.documentElement.style.colorScheme = d ? "dark" : "light"; if (reduced === "true" || matchMedia("(prefers-reduced-transparency: reduce)").matches) document.documentElement.setAttribute("data-reduce-transparency", "");`,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
