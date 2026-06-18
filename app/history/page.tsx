'use client';

import Link from 'next/link';
import { useRef, useEffect, useMemo, useState } from 'react';
import VoiceInput from '@/components/VoiceInput';
import ConsultRefCards from '@/components/ConsultRefCards';
import SwipeableRow from '@/components/SwipeableRow';
import {
  CalendarIcon,
  ChatIcon,
  FileTextIcon,
  ImageIcon,
  SearchIcon,
} from '@/components/icons';
import {
  loadConsultTurns,
  saveConsultTurns,
  REF_TARGET_LABEL,
  type Turn,
} from '@/lib/consult-store';
import { listMemos } from '@/lib/memos';
import { listReservations, formatSchedule } from '@/lib/reservations';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import type { Memo, Reservation } from '@/lib/types';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const LAVENDER = '#EEF0FF';
const PURPLE = '#7B61FF';

type Tab = 'all' | 'consult' | 'memos' | 'schedule';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'consult', label: 'AIアシスト' },
  { key: 'memos', label: 'メモ' },
  { key: 'schedule', label: '予定' },
];

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 検索一致判定（大文字小文字を無視・日本語もそのまま部分一致）
function includesQuery(haystack: string, q: string): boolean {
  return haystack.toLowerCase().includes(q);
}

function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

