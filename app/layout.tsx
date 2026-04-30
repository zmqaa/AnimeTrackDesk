import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
import SidebarLayout from "@/components/SidebarLayout";
import { Providers } from "@/components/Providers";
import RouteLoadingBar from "@/components/shared/RouteLoadingBar";
import Toast from "@/components/shared/Toast";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import { DEFAULT_THEME, themeInitScript } from "@/lib/theme";

const sans = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "700"],
  display: "swap",
});

const serif = Noto_Serif_SC({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Anime Track",
  description: "专注于番剧记录、进度管理和观看历史的动漫追番工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <body className={`${sans.variable} ${serif.variable} ${mono.variable} antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Providers>
          <Toast />
          <RouteLoadingBar />
          <SidebarLayout>
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </SidebarLayout>
        </Providers>
      </body>
    </html>
  );
}

