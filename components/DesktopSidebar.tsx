'use client';

import Link from 'next/link';
import Image from 'next/image';
import type { ComponentType, ReactNode } from 'react';
import {
  CalendarIcon,
  ChatIcon,
  FileTextIcon,
  HomeIcon,
  MicIcon,
  SettingsIcon,
} from './icons';

const NAVY = '#223A70';
const PURPLE = '#7B61FF';

export type NavKey = 'home' | 'memos' | 'reservations' | 'consult' | 'transcribe' | 'settings';

/** PC用 左ナビ項目（全画面で共通） */
const NAV: { key: NavKey; href: string; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { key: 'home', href: '/', label: 'ホーム', Icon: HomeIcon },
  { key: 'memos', href: '/memos', label: 'メモ', Icon: FileTextIcon },
  { key: 'reservations', href: '/reservations', label: '予定', Icon: CalendarIcon },
  { key: 'consult', href: '/consult', label: 'AI相談', Icon: ChatIcon },
  { key: 'transcribe', href: '/transcribe', label: '文字起こし', Icon: MicIcon },
  { key: 'settings', href: '/settings', label: '設定', Icon: SettingsIcon },
];

/**
 * PC用（lg 以上）の共通左サイドバー。
 * - 白背景・固定幅。
 * - 選択中ページは「淡い紫背景 + 紫文字/アイコン + 左アクセントライン」で統一。
 * - 未選択は落ち着いたグレー文字、hover で淡いグレー背景。
 * - 下部の AI・音声ステータス等は各画面ごとに `bottom` で差し込む。
 */
export default function DesktopSidebar({ active, bottom }: { active: NavKey; bottom?: ReactNode }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[#E8EAF3] bg-white px-4 py-5">
      <Link href="/" className="flex items-center gap-2.5 px-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E8EAF3] bg-white p-1.5">
          <Image src="/mybrain-logo.svg" alt="MyBrain" width={32} height={32} className="h-full w-full object-contain" priority />
        </span>
        <span className="text-[17px] font-extrabold tracking-wide" style={{ color: NAVY }}>MYBRAIN</span>
      </Link>

      <nav className="mt-6 flex flex-col gap-1.5">
        {NAV.map(({ key, href, label, Icon }) => {
          const isActive = key === active;
          return (
            <Link
              key={key}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[14px] font-semibold transition ${isActive ? '' : 'text-[#54607A] hover:bg-[#F1EEFE]'}`}
              style={isActive
                ? {
                    background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)`,
                    color: '#fff',
                    boxShadow: '0 6px 16px rgba(123,97,255,0.35)',
                  }
                : undefined}>
              {isActive && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-white/90" />}
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      {bottom && <div className="mt-auto flex flex-col gap-3">{bottom}</div>}
    </aside>
  );
}
