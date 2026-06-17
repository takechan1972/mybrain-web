'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import VoiceInput from '@/components/VoiceInput';
import {
  CalendarIcon,
  ChatIcon,
  ChevronLeftIcon,
  FileTextIcon,
  SendIcon,
} from '@/components/icons';
import ConsultRefCards from '@/components/ConsultRefCards';
import {
  loadConsultTurns,
  saveConsultTurns,
  type RefTarget,
  type Turn,
} from '@/lib/consult-store';
import { buildConsultAnswer } from '@/lib/consult-engine';
import { loadOllamaSettings } from '@/lib/ai/ollama';
import { askOllamaConsult } from '@/lib/ai/consult-ollama';
import { isLocalHost } from '@/lib/env';
import { safeUUID } from '@/lib/uuid';
import { listMemos } from '@/lib/memos';
import { listReservations } from '@/lib/reservations';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import type { Memo, Reservation } from '@/lib/types';
import DesktopConsult from '@/components/DesktopConsult';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const LAVENDER = '#EEF0FF';

const REF_OPTIONS: { key: RefTarget; label: string }[] = [
  { key: 'both', label: 'メモ＋予定' },
  { key: 'memos', label: 'メモ' },
  { key: 'schedule', label: '予定' },
];

const SUGGESTIONS = ['今日を要約', '最近のメモを整理', '次に何をすべき？', 'アイデアを作る'];

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

