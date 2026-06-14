'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AiBar from '@/components/AiBar';
import { CalendarIcon, ChatIcon, ChevronRightIcon, FileTextIcon } from '@/components/icons';
import { listMemos } from '@/lib/memos';
import { listReservations } from '@/lib/reservations';
import { loadConsultTurns, type Turn } from '@/lib/consult-store';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import type { Memo, Reservation } from '@/lib/types';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const PURPLE = '#7B61FF';
const LAVENDER = '#EEF0FF';

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

  useEffect(() => {
    // AI相談履歴は localStorage（Supabase 設定の有無に関わらず読み込む）
    setTurns(loadConsultTurns());
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
    <div className="flex flex-col gap-5">
      {/* 上部の淡いラベンダーグラデーション（装飾・操作不可） */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 mx-auto h-80 w-full max-w-md"
        style={{ background: 'linear-gradient(180deg, #EEF0FF 0%, rgba(247,248,252,0) 100%)' }}
      />

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
        <div className="mt-2 text-[20px] font-extrabold tracking-[0.18em]" style={{ color: NAVY }}>
          MYBRAIN
        </div>
        <div className="text-[10px] tracking-[0.4em]" style={{ color: MUTED }}>
          マイブレイン
        </div>
      </header>

      {/* 挨拶 */}
      <section className="mt-1">
        <h1 className="text-[22px] font-bold leading-snug" style={{ color: NAVY }}>
          こんにちは、{name}さん
        </h1>
        <p className="mt-1 text-sm" style={{ color: MUTED }}>
          今日もあなたの第二の脳がサポートします。
        </p>
      </section>

      {/* 利用状況：1枚のワイドカードに3カラム */}
      <section className="grid grid-cols-3 divide-x divide-[#EEF0F5] rounded-3xl border border-[#E5E8F0] bg-white py-4 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <StatCol label="メモ" value={memos.length} unit="件" />
        <StatCol label="予定" value={reservations.length} unit="件" />
        <StatCol label="AI相談" value={turns.length} unit="回" />
      </section>

      {/* メインアクション：縦並び横型カード */}
      <section className="flex flex-col gap-3">
        <ActionCard
          href="/memos"
          icon={<FileTextIcon size={22} />}
          title="メモ"
          desc="アイデアやメモを記録しましょう"
        />
        <ActionCard
          href="/consult"
          icon={<ChatIcon size={22} />}
          title="AI相談"
          desc="メモや予定を参照して相談"
        />
        <ActionCard
          href="/reservations"
          icon={<CalendarIcon size={22} />}
          title="予定"
          desc="スケジュールを管理しましょう"
        />
      </section>

      {/* 今日の予定 */}
      <section className="rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <Link href="/reservations" className="flex items-center gap-3 active:opacity-70">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: LAVENDER, color: NAVY }}>
            <CalendarIcon size={20} />
          </span>
          <span className="flex-1">
            <span className="block text-[15px] font-bold" style={{ color: NAVY }}>
              今日の予定
            </span>
            {todays.length === 0 && (
              <span className="block text-[13px]" style={{ color: MUTED }}>
                今日の予定はありません。ゆったり過ごせる一日です。
              </span>
            )}
          </span>
          <span style={{ color: '#A6AEC0' }}>
            <ChevronRightIcon size={18} />
          </span>
        </Link>
        {todays.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2 border-t border-[#EEF0F5] pt-3">
            {todays.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-sm">
                <span className="w-12 font-bold" style={{ color: NAVY }}>
                  {hhmm(r.scheduleAt)}
                </span>
                <span className="flex-1 truncate text-[#1F2937]">{r.title || '無題の予定'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 最近のメモ */}
      <section className="rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-bold" style={{ color: NAVY }}>
            最近のメモ
          </h2>
          <Link
            href="/memos"
            aria-label="すべてのメモを見る"
            className="-mr-2 flex min-h-[32px] items-center gap-0.5 px-2 text-[12px] font-semibold active:opacity-60"
            style={{ color: MUTED }}>
            すべて見る
            <ChevronRightIcon size={14} />
          </Link>
        </div>
        {recentMemos.length === 0 ? (
          <p className="py-2 text-sm" style={{ color: MUTED }}>
            まだメモはありません
          </p>
        ) : (
          <ul className="flex flex-col">
            {recentMemos.map((m) => (
              <li key={m.id} className="border-b border-[#EEF0F5] last:border-b-0">
                <Link href={`/memos/${m.id}`} className="flex items-center gap-2.5 py-2.5 text-sm active:opacity-70">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: LAVENDER, color: PURPLE }}>
                    <FileTextIcon size={15} />
                  </span>
                  <span className="flex-1 truncate text-[#1F2937]">{m.title || '無題のメモ'}</span>
                  <span style={{ color: '#A6AEC0' }}>
                    <ChevronRightIcon size={14} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI相談履歴 */}
      <section className="rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-bold" style={{ color: NAVY }}>
            AI相談履歴
          </h2>
          <Link
            href="/history"
            className="flex items-center gap-0.5 text-[12px] font-semibold"
            style={{ color: MUTED }}>
            すべて見る
            <ChevronRightIcon size={14} />
          </Link>
        </div>
        {recentTurns.length === 0 ? (
          <p className="py-2 text-sm" style={{ color: MUTED }}>
            まだAI相談履歴はありません
          </p>
        ) : (
          <ul className="flex flex-col">
            {recentTurns.map((t) => (
              <li key={t.id} className="border-b border-[#EEF0F5] last:border-b-0">
                <Link href="/consult" className="flex items-start gap-2.5 py-2.5 text-sm active:opacity-70">
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: LAVENDER, color: NAVY }}>
                    <ChatIcon size={15} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-semibold text-[#1F2937]">
                      {t.question || '（質問なし）'}
                    </span>
                    <span className="truncate text-[12px]" style={{ color: MUTED }}>
                      {t.answer}
                    </span>
                    {shortDateTime(t.createdAt) && (
                      <span className="text-[11px]" style={{ color: '#A6AEC0' }}>
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
        <p className="rounded-xl border bg-yellow-50 p-3 text-xs text-yellow-800">
          Supabase 未設定のため件数・一覧は表示されません（.env.local 設定後に有効）。
        </p>
      )}

      {/* AI相談バー（fixed配置・ボトムナビの上に独立して浮く） */}
      <AiBar />
    </div>
  );
}

function StatCol({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col items-center px-2 text-center">
      <div className="text-[11px]" style={{ color: MUTED }}>
        {label}
      </div>
      <div className="mt-0.5 text-[22px] font-extrabold leading-tight" style={{ color: NAVY }}>
        {value}
        <span className="ml-0.5 text-[11px] font-normal" style={{ color: '#A6AEC0' }}>
          {unit}
        </span>
      </div>
    </div>
  );
}

function ActionCard({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-3xl border border-[#E5E8F0] bg-white px-4 py-4 shadow-[0_10px_28px_rgba(31,53,104,0.07)] active:opacity-70">
      {/* 左：ラベンダー円アイコン */}
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: LAVENDER, color: NAVY }}>
        {icon}
      </span>
      {/* 中：タイトル＋説明 */}
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-bold" style={{ color: NAVY }}>
          {title}
        </span>
        <span className="text-[12px] leading-tight" style={{ color: MUTED }}>
          {desc}
        </span>
      </span>
      {/* 右：丸矢印 */}
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: NAVY }}>
        <ChevronRightIcon size={14} />
      </span>
    </Link>
  );
}
