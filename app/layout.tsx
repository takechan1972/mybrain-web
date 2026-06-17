import type { Metadata, Viewport } from 'next';
import BottomTabs from '@/components/BottomTabs';
import MainShell from '@/components/MainShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'MyBrain',
  description: 'メモ・予定・AIアシストを一元管理するパーソナルアシスタント',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'MyBrain',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

// スマホ表示最優先
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#F7F8FC]">
          <MainShell>{children}</MainShell>
          <BottomTabs />
        </div>
      </body>
    </html>
  );
}