// 「すべて」タブ用の統合アイテム
type CombinedItem =
  | { kind: 'consult'; sortAt: number; data: Turn }
  | { kind: 'memo'; sortAt: number; data: Memo }
  | { kind: 'schedule'; sortAt: number; data: Reservation };

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const voiceBaseRef = useRef('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [detailTurn, setDetailTurn] = useState<Turn | null>(null);
  // スワイプ削除：開いている行のID（同時に開くのは1つ）
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);

  // マウント後にクライアント側でのみ読み込む（SSR回避）
  useEffect(() => {
    // URL の ?tab= で初期タブを選択（all / consult / memo(s) / schedule）
    const raw = new URLSearchParams(window.location.search).get('tab');
    const map: Record<string, Tab> = {
      all: 'all',
      consult: 'consult',
      memo: 'memos',
      memos: 'memos',
      schedule: 'schedule',
    };
    if (raw && map[raw]) setTab(map[raw]);
    // AI相談：localStorage（相談画面と同一キー）
    setTurns(loadConsultTurns());
    setLoaded(true);
    // メモ・予定：Supabase（メモ画面・予定画面と同一データソース）
    if (isSupabaseConfigured()) {
      void listMemos().then(({ memos }) => setMemos(memos));
      void listReservations().then(({ reservations }) => setReservations(reservations));
    }
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }

  function confirmDelete() {
    if (!confirmId) return;
    setTurns((prev) => {
      const next = prev.filter((t) => t.id !== confirmId);
      saveConsultTurns(next); // 相談画面と同じ localStorage を更新
      return next;
    });
    setConfirmId(null);
    setOpenSwipeId(null); // スワイプ削除を閉じる
    showToast('削除しました');
  }

  // 検索クエリ（前後空白を除去・小文字化）。空なら検索なし。
  const q = query.trim().toLowerCase();

  // 各種別を検索クエリで絞り込み（タブ別の対象フィールド）
  const filteredTurns = useMemo(() => {
    if (!q) return turns;
    return turns.filter((t) =>
      includesQuery(`${t.question} ${t.answer} ${REF_TARGET_LABEL[t.refTarget]}`, q),
    );
  }, [turns, q]);

  const filteredMemos = useMemo(() => {
    if (!q) return memos;
    return memos.filter((m) =>
      includesQuery(`${m.title} ${m.body} ${(m.tags ?? []).join(' ')}`, q),
    );
  }, [memos, q]);

  const filteredReservations = useMemo(() => {
    if (!q) return reservations;
    return reservations.filter((r) =>
      includesQuery(`${r.title} ${r.content} ${formatSchedule(r.scheduleAt)}`, q),
    );
  }, [reservations, q]);

  // 「すべて」タブ：3種（検索後）を日時の新しい順に統合（日時なしは末尾）
  const combined = useMemo<CombinedItem[]>(() => {
    const items: CombinedItem[] = [
      ...filteredTurns.map((t) => ({ kind: 'consult' as const, sortAt: t.createdAt, data: t })),
      ...filteredMemos.map((m) => ({ kind: 'memo' as const, sortAt: m.createdAt || m.updatedAt, data: m })),
      ...filteredReservations.map((r) => ({
        kind: 'schedule' as const,
        sortAt: r.scheduleAt ?? r.createdAt,
        data: r,
      })),
    ];
    // 日時(0=不明)は末尾へ。それ以外は新しい順。
    return items.sort((a, b) => {
      if (a.sortAt === 0 && b.sortAt === 0) return 0;
      if (a.sortAt === 0) return 1;
      if (b.sortAt === 0) return -1;
      return b.sortAt - a.sortAt;
    });
  }, [filteredTurns, filteredMemos, filteredReservations]);

  const searching = q.length > 0;

  return (
    <>
      {/* 宇宙背景（haikei.png）。全ビューポートを覆う固定レイヤー */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen"
        style={{
          backgroundColor: '#050716',
          backgroundImage: "url('/haikei.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
        }}
      />
      {/* 可読性確保の暗オーバーレイ */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen"
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,7,22,0.30) 0%, rgba(5,7,22,0.55) 45%, rgba(5,7,22,0.92) 100%)',
        }}
      />

      <div
        className="relative z-10 flex flex-col gap-5"
        style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
        <h1 className="text-[22px] font-bold" style={{ color: '#ffffff' }}>
          履歴
        </h1>

        {/* 検索バー */}
        <div
          className="flex items-center gap-2 rounded-full px-4 py-2.5"
          style={{
            background: 'rgba(10,14,35,0.65)',
            border: '1px solid rgba(99,102,241,0.30)',
            boxShadow: '0 0 12px rgba(99,102,241,0.08) inset',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}>
          <span className="shrink-0" style={{ color: '#6366f1' }}>
            <SearchIcon size={18} />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="履歴を検索..."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#4f5a8a]"
            style={{ color: '#e0e7ff', caretColor: '#818cf8' }}
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label="検索をクリア"
              onClick={() => setQuery('')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white active:opacity-70"
              style={{ backgroundColor: 'rgba(99,102,241,0.40)' }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
          {/* 音声入力ボタン。非対応ブラウザでは VoiceInput が null を返す（iconOnly時） */}
          <VoiceInput
            iconOnly
            onResult={(t) => setQuery(t)}
            getInitial={() => {
              voiceBaseRef.current = query;
              return query;
            }}
          />
        </div>

        {/* フィルタータブ */}
        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition"
                style={
                  active
                    ? {
                        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                        color: '#fff',
                        boxShadow: '0 0 14px rgba(99,102,241,0.45)',
                      }
                    : {
                        background: 'rgba(10,14,35,0.55)',
                        color: '#818cf8',
                        border: '1px solid rgba(99,102,241,0.22)',
                      }
                }>
                {t.label}
              </button>
            );
          })}
        </div>

      {!loaded ? null : (
        <>
          {/* すべて */}
          {tab === 'all' &&
            (combined.length === 0 ? (
              searching ? (
                <NoSearchResult />
              ) : (
                <EmptyState title="履歴はまだありません" desc="メモ・予定・AIアシストを使うと、ここに表示されます。" />
              )
            ) : (
              <section className="flex flex-col gap-3">
                {combined.map((item) => {
                  if (item.kind === 'consult')
                    return (
                      <ConsultCard
                        key={`c-${item.data.id}`}
                        t={item.data}
                        onDelete={setConfirmId}
                        onOpen={setDetailTurn}
                        reservations={reservations}
                        memos={memos}
                        showType
                        swipeOpen={openSwipeId === item.data.id}
                        onSwipeOpenChange={(o) => setOpenSwipeId(o ? item.data.id : null)}
                      />
                    );
                  if (item.kind === 'memo')
                    return <MemoCard key={`m-${item.data.id}`} m={item.data} showType />;
                  return <ScheduleCard key={`s-${item.data.id}`} r={item.data} showType />;
                })}
              </section>
            ))}

          {/* AI相談 */}
          {tab === 'consult' && (
            <section className="flex flex-col gap-3">
              <SectionLabel>AIアシスト履歴</SectionLabel>
              {turns.length === 0 ? (
                <EmptyState title="AIアシスト履歴はまだありません" desc="AIアシストを使うと、ここに履歴が表示されます。" />
              ) : filteredTurns.length === 0 ? (
                <NoSearchResult />
              ) : (
                filteredTurns.map((t) => (
                  <ConsultCard
                    key={t.id}
                    t={t}
                    onDelete={setConfirmId}
                    onOpen={setDetailTurn}
                    reservations={reservations}
                    memos={memos}
                    swipeOpen={openSwipeId === t.id}
                    onSwipeOpenChange={(o) => setOpenSwipeId(o ? t.id : null)}
                  />
                ))
              )}
            </section>
          )}

          {/* メモ */}
          {tab === 'memos' && (
            <section className="flex flex-col gap-3">
              <SectionLabel>メモ履歴</SectionLabel>
              {memos.length === 0 ? (
                <EmptyState title="メモ履歴はまだありません" desc="メモを作成すると、ここに履歴が表示されます。" />
              ) : filteredMemos.length === 0 ? (
                <NoSearchResult />
              ) : (
                filteredMemos.map((m) => <MemoCard key={m.id} m={m} />)
              )}
            </section>
          )}

          {/* 予定 */}
          {tab === 'schedule' && (
            <section className="flex flex-col gap-3">
              <SectionLabel>予定履歴</SectionLabel>
              {reservations.length === 0 ? (
                <EmptyState title="予定履歴はまだありません" desc="予定を追加すると、ここに履歴が表示されます。" />
              ) : filteredReservations.length === 0 ? (
                <NoSearchResult />
              ) : (
                filteredReservations.map((r) => <ScheduleCard key={r.id} r={r} />)
              )}
            </section>
          )}
        </>
      )}

      {/* AI相談 詳細モーダル（詳細ルートが無いためモーダルで全文表示） */}
      {detailTurn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-6 sm:items-center sm:pb-0">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailTurn(null)} />
          <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-[#E5E8F0] bg-white shadow-[0_20px_60px_rgba(31,53,104,0.18)]">
            <div className="flex items-center justify-between border-b border-[#EEF0F5] px-5 py-4">
              <div className="flex items-center gap-2">
                <TypeBadge label="AIアシスト" color={NAVY} />
                {detailTurn.createdAt > 0 && (
                  <span className="text-[11px] font-medium" style={{ color: '#A6AEC0' }}>
                    {formatDateTime(detailTurn.createdAt)}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setDetailTurn(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full active:opacity-60"
                style={{ color: '#8A94A6' }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold" style={{ color: '#A6AEC0' }}>
                  質問
                </span>
                <p className="text-[15px] font-semibold text-[#1F2937]">{detailTurn.question}</p>
              </div>
              <div className="flex flex-col gap-1 border-t border-[#EEF0F5] pt-4">
                <span className="text-[11px] font-bold" style={{ color: '#A6AEC0' }}>
                  回答
                </span>
                <p className="whitespace-pre-line text-[14px] leading-relaxed text-[#1F2937]">{detailTurn.answer}</p>
              </div>
              {/* 参照した予定・メモのタップ可能カード（詳細ページへ遷移） */}
              <ConsultRefCards turn={detailTurn} reservations={reservations} memos={memos} />
              <div className="flex flex-wrap items-center gap-2 border-t border-[#EEF0F5] pt-4 text-[11px]" style={{ color: MUTED }}>
                <span className="font-semibold" style={{ color: '#A6AEC0' }}>
                  参照
                </span>
                {(detailTurn.refTarget === 'both' || detailTurn.refTarget === 'memos') && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: LAVENDER, color: NAVY }}>
                    <FileTextIcon size={12} />
                    メモ{typeof detailTurn.memoCount === 'number' ? ` ${detailTurn.memoCount}件` : ''}
                  </span>
                )}
                {(detailTurn.refTarget === 'both' || detailTurn.refTarget === 'schedule') && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: LAVENDER, color: NAVY }}>
                    <CalendarIcon size={12} />
                    予定{typeof detailTurn.scheduleCount === 'number' ? ` ${detailTurn.scheduleCount}件` : ''}
                  </span>
                )}
                <span className="ml-auto" style={{ color: '#A6AEC0' }}>
                  {REF_TARGET_LABEL[detailTurn.refTarget]}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認ダイアログ（AI相談のみ） */}
      {confirmId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-10">
          <div className="absolute inset-0 bg-black/30" onClick={() => setConfirmId(null)} />
          <div className="relative w-full max-w-md rounded-3xl border border-[#E5E8F0] bg-white p-6 shadow-[0_20px_60px_rgba(31,53,104,0.18)]">
            <p className="text-center text-[15px] font-bold" style={{ color: NAVY }}>
              このAIアシスト履歴を削除しますか？
            </p>
            <p className="mt-1 text-center text-[12px]" style={{ color: MUTED }}>
              この操作は元に戻せません。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmId(null)}
                className="flex-1 rounded-full border border-[#E5E8F0] py-3 text-[14px] font-semibold"
                style={{ color: MUTED }}>
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="flex-1 rounded-full py-3 text-[14px] font-semibold text-white"
                style={{ backgroundColor: '#E05555' }}>
                削除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* トースト */}
      {toast && (
        <div className="fixed inset-x-0 bottom-28 z-40 mx-auto w-full max-w-md px-5">
          <div className="rounded-full bg-[#1F2937] px-4 py-2.5 text-center text-[13px] text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}
      </div>
    </>
  );
}

