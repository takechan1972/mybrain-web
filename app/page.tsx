'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CalendarIcon, ChatIcon, ChevronRightIcon, FileTextIcon, MicIcon, SearchIcon } from '@/components/icons';
import { listMemos } from '@/lib/memos';
import { listReservations } from '@/lib/reservations';
import { loadConsultTurns } from '@/lib/consult-store';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { isLocalHost } from '@/lib/env';
import DesktopDashboard from '@/components/DesktopDashboard';
import type { Memo, Reservation } from '@/lib/types';

export default function HomePage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [name, setName] = useState('ゲスト');
  const [memos, setMemos] = useState<Memo[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [turnsCount, setTurnsCount] = useState(0);
  const [local, setLocal] = useState(false);
  // ホーム検索バー（実入力フィールド）。Enter または検索アイコンで /history?q= へ遷移
  const [searchText, setSearchText] = useState('');

  // 検索実行：キーワードが空なら何もしない。安全に encodeURIComponent して履歴検索へ
  function submitSearch() {
    const q = searchText.trim();
    if (!q) return;
    router.push(`/history?q=${encodeURIComponent(q)}`);
  }

  useEffect(() => {
    setLocal(isLocalHost());
    // AI相談履歴は localStorage 由来（Supabase 未設定でも件数を取得できる）
    setTurnsCount(loadConsultTurns().length);
    if (!configured) return;
    const sb = getSupabaseBrowserClient();
    sb?.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? '';
      if (email) setName(email.split('@')[0]);
    });
    const load = () => {
      void listMemos().then(({ memos }) => setMemos(memos));
      void listReservations().then(({ reservations }) => setReservations(reservations));
      // AI相談画面などから戻ったときも件数を更新
      setTurnsCount(loadConsultTurns().length);
    };
    load();
    // 他画面で保存して戻ってきたときも最新を表示する
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

  // 今日の予定：開始日時（scheduleAt=開始日時の互換値、無ければ startAt）がローカル日付で「今日」のものを
  // 開始時刻の昇順に並べる。日時が無い予定は除外（クラッシュ防止）。
  const todays = reservations
    .filter((r) => {
      const ms = r.scheduleAt ?? r.startAt;
      return typeof ms === 'number' && Number.isFinite(ms) && isToday(ms);
    })
    .sort((a, b) => (a.scheduleAt ?? a.startAt ?? 0) - (b.scheduleAt ?? b.startAt ?? 0));
  const todaysTop = todays.slice(0, 3);

  return (
    <>
    {/* ── PC（lg以上）：ダッシュボードUI ── */}
    <DesktopDashboard memos={memos} reservations={reservations} userName={name} />

    {/* ── スマホ／タブレット（lg未満）：宇宙背景・ネオンUI ── */}
    <div className="relative lg:hidden">
      {/* 宇宙背景（haikei.png）＋暗オーバーレイ（メモ／予定／履歴画面と統一・スマホのみ） */}
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

      {/* 下部余白は MainShell（ホームは safe-area + 控えめ）が付与するためここでは重複させない */}
      <div className="relative z-10 flex flex-col gap-5">

      {/* ── ヒーロー：ネオン脳ロゴ（装飾ロボット・右上ギアはモバイルでは非表示） ── */}
      <header className="relative flex flex-col items-center pt-2">
        {/* 脳アイコン＋MYBRAIN＋マイブレイン（透過ロゴ1枚） */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mybrain-original-logo-transparent.png"
          alt="MYBRAIN マイブレイン"
          className="h-auto object-contain"
          style={{ width: 'clamp(220px, 62vw, 320px)' }}
        />
        <p className="mt-1 text-center text-[15px] font-bold tracking-wide" style={{ color: 'rgba(205,220,250,0.92)' }}>
          あなたの毎日を、もっとシンプルに。
        </p>
      </header>

      {/* ── 主要導線：上段=メモ/予定/AI（やや大きめ）、中段=各一覧、下段=AIアシスト＋設定。
            ロゴとの間に少し余白（mt-3）を確保 ── */}
      <section className="mt-3 flex flex-col gap-3">
        {/* 上段：メイン機能（縦型カード・ラベル＋説明文・1行3列） */}
        <div className="grid grid-cols-3 gap-3">
          <HomeTile big href="/memos" color="#22E5A8" title="メモ" desc="思いつきを保存" icon={<FileTextIcon size={28} />} />
          <HomeTile big href="/reservations" color="#38BDF8" title="予定" desc="予定を管理" icon={<CalendarIcon size={28} />} />
          <HomeTile big href="/consult" color="#A66BFF" title="AI" desc="メモから相談" icon={<ChatIcon size={28} />} />
        </div>
        {/* 中段：各一覧（同寸・控えめ表示・登録件数を表示） */}
        <div className="grid grid-cols-3 gap-3">
          <HomeTile href="/history?tab=memos" color="#22E5A8" title="メモ一覧" count={memos.length} icon={<FileTextIcon size={26} />} subtle />
          <HomeTile href="/history?tab=schedule" color="#38BDF8" title="予定一覧" count={reservations.length} icon={<CalendarIcon size={26} />} subtle />
          <HomeTile href="/history?tab=consult" color="#A66BFF" title="AI一覧" count={turnsCount} icon={<ChatIcon size={26} />} subtle />
        </div>
        {/* 下段：検索バー（2/3幅・長め）＋設定（1/3幅・テキストのみ／ギアなし）。同じホームデザインで統一 */}
        <div className="grid grid-cols-3 gap-3">
          {/* メモ・予定を検索：実際の入力フィールド。Enter / 検索ボタンで /history?q= へ遷移。長め（2/3幅） */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch();
            }}
            role="search"
            className="col-span-2 flex min-h-[52px] items-center gap-2.5 rounded-2xl px-4 py-2.5"
            style={{
              background: 'linear-gradient(160deg, rgba(99,102,241,0.14) 0%, rgba(8,12,28,0.72) 75%)',
              border: '1px solid rgba(99,102,241,0.40)',
              boxShadow: '0 0 18px rgba(99,102,241,0.16) inset, 0 8px 22px rgba(0,0,0,0.35)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}>
            <button
              type="submit"
              aria-label="検索"
              className="flex shrink-0 items-center justify-center active:opacity-60"
              style={{ color: '#818cf8', filter: 'drop-shadow(0 0 5px rgba(129,140,248,0.6))' }}>
              <SearchIcon size={20} />
            </button>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="メモ・予定を検索"
              enterKeyHint="search"
              aria-label="メモ・予定を検索"
              className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none placeholder:font-normal placeholder:text-[#7a86b8]"
              style={{ color: '#e0e7ff', caretColor: '#818cf8' }}
            />
          </form>
          {/* 設定：テキストのみ（ギアアイコンは表示しない） */}
          <Link
            href="/settings"
            aria-label="設定"
            className="flex min-h-[52px] items-center justify-center rounded-2xl px-3 py-3 active:scale-95"
            style={{
              background: 'linear-gradient(160deg, rgba(120,160,255,0.12) 0%, rgba(8,12,28,0.7) 75%)',
              border: '1px solid rgba(120,160,255,0.38)',
              color: '#c7d2fe',
              boxShadow: '0 0 16px rgba(99,102,241,0.16), 0 8px 22px rgba(0,0,0,0.35)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}>
            <span className="text-[14px] font-bold">設定</span>
          </Link>
        </div>
      </section>

      {/* 文字起こし（PCローカル環境のみ・スマホでは非表示。3×2グリッドの下に配置） */}
      {local && (
        <div className="hidden md:block">
          <ActionCard
            href="/transcribe"
            color="#7BA6FF"
            icon={<MicIcon size={22} />}
            title="文字起こし"
            desc="音声ファイルをローカルWhisperでメモ化（PC用）"
          />
        </div>
      )}

      {/* 今日の予定（最下部・コンパクトカード）。最大3件、超過時のみ「予定一覧へ」を表示 */}
      <section className="rounded-3xl p-4" style={TODAY_CARD}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-bold" style={{ color: '#ffffff' }}>
            今日の予定
          </h2>
          {todays.length > 3 && (
            <Link
              href="/reservations"
              className="flex items-center gap-0.5 text-[12px] font-semibold active:opacity-60"
              style={{ color: '#7dd3fc' }}>
              予定一覧へ
              <ChevronRightIcon size={14} />
            </Link>
          )}
        </div>
        {todaysTop.length === 0 ? (
          <p className="text-[13px]" style={{ color: '#9fb0e0' }}>
            今日の予定はありません
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {todaysTop.map((r) => (
              <li key={r.id} className="flex items-start gap-3">
                <span className="w-12 shrink-0 text-[12px] font-bold" style={{ color: '#7dd3fc' }}>
                  {r.allDay ? '終日' : hhmm(r.scheduleAt ?? r.startAt)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold" style={{ color: '#dbeafe' }}>
                    {r.title || '無題の予定'}
                  </span>
                  {(r.content ?? '').trim().length > 0 && (
                    <span className="block truncate text-[12px]" style={{ color: '#9fb0e0' }}>
                      {r.content.trim()}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!configured && (
        <p className="rounded-xl border p-3 text-xs" style={{ borderColor: 'rgba(242,213,138,0.4)', background: 'rgba(242,213,138,0.10)', color: '#f2d58a' }}>
          Supabase 未設定のため件数・一覧は表示されません（.env.local 設定後に有効）。
        </p>
      )}
      </div>
    </div>
    </>
  );
}

/** #RRGGBB + alpha → rgba() */
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** ローカル日付で「今日」か判定（日時 ms）。 */
function isToday(ms: number): boolean {
  const d = new Date(ms);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

/** epoch ms → "HH:mm"（時刻のみ）。null/不正は空文字。 */
function hhmm(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 今日の予定カード（予定テーマの青系グラス）。
const TODAY_CARD: React.CSSProperties = {
  background: 'rgba(10,14,35,0.6)',
  border: '1px solid rgba(56,189,248,0.25)',
  boxShadow: '0 0 18px rgba(56,189,248,0.10), 0 10px 28px rgba(0,0,0,0.35)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
};

/**
 * ホーム主要導線タイル。上段（メモ/予定/AI）と下段（各一覧）を統一スタイルで表示。
 * - subtle = true で一覧用の控えめ表示（色は同系統のまま、彩度・発光を弱める）。
 * - big = true でやや高い縦型カード。desc を渡すとラベル下に小さな説明文を表示。
 */
function HomeTile({
  href,
  color,
  icon,
  title,
  desc,
  count,
  subtle = false,
  big = false,
}: {
  href: string;
  color: string;
  icon: React.ReactNode;
  title: string;
  desc?: string;
  count?: number;
  subtle?: boolean;
  big?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={title}
      className={`flex ${big ? 'min-h-[132px] gap-1.5 py-4' : 'min-h-[96px] gap-2 py-4'} flex-col items-center justify-center rounded-2xl px-1.5 text-center active:scale-95`}
      style={{
        background: `linear-gradient(160deg, ${hexA(color, subtle ? 0.1 : 0.16)} 0%, rgba(8,12,28,0.72) 72%)`,
        border: `1.5px solid ${hexA(color, subtle ? 0.4 : 0.6)}`,
        boxShadow: subtle
          ? `0 0 16px ${hexA(color, 0.16)}, 0 8px 22px rgba(0,0,0,0.35)`
          : `0 0 22px ${hexA(color, 0.3)}, 0 10px 26px rgba(0,0,0,0.4)`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}>
      <span style={{ color, filter: `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 12px ${hexA(color, 0.6)})` }}>
        {icon}
      </span>
      <span className={`${big ? 'text-[16px]' : 'text-[14px]'} font-extrabold leading-tight`} style={{ color, textShadow: `0 0 10px ${hexA(color, 0.55)}` }}>
        {title}
      </span>
      {desc && (
        <span className="text-[10px] font-medium leading-tight" style={{ color: 'rgba(225,232,255,0.78)' }}>
          {desc}
        </span>
      )}
      {typeof count === 'number' && (
        <span className="text-[11px] font-bold leading-none" style={{ color: hexA(color, 0.95) }}>
          {count}件
        </span>
      )}
    </Link>
  );
}

function ActionCard({
  href,
  color,
  icon,
  title,
  desc,
}: {
  href: string;
  color: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  desc: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-3xl px-4 py-4 active:opacity-70"
      style={{
        background: `linear-gradient(160deg, ${hexA(color, 0.14)} 0%, rgba(10,14,32,0.7) 72%)`,
        border: `1px solid ${hexA(color, 0.4)}`,
        boxShadow: `0 0 18px ${hexA(color, 0.16)}, 0 10px 28px rgba(0,0,0,0.35)`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}>
      {/* 左：ネオン円アイコン */}
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: hexA(color, 0.18), color }}>
        {icon}
      </span>
      {/* 中：タイトル＋説明 */}
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-bold" style={{ color: '#ffffff' }}>
          {title}
        </span>
        <span className="text-[12px] leading-tight" style={{ color: '#9fb0e0' }}>
          {desc}
        </span>
      </span>
      {/* 右：丸矢印 */}
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: hexA(color, 0.9), color: '#06121f' }}>
        <ChevronRightIcon size={14} />
      </span>
    </Link>
  );
}
