'use client';

import { usePathname } from 'next/navigation';

// AiBar / BottomTabs を使わない画面（余分な下余白を付けない）
// /memos・/reservations・/ai-assist は下部ナビ・AIバーとも非表示のため余分な下余白を付けない
const BARE_PAGES = ['/welcome', '/login', '/memos', '/reservations', '/ai-assist', '/consult'];

/**
 * メイン領域のラッパー。
 * - 通常画面：AIバー＋ボトムナビ分の下余白を確保。
 * - Welcome / Login：それらを表示しないため、下余白は通常のみ。
 */
export default function MainShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_PAGES.includes(pathname);
  // ホーム（/）・設定（/settings）は AiBar・BottomTabs を表示しないため、浮きバー分の余白は確保しない。
  // safe-area ＋ 通常の余白のみにして下部の空白を解消する。
  const isHome = pathname === '/';
  const isSettings = pathname === '/settings';

  return (
    <main
      className="flex-1 px-5 py-5"
      style={
        isHome || isSettings
          ? { paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }
          : bare
          ? undefined
          : { paddingBottom: 'calc(176px + env(safe-area-inset-bottom))' }
      }>
      {children}
    </main>
  );
}