// ── 部品 ────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[12px] font-semibold" style={{ color: '#818cf8' }}>
      {children}
    </span>
  );
}

function TypeBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
      style={{ backgroundColor: LAVENDER, color }}>
      {label}
    </span>
  );
}

function CardShell({
  children,
  href,
  onClick,
  ariaLabel,
  variant,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
  variant?: 'memo' | 'schedule';
}) {
  const isNeon = variant === 'memo' || variant === 'schedule';
  const base = isNeon
    ? 'flex flex-col gap-3 rounded-3xl p-5'
    : 'flex flex-col gap-3 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]';
  const memoStyle: React.CSSProperties =
    variant === 'memo'
      ? {
          background: 'rgba(10, 14, 35, 0.72)',
          border: '1px solid rgba(99, 102, 241, 0.30)',
          boxShadow: '0 0 18px rgba(99, 102, 241, 0.12), 0 10px 28px rgba(0,0,0,0.38)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }
      : variant === 'schedule'
      ? {
          background: 'rgba(10, 18, 38, 0.72)',
          border: '1px solid rgba(56, 189, 248, 0.30)',
          boxShadow: '0 0 18px rgba(56, 189, 248, 0.12), 0 10px 28px rgba(0,0,0,0.38)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }
      : {};
  const tappable = `${base} relative z-10 min-h-[44px] cursor-pointer text-left transition active:opacity-60`;
  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={tappable} style={memoStyle}>
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        className={tappable}
        style={memoStyle}>
        {children}
      </div>
    );
  }
  return <div className={base} style={memoStyle}>{children}</div>;
}

