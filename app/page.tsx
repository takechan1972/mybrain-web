'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AiBar from '@/components/AiBar';
import { CalendarIcon, ChatIcon, ChevronRightIcon, FileTextIcon, MicIcon } from '@/components/icons';
import { listMemos } from '@/lib/memos';
import { listReservations } from '@/lib/reservations';
import { loadConsultTurns, type Turn } from '@/lib/consult-store';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { isLocalHost } from '@/lib/env';
import DesktopDashboard from '@/components/DesktopDashboard';
import type { Memo, Reservation } from '@/lib/types';

function hhmm(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isToday(ms: number | null): boolean {
  if (ms === null) return false;
  const d = new Date(ms);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function shortDateTime(ms: number): string {
  if (!ms || ms <= 0) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function HomePage() {
  const configured = isSupabaseConfigured();
  const [name, setName] = useState('ゲスト');
  const [memos, setMemos] = useState<Memo[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [local, setLocal] = useState(false);

  useEffect(() => {
    // AI相談履歴は localStorage（Supabase 設定の有無に関わらず読み込む）
    setTurns(loadConsultTurns());
    setLocal(isLocalHost());
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

  const todays = reservations
    .filter((r) => isToday(r.scheduleAt))
    .sort((a, b) => (a.scheduleAt ?? 0) - (b.scheduleAt ?? 0));
  const recentMemos = memos.slice(0, 3);
  const recentTurns = turns.slice(0, 3); // loadConsultTurns は新しい順で返す

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

      <div
        className="relative z-10 flex flex-col gap-5"
        style={{ paddingBottom: 'calc(176px + env(safe-area-inset-bottom))' }}>

      {/* ヘッダー：公式ロゴ（シンボル）を主役に中央配置 */}
      <header className="flex flex-col items-center pt-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mybrain-logo.svg"
          alt="MYBRAIN"
          width={72}
          height={60}
          className="h-auto w-[72px] object-contain"
        />
        <div className="mt-2 text-[20px] font-extrabold tracking-[0.18em]" style={{ color: '#ffffff' }}>
          MYBRAIN
        </div>
        <div className="text-[10px] tracking-[0.4em]" style={{ color: '#a5b4fc' }}>
          マイブレイン
        </div>
      </header>

      {/* 挨拶 */}
      <section className="mt-1">
        <h1 className="text-[22px] font-bold leading-snug" style={{ color: '#ffffff' }}>
          こんにちは、{name}さん
        </h1>
        <p className="mt-1 text-sm" style={{ color: '#a5b4fc' }}>
          今日もあなたの第二の脳がサポートします。
        </p>
      </section>

      {/* 利用状況：1枚のワイドカードに3カラム */}
      <section
        className="grid grid-cols-3 rounded-3xl py-4"
        style={{
          background: 'rgba(10,14,35,0.6)',
          border: '1px solid rgba(120,160,255,0.25)',
          boxShadow: '0 0 18px rgba(99,102,241,0.10), 0 10px 28px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}>
        <StatCol label="メモ" value={memos.length} unit="件" color="#22E5A8" />
        <StatCol label="予定" value={reservations.length} unit="件" color="#38BDF8" />
        <StatCol label="AI相談" value={turns.length} unit="回" color="#A66BFF" />
      </section>

      {/* メインアクション：縦並び横型カード */}
      <section className="flex flex-col gap-3">
        <ActionCard
          href="/memos"
          color="#22E5A8"
          icon={<FileTextIcon size={22} />}
          title="メモ"
          desc="アイデアやメモを記録しましょう"
        />
        <ActionCard
          href="/consult"
          color="#A66BFF"
          icon={<ChatIcon size={22} />}
          title="AI相談"
          desc="メモや予定を参照して相談"
        />
        <ActionCard
          href="/reservations"
          color="#38BDF8"
          icon={<CalendarIcon size={22} />}
          title="予定"
          desc="スケジュールを管理しましょう"
        />
        {/* 文字起こし（PCローカル環境のみ・スマホでは控えめに） */}
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
      </section>

      {/* 今日の予定 */}
      <section className="rounded-3xl p-5" style={GLASS_CARD}>
        <Link href="/reservations" className="flex items-center gap-3 active:opacity-70">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: 'rgba(56,189,248,0.18)', color: '#38BDF8' }}>
            <CalendarIcon size={20} />
          </span>
          <span className="flex-1">
            <span className="block text-[15px] font-bold" style={{ color: '#ffffff' }}>
              今日の予定
            </span>
            {todays.length === 0 && (
              <span className="block text-[13px]" style={{ color: '#9fb0e0' }}>
                今日の予定はありません。ゆったり過ごせる一日です。
              </span>
            )}
          </span>
          <span style={{ color: '#7dd3fc' }}>
            <ChevronRightIcon size={18} />
          </span>
        </Link>
        {todays.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid rgba(56,189,248,0.20)' }}>
            {todays.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-sm">
                <span className="w-12 font-bold" style={{ color: '#7dd3fc' }}>
                  {hhmm(r.scheduleAt)}
                </span>
                <span className="flex-1 truncate" style={{ color: '#dbeafe' }}>{r.title || '無題の予定'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 最近のメモ */}
      <section className="rounded-3xl p-5" style={GLASS_CARD}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-bold" style={{ color: '#ffffff' }}>
            最近のメモ
          </h2>
          <Link
            href="/memos"
            aria-label="すべてのメモを見る"
            className="-mr-2 flex min-h-[32px] items-center gap-0.5 px-2 text-[12px] font-semibold active:opacity-60"
            style={{ color: '#86efac' }}>
            すべて見る
            <ChevronRightIcon size={14} />
          </Link>
        </div>
        {recentMemos.length === 0 ? (
          <p className="py-2 text-sm" style={{ color: '#9fb0e0' }}>
            まだメモはありません
          </p>
        ) : (
          <ul className="flex flex-col">
            {recentMemos.map((m) => (
              <li key={m.id} style={{ borderBottom: '1px solid rgba(120,160,255,0.15)' }} className="last:border-b-0">
                <Link href={`/memos/${m.id}`} className="flex items-center gap-2.5 py-2.5 text-sm active:opacity-70">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: 'rgba(34,229,168,0.18)', color: '#22E5A8' }}>
                    <FileTextIcon size={15} />
                  </span>
                  <span className="flex-1 truncate" style={{ color: '#e6edff' }}>{m.title || '無題のメモ'}</span>
                  <span style={{ color: '#86efac' }}>
                    <ChevronRightIcon size={14} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI相談履歴 */}
      <section className="rounded-3xl p-5" style={GLASS_CARD}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-bold" style={{ color: '#ffffff' }}>
            AI相談履歴
          </h2>
          <Link
            href="/history"
            className="flex items-center gap-0.5 text-[12px] font-semibold"
            style={{ color: '#c4b5fd' }}>
            すべて見る
            <ChevronRightIcon size={14} />
          </Link>
        </div>
        {recentTurns.length === 0 ? (
          <p className="py-2 text-sm" style={{ color: '#9fb0e0' }}>
            まだAI相談履歴はありません
          </p>
        ) : (
          <ul className="flex flex-col">
            {recentTurns.map((t) => (
              <li key={t.id} style={{ borderBottom: '1px solid rgba(120,160,255,0.15)' }} className="last:border-b-0">
                <Link href="/consult" className="flex items-start gap-2.5 py-2.5 text-sm active:opacity-70">
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: 'rgba(166,107,255,0.18)', color: '#A66BFF' }}>
                    <ChatIcon size={15} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-semibold" style={{ color: '#e6edff' }}>
                      {t.question || '（質問なし）'}
                    </span>
                    <span className="truncate text-[12px]" style={{ color: '#9fb0e0' }}>
                      {t.answer}
                    </span>
                    {shortDateTime(t.createdAt) && (
                      <span className="text-[11px]" style={{ color: '#c4b5fd' }}>
                        {shortDateTime(t.createdAt)}
                      </span>
                    )}
                  </span>
                </Link>
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

      {/* AI相談バー（fixed配置・ボトムナビの上に独立して浮く） */}
      <AiBar />
      </div>
    </div>
    </>
  );
}

// 宇宙背景に浮かぶガラスカード風（共通スタイル）
const GLASS_CARD: React.CSSProperties = {
  background: 'rgba(10,14,35,0.6)',
  border: '1px solid rgba(120,160,255,0.25)',
  boxShadow: '0 0 18px rgba(99,102,241,0.10), 0 10px 28px rgba(0,0,0,0.35)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
};

function StatCol({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div className="flex flex-col items-center px-2 text-center">
      <div className="text-[11px]" style={{ color: '#9fb0e0' }}>
        {label}
      </div>
      <div className="mt-0.5 text-[22px] font-extrabold leading-tight" style={{ color }}>
        {value}
        <span className="ml-0.5 text-[11px] font-normal" style={{ color: '#9fb0e0' }}>
          {unit}
        </span>
      </div>
    </div>
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
