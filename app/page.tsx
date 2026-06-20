'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import VoiceInput from '@/components/VoiceInput';
import { listMemos } from '@/lib/memos';
import { listReservations } from '@/lib/reservations';
import { loadConsultTurns } from '@/lib/consult-store';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import DesktopDashboard from '@/components/DesktopDashboard';
import type { Memo, Reservation } from '@/lib/types';

// 予定日時(ms) → "HH:mm"（今日の予定の時刻表示用）
function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '時刻未設定';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// その予定が「今日（ローカル日付）」かどうか
function isToday(ms: number | null): boolean {
  if (ms === null || !Number.isFinite(ms)) return false;
  const d = new Date(ms);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function HomePage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [name, setName] = useState('ゲスト');
  const [memos, setMemos] = useState<Memo[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  // AIアシスト履歴の件数（localStorage 保存・Supabase 設定に依存しない）
  const [aiCount, setAiCount] = useState(0);
  // AI検索バーの入力
  const [query, setQuery] = useState('');

  // AI一覧の件数を読み込み（マウント時＋フォーカス／表示復帰時に更新）
  useEffect(() => {
    const loadAi = () => setAiCount(loadConsultTurns().length);
    loadAi();
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadAi();
    };
    window.addEventListener('focus', loadAi);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', loadAi);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // データ読み込み（PC版 DesktopDashboard ＋ スマホの「今日の予定」で使用）。
  useEffect(() => {
    if (!configured) return;
    const sb = getSupabaseBrowserClient();
    sb?.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? '';
      if (email) setName(email.split('@')[0]);
    });
    const load = () => {
      void listMemos().then(({ memos }) => setMemos(memos));
      void listReservations().then(({ reservations }) => setReservations(reservations));
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [configured]);

  // AI検索バー送信：入力内容を AIアシスト（/ai-assist）へ ?q= で受け渡す。
  // 受け取った側で自動実行され、再入力なしで回答まで表示される。
  function submitSearch() {
    const q = query.trim();
    if (q.length === 0) return;
    router.push(`/ai-assist?q=${encodeURIComponent(q)}`);
  }

  // 今日の予定（開始時刻の昇順）。データが無い／未設定は除外。
  const todays = reservations
    .filter((r) => isToday(r.startAt ?? r.scheduleAt))
    .sort((a, b) => (a.startAt ?? a.scheduleAt ?? 0) - (b.startAt ?? b.scheduleAt ?? 0));

  return (
    <>
    {/* ── PC（lg以上）：ダッシュボードUI（変更なし） ── */}
    <DesktopDashboard memos={memos} reservations={reservations} userName={name} />

    {/* ── スマホ／タブレット（lg未満）：ホーム ── */}
    <div className="relative lg:hidden">
      {/* 宇宙背景（haikei.png）＋暗オーバーレイ（他画面と統一） */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen lg:hidden"
        style={{
          backgroundColor: '#050716',
          backgroundImage: "url('/haikei.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen lg:hidden"
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,7,22,0.30) 0%, rgba(5,7,22,0.55) 45%, rgba(5,7,22,0.92) 100%)',
        }}
      />

      <div
        className="relative z-10 flex flex-col gap-5"
        style={{ paddingBottom: 'calc(32px + env(safe-area-inset-bottom))' }}>

        {/* ロゴ（宇宙背景はそのまま維持） */}
        <header className="flex flex-col items-center pt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mybrain-original-logo-transparent.png"
            alt="MYBRAIN マイブレイン"
            className="h-auto object-contain"
            style={{ width: 'clamp(180px, 52vw, 270px)' }}
          />
        </header>

        {/* AI検索バー（入力フォーム）。送信で AI（/consult）へ。マイクで音声入力。 */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch();
          }}
          className="flex items-center gap-2 rounded-full px-4 py-2.5"
          style={{
            background: 'rgba(10,14,35,0.65)',
            border: '1px solid rgba(123,95,255,0.38)',
            boxShadow: '0 0 14px rgba(123,95,255,0.12) inset',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}>
          <span className="shrink-0" style={{ color: '#9B7BFF' }} aria-hidden>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="AIに相談・検索..."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#6b73a8]"
            style={{ color: '#e0e7ff', caretColor: '#9B7BFF' }}
          />
          {/* 音声入力（メモ／予定／AI画面と同じマイク画像で統一） */}
          <VoiceInput
            iconOnly
            micSrc="/mic-icon.jpg"
            onResult={(t) => setQuery(t)}
            getInitial={() => query}
          />
          <button
            type="submit"
            aria-label="AIに送信"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)',
              boxShadow: '0 0 12px rgba(99,102,241,0.4)',
            }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>

        {/* 大ボタン：メモ / 予定 / AI（縦長・一言説明つき・主要操作） */}
        <div className="grid grid-cols-3 gap-3">
          <BigNav href="/memos" color="#22E5A8" title="メモ" desc="思いついたことをすぐ記録" icon={<NeonMemoIcon color="#22E5A8" />} />
          <BigNav href="/reservations" color="#38BDF8" title="予定" desc="大切な予定をかんたん管理" icon={<NeonCalendarIcon color="#38BDF8" />} />
          <BigNav href="/ai-assist" color="#A66BFF" title="AI" desc="メモと予定からアシスト" icon={<NeonChatIcon color="#A66BFF" />} />
        </div>

        {/* 一覧ボタン：メモ一覧 / 予定一覧 / AI一覧（件数つき・3列グリッド） */}
        <div className="grid grid-cols-3 gap-3">
          <ListNav href="/history?view=memos" color="#22E5A8" label="メモ一覧" count={memos.length} icon={<NeonMemoIcon color="#22E5A8" />} />
          <ListNav href="/history?view=reservations" color="#38BDF8" label="予定一覧" count={reservations.length} icon={<NeonCalendarIcon color="#38BDF8" />} />
          <ListNav href="/history?tab=consult" color="#A66BFF" label="AI一覧" count={aiCount} icon={<NeonChatIcon color="#A66BFF" />} />
        </div>

        {/* 設定ボタン */}
        <Link href="/settings" aria-label="設定" className="block active:scale-95">
          <div
            className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3"
            style={{
              background: 'rgba(10,12,28,0.6)',
              border: '1px solid rgba(166,107,255,0.4)',
              boxShadow: '0 0 14px rgba(166,107,255,0.14)',
            }}>
            <NeonSettingsIcon color="#A66BFF" size={22} />
            <span className="text-[14px] font-bold" style={{ color: '#C9B6FF' }}>
              設定
            </span>
          </div>
        </Link>

        {/* 今日の予定（下部） */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[12px] font-bold" style={{ color: 'rgba(170,200,255,0.8)' }}>
              今日の予定
            </span>
            <Link href="/history?view=reservations" className="text-[12px] font-semibold active:opacity-70" style={{ color: '#7DD3FC' }}>
              すべて見る ›
            </Link>
          </div>
          {todays.length === 0 ? (
            <div
              className="rounded-2xl px-4 py-5 text-center text-[13px]"
              style={{
                background: 'rgba(10,14,35,0.55)',
                border: '1px dashed rgba(120,160,255,0.3)',
                color: '#9fb0e0',
              }}>
              今日の予定はありません
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {todays.map((r) => (
                <Link
                  key={r.id}
                  href={`/reservations/${r.id}`}
                  aria-label="予定の詳細を見る"
                  className="block active:opacity-70">
                  <div
                    className="flex items-center gap-3 rounded-2xl px-4 py-3"
                    style={{
                      background: 'rgba(10,18,38,0.72)',
                      border: '1px solid rgba(56,189,248,0.3)',
                      boxShadow: '0 0 16px rgba(56,189,248,0.1), 0 8px 22px rgba(0,0,0,0.35)',
                    }}>
                    <span
                      className="shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-bold"
                      style={{ background: 'rgba(56,189,248,0.18)', color: '#7DD3FC' }}>
                      {r.allDay ? '終日' : formatTime(r.startAt ?? r.scheduleAt)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-white">
                      {r.title || '無題の予定'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
    </>
  );
}

/* ── 大ボタン（メモ / 予定 / AI・縦長・一言説明つき・主要操作） ── */
function BigNav({
  href,
  color,
  title,
  desc,
  icon,
}: {
  href: string;
  color: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} aria-label={title} className="block active:scale-95">
      <div
        className="flex h-full min-h-[168px] flex-col items-center justify-center gap-2.5 rounded-2xl px-2 py-6 text-center"
        style={{
          background: `linear-gradient(160deg, ${hexA(color, 0.16)} 0%, rgba(10,12,28,0.66) 72%)`,
          border: `1px solid ${hexA(color, 0.45)}`,
          boxShadow: `0 0 18px ${hexA(color, 0.18)}, 0 8px 24px rgba(0,0,0,0.35)`,
        }}>
        <span>{icon}</span>
        <span className="text-[16px] font-bold" style={{ color }}>
          {title}
        </span>
        <span className="text-[11px] font-medium leading-snug" style={{ color: 'rgba(220,230,255,0.72)' }}>
          {desc}
        </span>
      </div>
    </Link>
  );
}

/* ── 一覧ボタン（メモ一覧 / 予定一覧 / AI一覧・件数つき・大ボタンと同じカード） ── */
function ListNav({
  href,
  color,
  label,
  count,
  icon,
}: {
  href: string;
  color: string;
  label: string;
  count: number;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} aria-label={`${label}（${count}件）`} className="block active:scale-95">
      <div
        className="flex h-full flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-4 text-center"
        style={{
          background: `linear-gradient(160deg, ${hexA(color, 0.16)} 0%, rgba(10,12,28,0.66) 72%)`,
          border: `1px solid ${hexA(color, 0.45)}`,
          boxShadow: `0 0 18px ${hexA(color, 0.18)}, 0 8px 24px rgba(0,0,0,0.35)`,
        }}>
        <span>{icon}</span>
        <span className="text-[13px] font-bold leading-tight" style={{ color }}>
          {label}
        </span>
        <span className="text-[12px] font-bold" style={{ color: 'rgba(255,255,255,0.88)' }}>
          {count}件
        </span>
      </div>
    </Link>
  );
}

/* ── ネオンSVGアイコン（メモ管理画面と同一・size 指定可） ── */
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function glow(color: string) {
  return { filter: `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 12px ${hexA(color, 0.5)})` };
}

function NeonMemoIcon({ color, size = 38 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={glow(color)}>
      <rect x="9" y="5" width="24" height="32" rx="3.5" stroke={color} strokeWidth="2.2" />
      <line x1="14" y1="13" x2="27" y2="13" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="19" x2="27" y2="19" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="25" x2="22" y2="25" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M31 30 L41 20 L44 23 L34 33 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function NeonCalendarIcon({ color, size = 38 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={glow(color)}>
      <rect x="6" y="9" width="36" height="31" rx="4" stroke={color} strokeWidth="2.2" />
      <line x1="6" y1="18" x2="42" y2="18" stroke={color} strokeWidth="2" />
      <line x1="16" y1="5" x2="16" y2="13" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="32" y1="5" x2="32" y2="13" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="15" cy="26" r="2.3" fill={color} /><circle cx="24" cy="26" r="2.3" fill={color} /><circle cx="33" cy="26" r="2.3" fill={color} />
      <circle cx="15" cy="33" r="2.3" fill={color} /><circle cx="24" cy="33" r="2.3" fill={color} />
    </svg>
  );
}

function NeonChatIcon({ color, size = 38 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={glow(color)}>
      <path d="M6 10 Q6 6 10 6 H38 Q42 6 42 10 V27 Q42 31 38 31 H15 L7 41 V31 Q6 31 6 27 Z" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="17" cy="19" r="2.6" fill={color} /><circle cx="24" cy="19" r="2.6" fill={color} /><circle cx="31" cy="19" r="2.6" fill={color} />
    </svg>
  );
}

function NeonSettingsIcon({ color, size = 38 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={glow(color)}>
      <circle cx="24" cy="24" r="6.5" stroke={color} strokeWidth="2.2" />
      <path
        d="M24 6 v5 M24 37 v5 M6 24 h5 M37 24 h5 M11.3 11.3 l3.6 3.6 M33.1 33.1 l3.6 3.6 M36.7 11.3 l-3.6 3.6 M14.9 33.1 l-3.6 3.6"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