function ConsultCard({
  t,
  onDelete,
  onOpen,
  reservations,
  memos,
  showType,
  swipeOpen,
  onSwipeOpenChange,
}: {
  t: Turn;
  onDelete: (id: string) => void;
  onOpen: (t: Turn) => void;
  reservations: Reservation[];
  memos: Memo[];
  showType?: boolean;
  swipeOpen: boolean;
  onSwipeOpenChange: (open: boolean) => void;
}) {
  return (
    <SwipeableRow open={swipeOpen} onOpenChange={onSwipeOpenChange} onDelete={() => onDelete(t.id)}>
      <CardShell onClick={() => onOpen(t)} ariaLabel="AIアシスト履歴の詳細を見る">
      <div className="flex items-center gap-2">
        {showType && <TypeBadge label="AIアシスト" color={NAVY} />}
        {t.createdAt > 0 && (
          <span className="text-[11px] font-medium" style={{ color: '#A6AEC0' }}>
            {formatDateTime(t.createdAt)}
          </span>
        )}
        <button
          type="button"
          aria-label="この相談履歴を削除"
          onClick={(e) => {
            // カードのタップ（詳細表示）を発火させず、削除のみ実行
            e.stopPropagation();
            onDelete(t.id);
          }}
          className="-mr-2 ml-auto hidden h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:opacity-50 md:flex"
          style={{ color: '#C0C8D8' }}>
          <TrashIcon size={15} />
        </button>
      </div>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[11px] font-bold" style={{ color: '#A6AEC0' }}>
          質問
        </span>
        <p className="flex-1 text-[14px] font-semibold text-[#1F2937]">{t.question}</p>
      </div>
      <div className="border-t border-[#EEF0F5]" />
      <div className="flex items-start gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: LAVENDER, color: NAVY }}>
          <ChatIcon size={15} />
        </span>
        <p className="flex-1 whitespace-pre-line text-[14px] leading-relaxed text-[#1F2937]">{t.answer}</p>
      </div>
      {/* 参照した予定・メモのタップ可能カード。リンクのタップでカードのモーダルを開かない */}
      <div onClick={(e) => e.stopPropagation()}>
        <ConsultRefCards turn={t} reservations={reservations} memos={memos} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[#EEF0F5] pt-3 text-[11px]" style={{ color: MUTED }}>
        <span className="font-semibold" style={{ color: '#A6AEC0' }}>
          参照
        </span>
        {(t.refTarget === 'both' || t.refTarget === 'memos') && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: LAVENDER, color: NAVY }}>
            <FileTextIcon size={12} />
            メモ{typeof t.memoCount === 'number' ? ` ${t.memoCount}件` : ''}
          </span>
        )}
        {(t.refTarget === 'both' || t.refTarget === 'schedule') && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: LAVENDER, color: NAVY }}>
            <CalendarIcon size={12} />
            予定{typeof t.scheduleCount === 'number' ? ` ${t.scheduleCount}件` : ''}
          </span>
        )}
        <span className="ml-auto" style={{ color: '#A6AEC0' }}>
          {REF_TARGET_LABEL[t.refTarget]}
        </span>
      </div>
      </CardShell>
    </SwipeableRow>
  );
}

