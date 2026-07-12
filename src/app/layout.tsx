import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ConsoleSilencer from "@/components/ConsoleSilencer";
import PWARegister from "@/components/PWARegister";
import AppInstallPrompt from "@/components/AppInstallPrompt";
import NotificationInitializer from "@/components/NotificationInitializer";
import RealtimeNotifications from "@/components/RealtimeNotifications";
import GlobalAlert from "@/components/GlobalAlert";
import { AppDataProvider } from "@/contexts/AppDataContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "배드민턴",
    description: "참가자들로 경기를 자동으로 생성합니다.",
    applicationName: "배드민턴",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "배드민턴",
    },
    icons: {
      icon: [
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [
        { url: "/icon-180.png", sizes: "180x180", type: "image/png" },
      ],
      shortcut: ["/icon-192.png"],
    },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${inter.className} bg-gray-50 text-gray-900 antialiased`} suppressHydrationWarning>
        <AppDataProvider>
          <ConsoleSilencer />
          <PWARegister />
          <AppInstallPrompt />
          <NotificationInitializer />
          <RealtimeNotifications />
          <GlobalAlert />
          {children}
        </AppDataProvider>
      </body>
    </html>
  );
}