export default function ConsultPage() {
  const [refTarget, setRefTarget] = useState<RefTarget>('both');
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const baseRef = useRef('');

  // マウント後にクライアント側でのみ履歴（localStorage）と参照データ（Supabase）を読み込む
  useEffect(() => {
    setTurns(loadConsultTurns());
    setLoaded(true);
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setText(q);
    if (!isSupabaseConfigured()) return;

    const isDev = process.env.NODE_ENV !== 'production';
    // 最新のメモ・予定を取得（保存直後に相談画面へ来ても古いデータを参照しないよう毎回再取得）
    const loadData = () => {
      void listMemos().then(({ memos }) => {
        setMemos(memos);
        if (isDev) {
          const latest = [...memos].sort(
            (a, b) => Math.max(b.createdAt || 0, b.updatedAt || 0) - Math.max(a.createdAt || 0, a.updatedAt || 0),
          )[0];
          console.log('[consult] memos fetched:', {
            total: memos.length,
            latestTitle: latest?.title ?? '(none)',
            latestBodyLength: latest?.body?.length ?? 0,
          });
        }
      });
      void listReservations().then(({ reservations }) => {
        setReservations(reservations);
        if (isDev) {
          const latest = [...reservations].sort((a, b) => (b.scheduleAt ?? 0) - (a.scheduleAt ?? 0))[0];
          console.log('[consult] reservations fetched:', {
            total: reservations.length,
            latestTitle: latest?.title ?? '(none)',
            latestScheduleAt: latest?.scheduleAt ? new Date(latest.scheduleAt).toISOString() : '(none)',
          });
        }
      });
    };
    loadData();
    // 他画面（予定保存など）から戻ってきたら最新を再取得（古い予定を参照し続けない）
    const onFocus = () => loadData();
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadData();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 履歴が変わるたびに localStorage へ保存（初回ロード完了後のみ）
  useEffect(() => {
    if (!loaded) return;
    saveConsultTurns(turns);
  }, [turns, loaded]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }

  async function send(question: string) {
    const q = question.trim();
    if (q.length === 0) return;
    try {
      // ローカルのルールエンジンで参照データの抽出（参照カード/件数用）。
      const { answer: localAnswer, memoCount, scheduleCount, scheduleIds, memoIds } =
        buildConsultAnswer(q, refTarget, memos, reservations);

      // Ollama 連携が有効ならローカル Ollama で回答を生成（PCローカル利用）。
      // 失敗時はローカル回答にフォールバックする。
      let answer = localAnswer;
      const ollama = loadOllamaSettings();
      // Ollama はPCローカル環境でのみ実行（Vercel公開版ではローカル回答のまま）
      const useOllama = ollama.enabled && isLocalHost();
      if (useOllama) {
        showToast('Ollama で考えています…');
        try {
          const aiAnswer = await askOllamaConsult(q, refTarget, memos, reservations, ollama);
          if (aiAnswer.trim().length > 0) answer = aiAnswer.trim();
        } catch (err) {
          console.error('[consult] Ollama 失敗。ローカル回答にフォールバック:', err);
          showToast('Ollamaに接続できませんでした。ローカル回答を表示します。');
        }
      }

      setTurns((prev) => [
        {
          id: safeUUID(),
          question: q,
          answer,
          refTarget,
          createdAt: Date.now(),
          memoCount,
          scheduleCount,
          scheduleIds,
          memoIds,
        },
        ...prev,
      ]);
      setText('');
      if (!useOllama) showToast('回答を作成しました');
    } catch (e) {
      console.error('[consult] 回答生成に失敗しました:', e);
      showToast('メモの読み込み中に問題が発生しました。保存データを確認してください。');
    }
  }

  function requestDelete(id: string) {
    setConfirmId(id);
  }

  function confirmDelete() {
    if (!confirmId) return;
    setTurns((prev) => prev.filter((t) => t.id !== confirmId));
    setConfirmId(null);
    showToast('削除しました');
  }

  function cancelDelete() {
    setConfirmId(null);
  }

  return (
    <>
    <DesktopConsult />
    <div className="flex flex-col gap-5 lg:hidden">
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
          AI相談
        </h1>
        <span className="h-9 w-9" />
      </header>

      {/* 紹介カード */}
      <section className="flex items-start gap-3 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: LAVENDER, color: NAVY }}>
          <ChatIcon size={24} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-bold" style={{ color: NAVY }}>
            保存したメモや予定をもとに相談
          </p>
          <p className="text-[13px] leading-relaxed" style={{ color: MUTED }}>
            あなたの考え・タスク・予定の整理を、第二の脳がお手伝いします。
          </p>
        </div>
      </section>

      {/* 参照先セレクター */}
      <section className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold" style={{ color: MUTED }}>
          AIが参照する情報
        </span>
        <div className="flex rounded-full bg-[#F3F5FA] p-1">
          {REF_OPTIONS.map((opt) => {
            const active = refTarget === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRefTarget(opt.key)}
                className="flex-1 rounded-full py-2 text-[13px] font-semibold transition"
                style={
                  active
                    ? { backgroundColor: NAVY, color: '#fff', boxShadow: '0 4px 12px rgba(34,58,112,0.25)' }
                    : { color: MUTED }
                }>
                {opt.label}
              </button>
            );
          })}
        </div>
        <span className="text-[11px]" style={{ color: '#A6AEC0' }}>
          ※ AIの回答は保存されたデータをもとに生成されます。
        </span>
      </section>

      {/* 入力エリア */}
      <section className="flex items-center gap-3 rounded-full border border-[#E5E8F0] bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(31,53,104,0.10)]">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: LAVENDER, color: NAVY }}>
          <ChatIcon size={22} />
        </span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send(text);
          }}
          placeholder="メモや予定についてAIに質問..."
          className="min-w-0 flex-1 bg-transparent text-sm text-[#1F2937] outline-none placeholder:text-[#8A94A6]"
        />
        <VoiceInput
          iconOnly
          onResult={(t) => setText(t)}
          getInitial={() => {
            baseRef.current = text;
            return text;
          }}
        />
        <button
          type="button"
          aria-label="AIに送信"
          onClick={() => send(text)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: '#7B61FF' }}>
          <SendIcon size={18} />
        </button>
      </section>

      {/* クイック候補チップ */}
      <section className="mt-1 flex flex-col gap-2">
        <span className="text-[12px] font-semibold" style={{ color: MUTED }}>
          かんたん相談
        </span>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-[#E5E8F0] bg-white px-3.5 py-2 text-[12px] font-medium shadow-sm active:opacity-70"
              style={{ color: NAVY }}>
              {s}
            </button>
          ))}
        </div>
      </section>

      {/* 回答エリア */}
      {turns.length === 0 ? (
        <section className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-[#E5E8F0] bg-white/60 px-5 py-10 text-center">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: LAVENDER, color: NAVY }}>
            <ChatIcon size={24} />
          </span>
          <p className="text-[14px] font-bold" style={{ color: NAVY }}>
            まだ相談はありません
          </p>
          <p className="text-[12px]" style={{ color: MUTED }}>
            質問を入力すると、ここにAIの回答が表示されます。
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          {turns.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-3 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
              {/* ヘッダー行：質問＋削除ボタン */}
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-[11px] font-bold" style={{ color: '#A6AEC0' }}>
                  質問
                </span>
                <p className="flex-1 text-[14px] font-semibold text-[#1F2937]">{t.question}</p>
                {/* タップターゲット 40px、アイコンは視覚的に小さく保つ */}
                <button
                  type="button"
                  aria-label="この相談履歴を削除"
                  onClick={() => requestDelete(t.id)}
                  className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:opacity-50"
                  style={{ color: '#C0C8D8' }}>
                  <TrashIcon size={15} />
                </button>
              </div>
              <div className="border-t border-[#EEF0F5]" />
              {/* AIの回答 */}
              <div className="flex items-start gap-2">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: LAVENDER, color: NAVY }}>
                  <ChatIcon size={15} />
                </span>
                <p className="flex-1 whitespace-pre-line text-[14px] leading-relaxed text-[#1F2937]">{t.answer}</p>
              </div>
              {/* 参照した予定・メモのタップ可能カード（詳細ページへ遷移） */}
              <ConsultRefCards turn={t} reservations={reservations} memos={memos} />
              {/* 参照先（件数つき） */}
              <div className="flex flex-wrap items-center gap-2 border-t border-[#EEF0F5] pt-3 text-[11px]" style={{ color: MUTED }}>
                <span className="font-semibold" style={{ color: '#A6AEC0' }}>
                  参照
                </span>
                {(t.refTarget === 'both' || t.refTarget === 'memos') && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                    style={{ backgroundColor: LAVENDER, color: NAVY }}>
                    <FileTextIcon size={12} />
                    メモ{typeof t.memoCount === 'number' ? ` ${t.memoCount}件` : ''}
                  </span>
                )}
                {(t.refTarget === 'both' || t.refTarget === 'schedule') && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                    style={{ backgroundColor: LAVENDER, color: NAVY }}>
                    <CalendarIcon size={12} />
                    予定{typeof t.scheduleCount === 'number' ? ` ${t.scheduleCount}件` : ''}
                  </span>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 削除確認ダイアログ */}
      {confirmId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-10">
          {/* オーバーレイ */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={cancelDelete}
          />
          {/* ダイアログ本体 */}
          <div className="relative w-full max-w-md rounded-3xl border border-[#E5E8F0] bg-white p-6 shadow-[0_20px_60px_rgba(31,53,104,0.18)]">
            <p className="text-center text-[15px] font-bold" style={{ color: NAVY }}>
              この相談履歴を削除しますか？
            </p>
            <p className="mt-1 text-center text-[12px]" style={{ color: MUTED }}>
              削除すると元に戻せません。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={cancelDelete}
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