function MemoCard({ m, showType }: { m: Memo; showType?: boolean }) {
  const hasImages = Array.isArray(m.images) && m.images.length > 0;
  const preview = (m.body ?? '').trim();
  return (
    <CardShell href={`/memos/${m.id}`} ariaLabel="メモの詳細を見る" variant="memo">
      <div className="flex items-center gap-2">
        {showType && <TypeBadge label="メモ" color={PURPLE} />}
        {m.createdAt > 0 && (
          <span className="text-[11px] font-medium" style={{ color: '#A8B5FF' }}>
            {formatDateTime(m.createdAt)}
          </span>
        )}
        {hasImages && (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
            style={{
              color: '#C4B5FD',
              borderColor: 'rgba(167, 139, 250, 0.38)',
              backgroundColor: 'rgba(91, 33, 182, 0.20)',
            }}>
            <ImageIcon size={13} />
            {m.images.length}
          </span>
        )}
      </div>
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border"
          style={{
            backgroundColor: 'rgba(99, 102, 241, 0.18)',
            borderColor: 'rgba(129, 140, 248, 0.42)',
            color: '#C4B5FD',
            boxShadow: '0 0 16px rgba(129, 140, 248, 0.24)',
          }}>
          <FileTextIcon size={16} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-[14px] font-bold text-white">{m.title || '無題のメモ'}</p>
          {preview.length > 0 && (
            <p className="line-clamp-2 text-[13px] leading-relaxed" style={{ color: '#C7D2FE' }}>
              {preview}
            </p>
          )}
        </div>
      </div>
      {Array.isArray(m.tags) && m.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t pt-3" style={{ borderColor: 'rgba(129, 140, 248, 0.22)' }}>
          {m.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.14)',
                borderColor: 'rgba(96, 165, 250, 0.28)',
                color: '#BFDBFE',
              }}>
              #{tag}
            </span>
          ))}
        </div>
      )}
    </CardShell>
  );
}

