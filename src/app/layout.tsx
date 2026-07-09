import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import "./globals.css";
import ConsoleSilencer from "@/components/ConsoleSilencer";
import PWARegister from "@/components/PWARegister";
import AppInstallPrompt from "@/components/AppInstallPrompt";
import NotificationInitializer from "@/components/NotificationInitializer";
import RealtimeNotifications from "@/components/RealtimeNotifications";
import GlobalAlert from "@/components/GlobalAlert";
import { AppDataProvider } from "@/contexts/AppDataContext";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const activeClubId = cookieStore.get('active_club_id')?.value;
  
  let title = "배드민턴";
  if (activeClubId) {
    try {
      const supabase = await getSupabaseServerClient();
      const { data } = await (supabase as any).from('clubs').select('name').eq('id', activeClubId).single();
      if (data?.name) {
        title = data.name;
      }
    } catch (e) {
      // ignore
    }
  }

  return {
    title,
    description: "참가자들로 경기를 자동으로 생성합니다.",
    applicationName: title,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: title,
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
}

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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                window.deferredPrompt = e;
              });
            `,
          }}
        />
      </head>
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
