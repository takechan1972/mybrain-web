'use client';

import Link from 'next/link';
import { useRef, useEffect, useMemo, useState } from 'react';
import VoiceInput from '@/components/VoiceInput';
import ConsultRefCards from '@/components/ConsultRefCards';
import SwipeableRow from '@/components/SwipeableRow';
import NeonQuickNav from '@/components/NeonQuickNav';
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
import { createMemoMarkdownFile } from '@/lib/markdown';
import JSZip from 'jszip';
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
  // 単一カテゴリ表示（タブ非表示）。ホームの「メモ一覧 / 予定一覧」から ?view= で遷移したとき設定。
  const [view, setView] = useState<'memos' | 'reservations' | null>(null);
  // タグ選択ポップアップ（メモ専用ビューのタグ検索）。
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  // メモの選択モード（モバイルのメモ一覧のみ・画面内ローカル・保存しない）。
  const [memoSelectMode, setMemoSelectMode] = useState(false);
  const [memoSelectedIds, setMemoSelectedIds] = useState<Set<string>>(new Set());
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
    // URL の ?view= で単一カテゴリ表示（タブを隠す）。memos=メモのみ / reservations=予定のみ。
    const rawView = new URLSearchParams(window.location.search).get('view');
    if (rawView === 'memos') {
      setView('memos');
      setTab('memos');
    } else if (rawView === 'reservations') {
      setView('reservations');
      setTab('schedule');
    }
    // URL の ?q= で検索キーワードを初期適用（ホームの検索バーから遷移時など）。
    // query を入れると既存の filteredMemos / filteredReservations / filteredTurns がそのまま絞り込む。
    const rawQ = new URLSearchParams(window.location.search).get('q');
    if (rawQ) setQuery(rawQ);
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

  // メモの選択トグル（選択モード時のみ使用・画面内ローカルのみ）。
  function toggleMemoSelected(id: string) {
    setMemoSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 選択したメモをまとめて1つのZIPファイルとして書き出す（端末のダウンロードのみ・Vault保存/アップロードはしない）。
  const MEMO_LARGE_EXPORT_WARNING_COUNT = 10;
  async function exportSelectedMemos() {
    const targets = memos.filter((m) => memoSelectedIds.has(m.id));
    if (targets.length === 0) return;
    if (targets.length >= MEMO_LARGE_EXPORT_WARNING_COUNT) {
      const proceed = window.confirm('選択数が多いため、ZIPファイルの作成に少し時間がかかる場合があります。続けますか？');
      if (!proceed) return;
    }
    const ok = window.confirm(`選択した ${targets.length} 件のメモを1つのZIPファイルとしてまとめてダウンロードします。よろしいですか？`);
    if (!ok) return;
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      targets.forEach((m) => {
        const { fileName, content } = createMemoMarkdownFile(m);
        // ファイル名の重複を避ける（同名タイトルでも上書きしない）
        let name = fileName;
        let n = 2;
        while (usedNames.has(name)) {
          name = fileName.replace(/(\.md)?$/i, `-${n}$1`);
          n += 1;
        }
        usedNames.add(name);
        zip.file(name, content);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mybrain-memos-${ymd}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`${targets.length}件をZIPで書き出しました`);
    } catch {
      showToast('ZIPの書き出しに失敗しました');
    }
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
    return memos.filter((m) => {
      const tags = m.tags ?? [];
      // タグは生の値と #付き の両方を検索対象に含める（「仕事」でも「#仕事」でもヒットする）
      const hay = `${m.title} ${m.body} ${tags.join(' ')} ${tags.map((t) => `#${t}`).join(' ')}`;
      return includesQuery(hay, q);
    });
  }, [memos, q]);

  // メモに登録済みのタグ一覧（重複除去・登場順）。メモ専用ビューのタグ検索チップに使う。
  const memoTags = useMemo(() => {
    const set = new Set<string>();
    memos.forEach((m) =>
      (m.tags ?? []).forEach((t) => {
        const s = t.trim();
        if (s) set.add(s);
      }),
    );
    return Array.from(set);
  }, [memos]);

  // 現在の検索キーワードがいずれかのタグ（"仕事" または "#仕事"）と一致していれば、そのタグを返す。
  const activeTag = memoTags.find((t) => q === `#${t}`.toLowerCase() || q === t.toLowerCase()) ?? null;

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
          {view === 'memos' ? 'メモ一覧' : view === 'reservations' ? '予定一覧' : '履歴'}
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

        {/* タグ検索（メモ専用ビュー /history?view=memos のときだけ表示・コンパクト）。
            チップは画面に直接出さず「タグを選ぶ」ボタン → ポップアップで選択する。 */}
        {view === 'memos' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTagSheetOpen(true)}
              className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition active:scale-95"
              style={{
                backgroundColor: 'rgba(59,130,246,0.14)',
                borderColor: 'rgba(96,165,250,0.30)',
                color: '#BFDBFE',
              }}>
              {/* タグ（ラベル）アイコン */}
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                <circle cx="7" cy="7" r="1.2" fill="currentColor" />
              </svg>
              タグを選ぶ
            </button>
            {activeTag && (
              <>
                <span
                  className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-bold"
                  style={{
                    background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                    color: '#fff',
                    boxShadow: '0 0 12px rgba(99,102,241,0.45)',
                  }}>
                  #{activeTag}
                </span>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-[12px] font-semibold underline-offset-2 active:opacity-60"
                  style={{ color: '#9fb0e0' }}>
                  タグ検索を解除
                </button>
              </>
            )}
          </div>
        )}

        {/* 一括エクスポートの案内（メモ一覧のみ・準備中・表示のみ。ボタンや操作は無い） */}
        {view === 'memos' && (
          <div
            className="rounded-2xl border px-4 py-3"
            style={{ borderColor: 'rgba(99,102,241,0.30)', background: 'rgba(10,14,35,0.50)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold" style={{ color: '#c7d2fe' }}>一括エクスポート</span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: 'rgba(242,213,138,0.16)', color: '#f2d58a', border: '1px solid rgba(242,213,138,0.4)' }}>
                準備中
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: '#9fb0e0' }}>
              複数のメモをまとめてObsidian用Markdownとして保存する機能を準備中です。
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: '#818cf8' }}>
              ※ 今はメモ詳細から1件ずつダウンロードできます。
            </p>
            <button
              type="button"
              onClick={() => setMemoSelectMode((o) => !o)}
              aria-pressed={memoSelectMode}
              className="mt-2.5 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition active:scale-95"
              style={{ borderColor: 'rgba(120,160,255,0.40)', color: '#c7d2fe', background: 'rgba(10,14,32,0.6)' }}>
              {memoSelectMode ? '選択終了' : '選択'}
            </button>
            {memoSelectMode && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[12px] font-semibold" style={{ color: '#c7d2fe' }}>
                  {memoSelectedIds.size}件 選択中
                </span>
                <button
                  type="button"
                  onClick={() => setMemoSelectedIds(new Set())}
                  disabled={memoSelectedIds.size === 0}
                  className="rounded-full border px-3 py-1 text-[11px] font-semibold transition active:scale-95 disabled:opacity-40"
                  style={{ borderColor: 'rgba(120,160,255,0.40)', color: '#c7d2fe', background: 'rgba(10,14,32,0.6)' }}>
                  選択解除
                </button>
                <button
                  type="button"
                  onClick={exportSelectedMemos}
                  disabled={memoSelectedIds.size === 0}
                  className="rounded-full px-3 py-1 text-[11px] font-semibold text-white transition active:scale-95 disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
                  選択メモを書き出し
                </button>
              </div>
            )}
          </div>
        )}

        {/* フィルタータブ（単一カテゴリ表示 ?view= のときは隠す） */}
        {!view && (
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
        )}

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
                    return <MemoCard key={`m-${item.data.id}`} m={item.data} showType onTagClick={(tag) => setQuery(`#${tag}`)} />;
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
                filteredMemos.map((m) => (
                  <MemoCard
                    key={m.id}
                    m={m}
                    onTagClick={(tag) => setQuery(`#${tag}`)}
                    selectMode={memoSelectMode}
                    selected={memoSelectedIds.has(m.id)}
                    onToggleSelect={toggleMemoSelected}
                  />
                ))
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
          <div
            className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-3xl"
            style={{
              background: 'rgba(20, 12, 35, 0.92)',
              border: '1px solid rgba(192, 132, 252, 0.30)',
              boxShadow: '0 0 24px rgba(217, 70, 239, 0.18), 0 20px 60px rgba(0,0,0,0.55)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
            }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${CONSULT_DIVIDER}` }}>
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ backgroundColor: CONSULT_CHIP_BG, color: CONSULT_CHIP_COLOR }}>
                  AIアシスト
                </span>
                {detailTurn.createdAt > 0 && (
                  <span className="text-[11px] font-medium" style={{ color: CONSULT_DATE_COLOR }}>
                    {formatDateTime(detailTurn.createdAt)}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setDetailTurn(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full active:opacity-60"
                style={{ color: CONSULT_CHIP_COLOR }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold" style={{ color: CONSULT_DATE_COLOR }}>
                  質問
                </span>
                <p className="text-[15px] font-semibold" style={{ color: CONSULT_TITLE_COLOR }}>{detailTurn.question}</p>
              </div>
              <div className="flex flex-col gap-1 pt-4" style={{ borderTop: `1px solid ${CONSULT_DIVIDER}` }}>
                <span className="text-[11px] font-bold" style={{ color: CONSULT_DATE_COLOR }}>
                  回答
                </span>
                <p className="whitespace-pre-line text-[14px] leading-relaxed" style={{ color: CONSULT_PREVIEW_COLOR }}>{detailTurn.answer}</p>
              </div>
              {/* 参照した予定・メモのタップ可能カード（詳細ページへ遷移） */}
              <ConsultRefCards turn={detailTurn} reservations={reservations} memos={memos} />
              <div className="flex flex-wrap items-center gap-2 pt-4 text-[11px]" style={{ color: CONSULT_CHIP_COLOR, borderTop: `1px solid ${CONSULT_DIVIDER}` }}>
                <span className="font-semibold" style={{ color: CONSULT_DATE_COLOR }}>
                  参照
                </span>
                {(detailTurn.refTarget === 'both' || detailTurn.refTarget === 'memos') && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: CONSULT_CHIP_BG, color: CONSULT_CHIP_COLOR }}>
                    <FileTextIcon size={12} />
                    メモ{typeof detailTurn.memoCount === 'number' ? ` ${detailTurn.memoCount}件` : ''}
                  </span>
                )}
                {(detailTurn.refTarget === 'both' || detailTurn.refTarget === 'schedule') && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: CONSULT_CHIP_BG, color: CONSULT_CHIP_COLOR }}>
                    <CalendarIcon size={12} />
                    予定{typeof detailTurn.scheduleCount === 'number' ? ` ${detailTurn.scheduleCount}件` : ''}
                  </span>
                )}
                <span className="ml-auto" style={{ color: CONSULT_DATE_COLOR }}>
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

      {/* タグ選択ポップアップ（メモ専用ビュー・ボトムシート・多い場合はスクロール） */}
      {tagSheetOpen && view === 'memos' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setTagSheetOpen(false)} />
          <div
            className="relative w-full max-w-md overflow-y-auto rounded-t-3xl px-5 pt-3 sm:rounded-3xl"
            style={{
              maxHeight: '70vh',
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
              background: 'rgba(16,20,42,0.96)',
              border: '1px solid rgba(120,160,255,0.28)',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.5), 0 0 24px rgba(99,102,241,0.14)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}>
            {/* グラバー */}
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-bold" style={{ color: '#ffffff' }}>タグで検索</h2>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setTagSheetOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full active:opacity-60"
                style={{ color: '#c7d2fe' }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {memoTags.length === 0 ? (
              <p className="py-6 text-center text-[13px]" style={{ color: '#9fb0e0' }}>
                タグはまだありません
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {memoTags.map((tag) => {
                    const isActive = activeTag === tag;
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-label={`タグ #${tag} で絞り込む`}
                        onClick={() => {
                          setQuery(`#${tag}`);
                          setTagSheetOpen(false);
                        }}
                        className="rounded-full border px-3 py-1.5 text-[13px] font-medium transition active:scale-95"
                        style={
                          isActive
                            ? {
                                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                                borderColor: 'transparent',
                                color: '#fff',
                                boxShadow: '0 0 12px rgba(99,102,241,0.45)',
                              }
                            : {
                                backgroundColor: 'rgba(59,130,246,0.14)',
                                borderColor: 'rgba(96,165,250,0.28)',
                                color: '#BFDBFE',
                              }
                        }>
                        #{tag}
                      </button>
                    );
                  })}
                </div>
                {activeTag && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setTagSheetOpen(false);
                    }}
                    className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-2xl text-[13px] font-bold active:opacity-70"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(120,160,255,0.3)', color: '#c7d2fe' }}>
                    タグ検索を解除
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 下部ネオンクイックナビ（メモ / 予定 / AI）。モーダル表示中は重なり防止のため非表示。 */}
      {!detailTurn && !confirmId && !tagSheetOpen && <NeonQuickNav />}
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
  variant?: 'memo' | 'schedule' | 'consult';
}) {
  const isNeon = variant === 'memo' || variant === 'schedule' || variant === 'consult';
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
      : variant === 'consult'
      ? {
          background: 'rgba(20, 12, 35, 0.72)',
          border: '1px solid rgba(192, 132, 252, 0.30)',
          boxShadow: '0 0 18px rgba(217, 70, 239, 0.12), 0 10px 28px rgba(0,0,0,0.38)',
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
      <CardShell onClick={() => onOpen(t)} ariaLabel="AIアシスト履歴の詳細を見る" variant="consult">
      <div className="flex items-center gap-2">
        {showType && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ backgroundColor: CONSULT_CHIP_BG, color: CONSULT_CHIP_COLOR }}>
            AIアシスト
          </span>
        )}
        {t.createdAt > 0 && (
          <span className="text-[11px] font-medium" style={{ color: CONSULT_DATE_COLOR }}>
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
          style={{ color: CONSULT_CHIP_COLOR }}>
          <TrashIcon size={15} />
        </button>
      </div>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[11px] font-bold" style={{ color: CONSULT_DATE_COLOR }}>
          質問
        </span>
        <p className="flex-1 text-[14px] font-semibold" style={{ color: CONSULT_TITLE_COLOR }}>{t.question}</p>
      </div>
      <div style={{ borderTop: `1px solid ${CONSULT_DIVIDER}` }} />
      <div className="flex items-start gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: CONSULT_ICON_BG, color: CONSULT_ICON_COLOR }}>
          <ChatIcon size={15} />
        </span>
        <p className="flex-1 whitespace-pre-line text-[14px] leading-relaxed" style={{ color: CONSULT_PREVIEW_COLOR }}>{t.answer}</p>
      </div>
      {/* 参照した予定・メモのタップ可能カード。リンクのタップでカードのモーダルを開かない */}
      <div onClick={(e) => e.stopPropagation()}>
        <ConsultRefCards turn={t} reservations={reservations} memos={memos} />
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-3 text-[11px]" style={{ color: CONSULT_CHIP_COLOR, borderTop: `1px solid ${CONSULT_DIVIDER}` }}>
        <span className="font-semibold" style={{ color: CONSULT_DATE_COLOR }}>
          参照
        </span>
        {(t.refTarget === 'both' || t.refTarget === 'memos') && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: CONSULT_CHIP_BG, color: CONSULT_CHIP_COLOR }}>
            <FileTextIcon size={12} />
            メモ{typeof t.memoCount === 'number' ? ` ${t.memoCount}件` : ''}
          </span>
        )}
        {(t.refTarget === 'both' || t.refTarget === 'schedule') && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: CONSULT_CHIP_BG, color: CONSULT_CHIP_COLOR }}>
            <CalendarIcon size={12} />
            予定{typeof t.scheduleCount === 'number' ? ` ${t.scheduleCount}件` : ''}
          </span>
        )}
        <span className="ml-auto" style={{ color: CONSULT_DATE_COLOR }}>
          {REF_TARGET_LABEL[t.refTarget]}
        </span>
      </div>
      </CardShell>
    </SwipeableRow>
  );
}

