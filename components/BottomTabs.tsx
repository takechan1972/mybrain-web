'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { ClockIcon, HomeIcon, SettingsIcon } from './icons';

// タブを隠すパス（ランディング・ログイン・メモ管理／予定管理／AIアシスト管理スマホUI）
const HIDE_ON = ['/welcome', '/login', '/memos', '/reservations', '/ai-assist', '/consult'];

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
