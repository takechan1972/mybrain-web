'use client';

import Link from 'next/link';
import NextImage from 'next/image';
import { useEffect, useRef, useState } from 'react';
import VoiceInput from '@/components/VoiceInput';
import {
  CalendarIcon,
  ChatIcon,
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

const MUTED = '#8A94A6';

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
  // ホーム→AIアシスト（/ai-assist?q=）から ?q= で来たときの自動実行用
  const [dataReady, setDataReady] = useState(false);
  const autoRunDoneRef = useRef(false);
  const pendingQRef = useRef<string | null>(null);

  // マウント後にクライアント側でのみ履歴（localStorage）と参照データ（Supabase）を読み込む
  useEffect(() => {
    setTurns(loadConsultTurns());
    setLoaded(true);
    // ?q= は URLSearchParams が安全にデコード。入力欄へ反映しつつ自動実行用に保持。
    const q = (new URLSearchParams(window.location.search).get('q') ?? '').trim();
    if (q) {
      setText(q);
      pendingQRef.current = q;
    }
    if (!isSupabaseConfigured()) {
      // 参照データが無い環境でも自動実行できるよう準備完了にする
      setDataReady(true);
      return;
    }

    const isDev = process.env.NODE_ENV !== 'production';
    // 最新のメモ・予定を取得（保存直後に相談画面へ来ても古いデータを参照しないよう毎回再取得）
    const loadData = () => {
      const p1 = listMemos().then(({ memos }) => {
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
      const p2 = listReservations().then(({ reservations }) => {
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
      // メモ・予定の取得が揃ってから自動実行できるよう準備完了フラグを立てる
      void Promise.allSettled([p1, p2]).then(() => setDataReady(true));
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

  // ?q= で来たときの自動実行：参照データの読み込み完了後に一度だけ send() する。
  // - autoRunDoneRef で再レンダー／StrictMode の二重実行を防止
  // - q の値を直接 send() に渡す（text ステートの更新完了を待たない）
  // - q が無い／空のときは何もしない（手動入力には影響しない）
  useEffect(() => {
    if (autoRunDoneRef.current) return;
    if (!dataReady) return;
    const q = pendingQRef.current;
    if (!q) return;
    autoRunDoneRef.current = true;
    pendingQRef.current = null;
    void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady]);

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
    {/* ── スマホ／タブレット（lg未満）：ネオン宇宙UI（メモ／予定／AIアシストと統一） ── */}
    <div className="relative min-h-[100svh] w-full overflow-x-hidden bg-[#050716] lg:hidden">
      {/* 宇宙背景（全ビューポート固定・端に白を出さない） */}
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
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen"
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,7,22,0.25) 0%, rgba(5,7,22,0.50) 45%, rgba(5,7,22,0.92) 100%)',
        }}
      />

      <div className="relative z-10 flex flex-col gap-5 px-1 pb-4 pt-3">
        {/* 上部：公式ロゴ（透過版・他画面と統一） */}
        <header className="relative mt-1 flex flex-col items-center pt-2">
          <NextImage
            src="/mybrain-original-logo-transparent.png"
            alt="MYBRAIN マイブレイン"
            width={556}
            height={508}
            className="h-auto object-contain"
            style={{ width: 'clamp(210px, 58vw, 300px)' }}
            priority
          />
          <p className="mt-1 text-[13px] font-bold tracking-[0.08em]" style={{ color: 'rgba(170,200,255,0.85)' }}>
            AIアシスト
          </p>
        </header>

        {/* 参照先セレクター */}
        <div className="flex flex-col gap-2">
          <span className="px-1 text-[12px] font-semibold" style={{ color: 'rgba(170,200,255,0.85)' }}>
            AIが参照する情報
          </span>
          <div className="flex gap-2 rounded-full p-1"
            style={{ background: 'rgba(10,14,32,0.7)', border: '1px solid rgba(120,160,255,0.3)' }}>
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
                      ? { background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', color: '#fff', boxShadow: '0 4px 14px rgba(60,120,255,0.4)' }
                      : { color: 'rgba(255,255,255,0.7)' }
                  }>
                  {opt.label}
                </button>
              );
            })}
          </div>
          <span className="px-1 text-[11px]" style={{ color: '#7A86A8' }}>
            ※ AIの回答は保存されたデータをもとに生成されます。
          </span>
        </div>

        {/* 入力エリア */}
        <div className="flex items-center gap-2 rounded-2xl border px-3 py-2.5"
          style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(120,160,255,0.4)', boxShadow: '0 0 18px rgba(80,140,255,0.1) inset' }}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send(text);
            }}
            placeholder="メモや予定についてAIに質問..."
            className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-[#7A86A8]"
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition active:scale-95"
            style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 4px 14px rgba(60,120,255,0.45)' }}>
            <SendIcon size={18} />
          </button>
        </div>

        {/* クイック候補チップ */}
        <div className="mt-1 flex flex-col gap-2">
          <span className="px-1 text-[12px] font-semibold" style={{ color: 'rgba(170,200,255,0.85)' }}>
            かんたん相談
          </span>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => send(sug)}
                className="rounded-full border px-3.5 py-2 text-[12px] font-medium transition active:scale-95"
                style={{ background: 'rgba(20,28,60,0.5)', borderColor: 'rgba(120,160,255,0.3)', color: 'rgba(220,230,255,0.9)' }}>
                {sug}
              </button>
            ))}
          </div>
        </div>

        {/* 回答エリア */}
        {turns.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed px-5 py-10 text-center"
            style={{ borderColor: 'rgba(120,160,255,0.3)', background: 'rgba(8,10,24,0.55)' }}>
            <span className="flex h-12 w-12 items-center justify-center rounded-full text-[22px]"
              style={{ background: 'rgba(166,107,255,0.2)' }}>💬</span>
            <p className="text-[14px] font-bold text-white">まだ相談はありません</p>
            <p className="text-[12px]" style={{ color: 'rgba(200,215,245,0.6)' }}>
              質問を入力すると、ここにAIの回答が表示されます。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {turns.map((t) => (
              <div
                key={t.id}
                className="flex flex-col gap-3 rounded-3xl border p-5"
                style={{ background: 'rgba(10,14,32,0.78)', borderColor: 'rgba(120,160,255,0.3)' }}>
                {/* ヘッダー行：質問＋削除ボタン */}
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-[11px] font-bold" style={{ color: '#7CA6E8' }}>質問</span>
                  <p className="flex-1 text-[14px] font-semibold text-white">{t.question}</p>
                  <button
                    type="button"
                    aria-label="この相談履歴を削除"
                    onClick={() => requestDelete(t.id)}
                    className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:opacity-50"
                    style={{ color: '#6E7AA0' }}>
                    <TrashIcon size={15} />
                  </button>
                </div>
                <div className="h-px" style={{ background: 'rgba(120,160,255,0.15)' }} />
                {/* AIの回答 */}
                <div className="flex items-start gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'rgba(166,107,255,0.2)', color: '#C9A6FF' }}>
                    <ChatIcon size={15} />
                  </span>
                  <p className="flex-1 whitespace-pre-line text-[14px] leading-relaxed text-white">{t.answer}</p>
                </div>
                {/* 参照した予定・メモのタップ可能カード（詳細ページへ遷移） */}
                <ConsultRefCards turn={t} reservations={reservations} memos={memos} />
                {/* 参照先（件数つき） */}
                <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-[11px]"
                  style={{ borderColor: 'rgba(120,160,255,0.15)', color: 'rgba(200,215,245,0.6)' }}>
                  <span className="font-semibold" style={{ color: '#7CA6E8' }}>参照</span>
                  {(t.refTarget === 'both' || t.refTarget === 'memos') && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                      style={{ background: 'rgba(34,229,168,0.15)', color: '#7DF5CC' }}>
                      <FileTextIcon size={12} />
                      メモ{typeof t.memoCount === 'number' ? ` ${t.memoCount}件` : ''}
                    </span>
                  )}
                  {(t.refTarget === 'both' || t.refTarget === 'schedule') && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                      style={{ background: 'rgba(56,189,248,0.15)', color: '#7CD4FF' }}>
                      <CalendarIcon size={12} />
                      予定{typeof t.scheduleCount === 'number' ? ` ${t.scheduleCount}件` : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 下部ナビカード（メモ／予定／AI・AI=現在地） */}
        <div className="mt-2 grid grid-cols-3 gap-3">
          <NeonNavCard color="#22E5A8" title="メモ" icon={<NeonMemoIcon color="#22E5A8" />} href="/memos" />
          <NeonNavCard color="#38BDF8" title="予定" icon={<NeonCalendarIcon color="#38BDF8" />} href="/reservations" />
          <NeonNavCard color="#A66BFF" title="AI" icon={<NeonChatIconNav color="#A66BFF" />} href="/ai-assist" active />
        </div>
      </div>

      {/* 削除確認ダイアログ */}
      {confirmId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-10">
          <div className="absolute inset-0 bg-black/60" onClick={cancelDelete} />
          <div className="relative w-full max-w-md rounded-3xl border p-6"
            style={{ background: '#0C1024', borderColor: 'rgba(120,160,255,0.35)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
            <p className="text-center text-[15px] font-bold text-white">この相談履歴を削除しますか？</p>
            <p className="mt-1 text-center text-[12px]" style={{ color: MUTED }}>削除すると元に戻せません。</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={cancelDelete}
                className="flex-1 rounded-full border py-3 text-[14px] font-semibold"
                style={{ borderColor: 'rgba(120,160,255,0.35)', color: '#9AA4C0' }}>
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
        <div className="fixed inset-x-0 bottom-10 z-40 mx-auto w-full max-w-md px-5">
          <div className="rounded-full px-4 py-2.5 text-center text-[13px] text-white shadow-lg"
            style={{ background: 'rgba(20,28,60,0.95)', border: '1px solid rgba(120,160,255,0.4)' }}>
            {toast}
          </div>
        </div>
      )}
    </div>
    </>
  );
}

/* ── ネオン機能カード（下段ナビ・他画面と同一） ── */
function NeonNavCard({
  color,
  title,
  icon,
  href,
  active = false,
}: {
  color: string;
  title: string;
  icon: React.ReactNode;
  href: string;
  active?: boolean;
}) {
  return (
    <Link href={href} className="block active:scale-95">
      <div
        className="relative flex h-full flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center"
        style={
          active
            ? {
                background: `linear-gradient(160deg, ${navHexA(color, 0.28)} 0%, rgba(10,16,34,0.7) 72%)`,
                border: `1.5px solid ${navHexA(color, 0.85)}`,
                boxShadow: `0 0 22px ${navHexA(color, 0.4)}, 0 0 18px ${navHexA(color, 0.22)} inset`,
              }
            : {
                background: 'linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(10,12,28,0.6) 70%)',
                border: '1px solid rgba(255,255,255,0.15)',
              }
        }>
        {active && (
          <span className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-px text-[8px] font-bold"
            style={{ background: navHexA(color, 0.9), color: '#06121f' }}>
            現在
          </span>
        )}
        <span style={active ? undefined : { opacity: 0.85 }}>{icon}</span>
        <span className="text-[14px] font-bold" style={{ color: active ? color : 'rgba(255,255,255,0.82)' }}>{title}</span>
      </div>
    </Link>
  );
}

/** #RRGGBB + alpha → rgba() */
function navHexA(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function navGlow(color: string) {
  return { filter: `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 12px ${navHexA(color, 0.5)})` };
}

function NeonMemoIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={navGlow(color)}>
      <rect x="9" y="5" width="24" height="32" rx="3.5" stroke={color} strokeWidth="2.2" />
      <line x1="14" y1="13" x2="27" y2="13" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="19" x2="27" y2="19" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="25" x2="22" y2="25" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M31 30 L41 20 L44 23 L34 33 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function NeonCalendarIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={navGlow(color)}>
      <rect x="6" y="9" width="36" height="31" rx="4" stroke={color} strokeWidth="2.2" />
      <line x1="6" y1="18" x2="42" y2="18" stroke={color} strokeWidth="2" />
      <line x1="16" y1="5" x2="16" y2="13" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="32" y1="5" x2="32" y2="13" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="15" cy="26" r="2.3" fill={color} /><circle cx="24" cy="26" r="2.3" fill={color} /><circle cx="33" cy="26" r="2.3" fill={color} />
      <circle cx="15" cy="33" r="2.3" fill={color} /><circle cx="24" cy="33" r="2.3" fill={color} />
    </svg>
  );
}

function NeonChatIconNav({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={navGlow(color)}>
      <path d="M6 10 Q6 6 10 6 H38 Q42 6 42 10 V27 Q42 31 38 31 H15 L7 41 V31 Q6 31 6 27 Z" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="17" cy="19" r="2.6" fill={color} /><circle cx="24" cy="19" r="2.6" fill={color} /><circle cx="31" cy="19" r="2.6" fill={color} />
    </svg>
  );
}