const SCHEDULE_ICON_BG = 'rgba(56, 189, 248, 0.18)';
const SCHEDULE_ICON_COLOR = '#38bdf8';
const SCHEDULE_DATE_COLOR = '#38bdf8';
const SCHEDULE_TITLE_COLOR = '#ffffff';
const SCHEDULE_PREVIEW_COLOR = '#bae6fd';
const SCHEDULE_CHIP_BG = 'rgba(56, 189, 248, 0.18)';
const SCHEDULE_CHIP_COLOR = '#7dd3fc';

function ScheduleCard({ r, showType }: { r: Reservation; showType?: boolean }) {
  const detail = (r.content ?? '').trim();
  return (
    <CardShell href={`/reservations/${r.id}`} ariaLabel="予定の詳細を見る" variant="schedule">
      <div className="flex items-center gap-2">
        {showType && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ backgroundColor: SCHEDULE_CHIP_BG, color: SCHEDULE_CHIP_COLOR }}>
            予定
          </span>
        )}
        <span className="text-[11px] font-medium" style={{ color: SCHEDULE_DATE_COLOR }}>
          {formatSchedule(r.scheduleAt)}
        </span>
        {r.notificationEnabled && (
          <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: SCHEDULE_CHIP_BG, color: SCHEDULE_CHIP_COLOR }}>
            通知ON
          </span>
        )}
      </div>
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: SCHEDULE_ICON_BG, color: SCHEDULE_ICON_COLOR }}>
          <CalendarIcon size={16} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-[14px] font-bold" style={{ color: SCHEDULE_TITLE_COLOR }}>{r.title || '無題の予定'}</p>
          {detail.length > 0 && (
            <p className="line-clamp-2 text-[13px] leading-relaxed" style={{ color: SCHEDULE_PREVIEW_COLOR }}>
              {detail}
            </p>
          )}
        </div>
      </div>
    </CardShell>
  );
}

function NoSearchResult() {
  return (
    <section
      className="flex flex-col items-center gap-2 rounded-3xl border border-dashed px-5 py-10 text-center"
      style={{ borderColor: 'rgba(99,102,241,0.30)', background: 'rgba(10,14,35,0.50)' }}>
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: 'rgba(99,102,241,0.18)', color: '#818cf8' }}>
        <SearchIcon size={24} />
      </span>
      <p className="text-[14px] font-bold" style={{ color: '#e0e7ff' }}>
        検索結果がありません
      </p>
      <p className="text-[12px]" style={{ color: '#818cf8' }}>
        別のキーワードで検索してください。
      </p>
    </section>
  );
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <section
      className="flex flex-col items-center gap-2 rounded-3xl border border-dashed px-5 py-10 text-center"
      style={{ borderColor: 'rgba(99,102,241,0.30)', background: 'rgba(10,14,35,0.50)' }}>
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: 'rgba(99,102,241,0.18)', color: '#818cf8' }}>
        <ChatIcon size={24} />
      </span>
      <p className="text-[14px] font-bold" style={{ color: '#e0e7ff' }}>
        {title}
      </p>
      <p className="text-[12px]" style={{ color: '#818cf8' }}>
        {desc}
      </p>
    </section>
  );
}
