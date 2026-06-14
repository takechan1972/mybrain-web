'use client';

import Link from 'next/link';
import { CalendarIcon, ChevronRightIcon, FileTextIcon } from '@/components/icons';
import { formatSchedule } from '@/lib/reservations';
import type { Turn } from '@/lib/consult-store';
import type { Memo, Reservation } from '@/lib/types';

const NAVY = '#223A70';
const LAVENDER = '#EEF0FF';
const PURPLE = '#7B61FF';

/**
 * AI相談の回答が参照した予定・メモを、詳細ページへ遷移できるタップ可能カードで表示する。
 * - 予定 → /reservations/[id]、メモ → /memos/[id]
 * - ID は Turn.scheduleIds / memoIds に保存済み。表示用のタイトル等は現在のデータから解決する。
 * - 既に削除済みで見つからないものはスキップ（壊れたページへ遷移しない）。
 * - 相談画面・履歴画面の両方で共用する。
 */
export default function ConsultRefCards({
  turn,
  reservations,
  memos,
}: {
  turn: Turn;
  reservations: Reservation[];
  memos: Memo[];
}) {
  const schedules = (turn.scheduleIds ?? [])
    .map((id) => reservations.find((r) => r.id === id))
    .filter((r): r is Reservation => Boolean(r));
  const refMemos = (turn.memoIds ?? [])
    .map((id) => memos.find((m) => m.id === id))
    .filter((m): m is Memo => Boolean(m));
  if (schedules.length === 0 && refMemos.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-[#EEF0F5] pt-3">
      {schedules.map((r) => (
        <Link
          key={`s-${r.id}`}
          href={`/reservations/${r.id}`}
          aria-label="予定の詳細を見る"
          className="flex min-h-[44px] items-center gap-2.5 rounded-2xl border border-[#E5E8F0] bg-[#F7F8FC] px-3 py-2.5 active:opacity-60">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: LAVENDER, color: NAVY }}>
            <CalendarIcon size={16} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px]" style={{ color: '#A6AEC0' }}>
              {formatSchedule(r.scheduleAt)}
            </span>
            <span className="truncate text-[13px] font-bold text-[#1F2937]">{r.title || '無題の予定'}</span>
          </span>
          <span className="shrink-0" style={{ color: '#A6AEC0' }}>
            <ChevronRightIcon size={16} />
          </span>
        </Link>
      ))}
      {refMemos.map((m) => (
        <Link
          key={`m-${m.id}`}
          href={`/memos/${m.id}`}
          aria-label="メモの詳細を見る"
          className="flex min-h-[44px] items-center gap-2.5 rounded-2xl border border-[#E5E8F0] bg-[#F7F8FC] px-3 py-2.5 active:opacity-60">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: LAVENDER, color: PURPLE }}>
            <FileTextIcon size={16} />
          </span>
          <span className="truncate text-[13px] font-bold text-[#1F2937]">{m.title || '無題のメモ'}</span>
          <span className="ml-auto shrink-0" style={{ color: '#A6AEC0' }}>
            <ChevronRightIcon size={16} />
          </span>
        </Link>
      ))}
    </div>
  );
}
