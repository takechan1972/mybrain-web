'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, HomeIcon } from '@/components/icons';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const LAVENDER = '#EEF0FF';

function LogoutIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function SettingsPage() {
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    sb?.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function handleSignOut() {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    await sb.auth.signOut();
    window.location.href = '/welcome';
  }

  const loggedIn = Boolean(email);
  const initial = email ? email.trim().charAt(0).toUpperCase() : 'G';

  return (
    <div className="flex flex-col gap-5" style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
      {/* ヘッダー */}
      <header className="flex items-center justify-between">
        <Link
          href="/"
          aria-label="戻る"
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full"
          style={{ color: NAVY }}>
          <ChevronLeftIcon size={22} />
        </Link>
        <h1 className="text-[18px] font-bold" style={{ color: NAVY }}>
          設定
        </h1>
        <span className="h-9 w-9" />
      </header>

      {/* アカウントカード */}
      <section className="flex items-center gap-4 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[22px] font-extrabold"
          style={{ backgroundColor: LAVENDER, color: NAVY }}>
          {initial}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[12px] font-semibold" style={{ color: MUTED }}>
            ログイン中
          </span>
          <span className="truncate text-[15px] font-bold" style={{ color: loggedIn ? '#1F2937' : MUTED }}>
            {email ?? '未ログイン'}
          </span>
        </div>
      </section>

      {/* メニュー */}
      <section className="overflow-hidden rounded-3xl border border-[#E5E8F0] bg-white shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <Link
          href="/"
          className="flex min-h-[56px] items-center gap-3 px-5 py-4 active:opacity-60">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: LAVENDER, color: NAVY }}>
            <HomeIcon size={18} />
          </span>
          <span className="flex-1 text-[15px] font-semibold" style={{ color: '#1F2937' }}>
            ホームへ戻る
          </span>
          <span className="shrink-0" style={{ color: '#A6AEC0' }}>
            <ChevronRightIcon size={18} />
          </span>
        </Link>
      </section>

      {/* ログアウト */}
      {configured && loggedIn && (
        <button
          type="button"
          onClick={handleSignOut}
          className="flex min-h-[52px] items-center justify-center gap-2 rounded-3xl border border-[#F3D2D2] bg-white text-[15px] font-bold text-red-600 shadow-[0_10px_28px_rgba(31,53,104,0.07)] active:opacity-60">
          <LogoutIcon size={18} />
          ログアウト
        </button>
      )}

      {!configured && (
        <p className="rounded-2xl border border-[#E5E8F0] bg-yellow-50 p-4 text-[13px] text-yellow-800">
          Supabase が未設定のため、アカウント情報は表示されません。
        </p>
      )}
    </div>
  );
}
