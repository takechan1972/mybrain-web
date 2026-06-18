'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { ClockIcon, HomeIcon, SettingsIcon } from './icons';

// タブを隠すパス（ホーム・ランディング・ログイン・メモ管理／予定管理／AIアシスト管理スマホUI・履歴）
// ホーム（/）はスマホUIが独自のカード導線を持つため共通ナビを隠す
// /history・各詳細ページは独自の下部ナビ（メモ/予定/AI）を表示するため共通ナビを隠す
const HIDE_ON = ['/', '/welcome', '/login', '/memos', '/reservations', '/ai-assist', '/consult', '/history'];
// 詳細／編集ページ（/memos/<id>・/reservations/<id>）も独自ナビを出すため隠す
const HIDE_PREFIXES = ['/memos/', '/reservations/'];

const NAVY = '#223A70';
const MUTED = '#8A94A6';

const TABS: { href: string; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { href: '/', label: 'ホーム', Icon: HomeIcon },
  { href: '/history', label: '履歴', Icon: ClockIcon },
  { href: '/settings', label: '設定', Icon: SettingsIcon },
];

export default function BottomTabs() {
  const pathname = usePathname();
  if (HIDE_ON.includes(pathname)) return null;
  if (HIDE_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-md justify-around border-t border-[#E5E8F0] bg-white pt-2"
      style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}>
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-1 rounded-2xl px-4 py-1 text-[11px] font-medium outline-none focus:outline-none focus-visible:bg-[#EEF0FF]"
            style={{
              color: active ? NAVY : MUTED,
              backgroundColor: active ? '#EEF0FF' : undefined,
            }}>
            <Icon size={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