const CONSULT_ICON_BG = 'rgba(217, 70, 239, 0.18)';
const CONSULT_ICON_COLOR = '#e879f9';
const CONSULT_DATE_COLOR = '#c084fc';
const CONSULT_TITLE_COLOR = '#ffffff';
const CONSULT_PREVIEW_COLOR = '#e9d5ff';
const CONSULT_CHIP_BG = 'rgba(192, 132, 252, 0.18)';
const CONSULT_CHIP_COLOR = '#d8b4fe';
const CONSULT_DIVIDER = 'rgba(192, 132, 252, 0.20)';

function MemoCard({
  m,
  showType,
  onTagClick,
  selectMode,
  selected,
  onToggleSelect,
}: {
  m: Memo;
  showType?: boolean;
  onTagClick?: (tag: string) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const hasImages = Array.isArray(m.images) && m.images.length > 0;
  const preview = (m.body ?? '').trim();
  // 選択モード中はタップで選択をトグル。通常時はこれまで通りメモ詳細を開く。
  const shellProps = selectMode
    ? { onClick: () => onToggleSelect?.(m.id), ariaLabel: 'このメモを選択' }
    : { href: `/memos/${m.id}`, ariaLabel: 'メモの詳細を見る' };
  return (
    <CardShell {...shellProps} variant="memo">
      <div className="flex items-center gap-2">
        {selectMode && (
          <span
            aria-hidden
            className="text-[16px] leading-none"
            style={{ color: selected ? '#c7d2fe' : 'rgba(159,176,224,0.6)' }}>
            {selected ? '☑' : '☐'}
          </span>
        )}
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
            <button
              key={tag}
              type="button"
              aria-label={`タグ #${tag} で検索`}
              onClick={(e) => {
                // カードの詳細遷移は発火させず、検索キーワードを #タグ に設定する
                e.preventDefault();
                e.stopPropagation();
                onTagClick?.(tag);
              }}
              className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition active:scale-95"
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.14)',
                borderColor: 'rgba(96, 165, 250, 0.28)',
                color: '#BFDBFE',
              }}>
              #{tag}
            </button>
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
