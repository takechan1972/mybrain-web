'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import VoiceInput from './VoiceInput';
import DesktopSidebar from './DesktopSidebar';
import ConsultFaqCards from './ConsultFaqCards';
import {
  CalendarIcon,
  ChatIcon,
  FileTextIcon,
  SearchIcon,
  SendIcon,
} from './icons';
import {
  loadConsultTurns,
  saveConsultTurns,
  type RefTarget,
  type Turn,
} from '@/lib/consult-store';
import { buildConsultAnswer } from '@/lib/consult-engine';
import { searchPublicFaq, type QaRecord } from '@/lib/knowledge';
import { loadOllamaSettings, testOllama } from '@/lib/ai/ollama';
import { askOllamaConsult } from '@/lib/ai/consult-ollama';
import { isLocalHost } from '@/lib/env';
import { safeUUID } from '@/lib/uuid';
import { getMemoStore } from '@/lib/storage/memo-store';
import { listMemos } from '@/lib/memos';
import { listReservations } from '@/lib/reservations';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import type { Memo, Reservation } from '@/lib/types';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const PURPLE = '#7B61FF';
const LAVENDER = '#EEF0FF';

const SUGGESTIONS = [
  '今日の予定を教えて',
  '最近のメモを整理して',
  '次にやることを提案して',
  '今週の予定を確認して',
  '保存した内容からアイデアを出して',
];

const HINTS = [
  '具体的に質問すると、より良い回答が得られます',
  '背景や目的を伝えると、的確なアドバイスがもらえます',
  '長文の回答は段階的に質問して深掘りしましょう',
];

function ymdHm(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const today = now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const isYest = yest.getFullYear() === d.getFullYear() && yest.getMonth() === d.getMonth() && yest.getDate() === d.getDate();
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (today) return `今日 ${hm}`;
  if (isYest) return `昨日 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export default function DesktopConsult() {
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  // ターンID → 関連する公開FAQ（参照カード用。履歴localStorageには保存しない）
  const [faqByTurn, setFaqByTurn] = useState<Record<string, QaRecord[]>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [histQuery, setHistQuery] = useState('');
  const baseRef = useRef('');

  // 参照設定
  const [refMemo, setRefMemo] = useState(true);
  const [refSchedule, setRefSchedule] = useState(true);
  const [refHistory, setRefHistory] = useState(true);
  const [refCount, setRefCount] = useState<'few' | 'normal' | 'many'>('normal');
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('all');

  // AIステータス
  const [local, setLocal] = useState(false);
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:1.5b');
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const refTarget: RefTarget = useMemo(() => {
    if (refMemo && refSchedule) return 'both';
    if (refMemo) return 'memos';
    if (refSchedule) return 'schedule';
    return 'both';
  }, [refMemo, refSchedule]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }

  function loadData() {
    void listMemos().then(({ memos }) => setMemos(memos));
    void listReservations().then(({ reservations }) => setReservations(reservations));
  }

  async function recheck() {
    setChecking(true);
    const s = loadOllamaSettings();
    setOllamaModel(s.model);
    if (isLocalHost() && s.enabled) {
      const r = await testOllama(s.endpoint);
      setOllamaOk(r.ok);
    } else {
      setOllamaOk(false);
    }
    setChecking(false);
  }

  useEffect(() => {
    setTurns(loadConsultTurns());
    setLoaded(true);
    setLocal(isLocalHost());
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setText(q);
    void recheck();
    if (!isSupabaseConfigured()) return;
    loadData();
    const onFocus = () => loadData();
    const onVisible = () => { if (document.visibilityState === 'visible') loadData(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveConsultTurns(turns);
  }, [turns, loaded]);

  async function send(question: string) {
    const q = question.trim();
    if (q.length === 0 || sending) return;
    setSending(true);
    try {
      const { answer: localAnswer, memoCount, scheduleCount, scheduleIds, memoIds } =
        buildConsultAnswer(q, refTarget, memos, reservations);
      let answer = localAnswer;
      const ollama = loadOllamaSettings();
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
      const id = safeUUID();
      setTurns((prev) => [
        { id, question: q, answer, refTarget, createdAt: Date.now(), memoCount, scheduleCount, scheduleIds, memoIds },
        ...prev,
      ]);
      setSelectedId(id);
      setText('');
      if (!useOllama) showToast('回答を作成しました');

      // 関連する公開FAQ（is_public=true）を取得してこのターンに紐付け（参照カード表示用）。
      // AIプロンプトには注入しない。失敗・該当なしのときは何も表示しない。
      void searchPublicFaq(q).then((res) => {
        if (res.records.length > 0) {
          setFaqByTurn((prev) => ({ ...prev, [id]: res.records }));
        }
      });
    } catch (e) {
      console.error('[consult] 回答生成に失敗しました:', e);
      showToast('メモの読み込み中に問題が発生しました。保存データを確認してください。');
    } finally {
      setSending(false);
    }
  }

  function confirmDelete() {
    if (!confirmId) return;
    setTurns((prev) => prev.filter((t) => t.id !== confirmId));
    if (selectedId === confirmId) setSelectedId(null);
    setConfirmId(null);
    showToast('削除しました');
  }

  function newChat() {
    setSelectedId(null);
    setText('');
  }

  const selected = turns.find((t) => t.id === selectedId) ?? null;

  const filteredHist = useMemo(() => {
    const qq = histQuery.trim().toLowerCase();
    if (qq.length === 0) return turns;
    return turns.filter((t) => `${t.question} ${t.answer}`.toLowerCase().includes(qq));
  }, [turns, histQuery]);

  async function copyAnswer() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.answer); showToast('回答をコピーしました'); }
    catch { showToast('コピーできませんでした'); }
  }

  async function saveAsMemo() {
    if (!selected) return;
    // seam 経由で作成（現状は全 target が Supabase に解決＝挙動は不変）。
    const { memo, error } = await getMemoStore().createMemo({
      title: `AI相談：${selected.question.slice(0, 24)}`,
      body: `Q. ${selected.question}\n\nA. ${selected.answer}`,
      tags: ['AI相談'],
      images: [],
    });
    if (error || !memo) { showToast(error || '保存に失敗しました。'); return; }
    showToast('メモに保存しました');
  }

  function regenerate() {
    if (!selected) return;
    void send(selected.question);
  }

  return (
    <div className="fixed inset-0 z-40 hidden overflow-hidden bg-[#F7F8FC] lg:flex">
      {/* ── 左サイドバー ── */}
      <DesktopSidebar active="consult" bottom={
        <>
          <div className="rounded-2xl border border-[#E8EAF3] bg-[#FBFBFE] p-3">
            <p className="mb-2 text-[11px] font-bold" style={{ color: MUTED }}>AI・音声ステータス</p>
            <StatusLine label="Ollama接続" ok={local && !!ollamaOk} okText="接続OK" ngText={local ? (ollamaOk === null ? '確認中…' : '未接続') : 'ローカル専用'} />
            <p className="ml-3.5 mt-0.5 text-[10px]" style={{ color: MUTED }}>モデル: {ollamaModel}</p>
            <div className="my-2 h-px bg-[#EEF0F5]" />
            <StatusLine label="Whisper" ok={local} okText="利用可能" ngText="ローカル専用" />
          </div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: LAVENDER }}>
            <p className="text-[12px] font-bold" style={{ color: NAVY }}>今日も素晴らしい一日になりますように！</p>
            <p className="mt-1 text-[10px]" style={{ color: '#54607A' }}>小さな一歩が、大きな未来をつくります。</p>
          </div>
        </>
      } />

      {/* ── 右側（ヘッダー＋3カラム本体） ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ヘッダー */}
        <header className="flex items-center gap-3 border-b border-[#E8EAF3] bg-white px-6 py-4">
          <div className="flex-1">
            <h1 className="text-[20px] font-extrabold" style={{ color: NAVY }}>AIアシスト</h1>
            <p className="text-[12px]" style={{ color: MUTED }}>メモと予定をもとに、あなた専用の答えを返します</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-[#E8EAF3] bg-white px-3 py-1.5 text-[12px] font-bold" style={{ color: NAVY }}>
            モデル: {ollamaModel}
            <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: local && ollamaOk ? '#E8F8EE' : '#F1F2F7', color: local && ollamaOk ? '#1B8A4B' : '#A6AEC0' }}>{local && ollamaOk ? '接続OK' : '未接続'}</span>
          </span>
          <Link href="/settings" className="rounded-xl border border-[#E8EAF3] bg-white px-3 py-2 text-[13px] font-bold" style={{ color: '#54607A' }}>⚙ 設定</Link>
          <button type="button" onClick={newChat} className="rounded-xl px-4 py-2.5 text-[13px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>＋ 新しい相談</button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* チャット履歴カラム */}
          <div className="flex w-64 shrink-0 flex-col border-r border-[#E8EAF3] bg-white">
            <div className="flex flex-col gap-2 p-4">
              <p className="text-[13px] font-extrabold" style={{ color: NAVY }}>チャット履歴</p>
              <button type="button" onClick={newChat} className="flex items-center justify-center gap-1 rounded-xl border border-[#D9CEFF] py-2 text-[12px] font-bold" style={{ color: PURPLE }}>＋ 新しいチャット</button>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#A6AEC0' }}><SearchIcon size={13} /></span>
                <input value={histQuery} onChange={(e) => setHistQuery(e.target.value)} placeholder="履歴を検索..." className="w-full rounded-full border border-[#E8EAF3] py-1.5 pl-8 pr-3 text-[12px] outline-none focus:border-[#7B61FF]" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {filteredHist.length === 0 ? (
                <p className="px-2 py-6 text-center text-[12px]" style={{ color: MUTED }}>履歴はまだありません。</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredHist.map((t) => {
                    const sel = t.id === selectedId;
                    return (
                      <div key={t.id} className="group relative">
                        <button type="button" onClick={() => setSelectedId(t.id)}
                          className="w-full rounded-xl border px-3 py-2.5 text-left transition"
                          style={{ borderColor: sel ? PURPLE : 'transparent', backgroundColor: sel ? '#F6F4FF' : 'transparent', boxShadow: sel ? `inset 3px 0 0 ${PURPLE}` : 'none' }}>
                          <p className="text-[10px] font-semibold" style={{ color: MUTED }}>{ymdHm(t.createdAt)}</p>
                          <p className="truncate text-[12px] font-bold" style={{ color: NAVY }}>{t.question}</p>
                        </button>
                        <button type="button" onClick={() => setConfirmId(t.id)} className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded-md px-1.5 py-1 text-[12px] group-hover:block" style={{ color: '#C0392B' }}>🗑</button>
                      </div>
                    );
                  })}
                </div>
              )}
              <Link href="/consult" className="mt-3 block text-center text-[12px] font-bold" style={{ color: PURPLE }}>すべての履歴を見る →</Link>
            </div>
          </div>

          {/* 中央チャット */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#EEF0F5] bg-white px-6 py-3">
              <p className="truncate text-[15px] font-extrabold" style={{ color: NAVY }}>{selected ? selected.question : '新しい相談'}</p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {!selected ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: LAVENDER, color: PURPLE }}><ChatIcon size={28} /></span>
                  <div>
                    <p className="text-[16px] font-extrabold" style={{ color: NAVY }}>メモや予定について聞いてみましょう</p>
                    <p className="mt-1 text-[12px]" style={{ color: MUTED }}>保存したメモ・予定をもとに、AIがあなた専用の答えを返します。</p>
                  </div>
                  <div className="flex max-w-lg flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-[#E8EAF3] bg-white px-3.5 py-2 text-[12px] font-semibold" style={{ color: NAVY }}>{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex max-w-2xl flex-col gap-4">
                  {/* ユーザー質問 */}
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-tr-sm px-4 py-3" style={{ backgroundColor: LAVENDER }}>
                      <p className="whitespace-pre-line text-[14px] leading-relaxed" style={{ color: '#1F2937' }}>{selected.question}</p>
                      <p className="mt-1 text-right text-[10px]" style={{ color: MUTED }}>{ymdHm(selected.createdAt)}</p>
                    </div>
                  </div>
                  {/* AI回答 */}
                  <div className="flex items-start gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}><ChatIcon size={16} /></span>
                    <div className="flex-1 rounded-2xl rounded-tl-sm border border-[#EEF0F5] bg-white px-4 py-3">
                      <p className="whitespace-pre-line text-[14px] leading-relaxed" style={{ color: '#1F2937' }}>{selected.answer}</p>
                      {/* 参照件数 */}
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#EEF0F5] pt-2 text-[11px]" style={{ color: MUTED }}>
                        <span className="font-semibold">参照</span>
                        {(selected.refTarget === 'both' || selected.refTarget === 'memos') && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: LAVENDER, color: NAVY }}><FileTextIcon size={11} />メモ{typeof selected.memoCount === 'number' ? ` ${selected.memoCount}件` : ''}</span>
                        )}
                        {(selected.refTarget === 'both' || selected.refTarget === 'schedule') && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: LAVENDER, color: NAVY }}><CalendarIcon size={11} />予定{typeof selected.scheduleCount === 'number' ? ` ${selected.scheduleCount}件` : ''}</span>
                        )}
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: LAVENDER, color: NAVY }}><ChatIcon size={11} />履歴 {turns.length}件</span>
                      </div>
                      {/* アクション */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <AnsBtn label="⧉ コピー" onClick={copyAnswer} />
                        <AnsBtn label="📝 メモに保存" onClick={saveAsMemo} />
                        <AnsBtn label="↻ 再生成" onClick={regenerate} />
                        <AnsBtn label="🗑 削除" danger onClick={() => setConfirmId(selected.id)} />
                      </div>
                      {/* 関連する公開FAQ（chatbot_knowledge / is_public=true）。タップでその場開閉。 */}
                      <ConsultFaqCards items={faqByTurn[selected.id] ?? []} variant="light" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 入力欄 */}
            <div className="border-t border-[#EEF0F5] bg-white px-6 py-4">
              <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-[#E8EAF3] bg-white px-3 py-2 shadow-[0_4px_14px_rgba(31,53,104,0.05)]">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
                  rows={1}
                  placeholder="AIに相談してみましょう…"
                  className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[14px] outline-none placeholder:text-[#A6AEC0]"
                  style={{ color: '#1F2937' }}
                />
                <VoiceInput iconOnly onResult={(t) => setText(t)} getInitial={() => { baseRef.current = text; return text; }} />
                <button type="button" onClick={() => send(text)} disabled={sending} className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>
                  <SendIcon size={15} />{sending ? '送信中…' : '送信'}
                </button>
              </div>
              <p className="mt-2 text-center text-[11px]" style={{ color: '#A6AEC0' }}>AIの回答は参考情報です。重要な判断はご自身でご確認ください。</p>
            </div>
          </div>

          {/* 右カラム */}
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-[#E8EAF3] bg-[#FBFBFE] px-5 py-6">
            {/* 参照設定 */}
            <SideCard title="参照設定">
              <Toggle label="メモを参照" on={refMemo} onChange={setRefMemo} />
              <Toggle label="予定を参照" on={refSchedule} onChange={setRefSchedule} />
              <Toggle label="AIアシスト履歴を参照" on={refHistory} onChange={setRefHistory} />
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-semibold" style={{ color: MUTED }}>参照件数</p>
                <Segmented value={refCount} onChange={(v) => setRefCount(v as typeof refCount)} options={[{ v: 'few', t: '少なめ' }, { v: 'normal', t: '標準' }, { v: 'many', t: '多め' }]} />
              </div>
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-semibold" style={{ color: MUTED }}>期間</p>
                <Segmented value={period} onChange={(v) => setPeriod(v as typeof period)} options={[{ v: 'today', t: '今日' }, { v: 'week', t: '今週' }, { v: 'month', t: '今月' }, { v: 'all', t: 'すべて' }]} />
              </div>
            </SideCard>

            {/* おすすめプロンプト */}
            <SideCard title="おすすめプロンプト">
              <div className="flex flex-col gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="flex items-center justify-between rounded-xl border border-[#E8EAF3] bg-white px-3 py-2 text-left text-[12px] font-semibold" style={{ color: '#54607A' }}>
                    {s}<span style={{ color: '#A6AEC0' }}>→</span>
                  </button>
                ))}
              </div>
            </SideCard>

            {/* AIステータス */}
            <SideCard title="AIステータス">
              <div className="flex flex-col gap-2">
                <SideStat label="Ollama接続" ok={local && !!ollamaOk} okText="接続OK" ngText={local ? '未接続' : 'ローカル専用'} />
                <SideStat label="使用モデル" value={ollamaModel} />
                <SideStat label="参照可能メモ" value={`${memos.length} 件`} />
                <SideStat label="参照可能予定" value={`${reservations.length} 件`} />
                <SideStat label="相談履歴" value={`${turns.length} 件`} />
              </div>
              <button type="button" onClick={recheck} disabled={checking} className="mt-3 w-full rounded-xl border border-[#E8EAF3] bg-white py-2 text-[12px] font-bold disabled:opacity-50" style={{ color: '#54607A' }}>{checking ? '確認中…' : '↻ 再チェック'}</button>
            </SideCard>

            {/* 会話のヒント */}
            <SideCard title="会話のヒント">
              <ul className="flex flex-col gap-2">
                {HINTS.map((h, i) => (
                  <li key={i} className="flex gap-2 text-[11px] leading-relaxed" style={{ color: '#54607A' }}>
                    <span style={{ color: PURPLE }}>✓</span>{h}
                  </li>
                ))}
              </ul>
            </SideCard>
          </aside>
        </div>
      </div>

      {/* 削除確認 */}
      {confirmId && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/30" onClick={() => setConfirmId(null)} />
          <div className="relative flex w-full max-w-md flex-col gap-3 rounded-3xl border border-[#E8EAF3] bg-white p-6 shadow-[0_20px_60px_rgba(31,53,104,0.18)]">
            <p className="text-center text-[15px] font-bold" style={{ color: NAVY }}>この相談履歴を削除しますか？</p>
            <p className="text-center text-[12px]" style={{ color: MUTED }}>削除すると元に戻せません。</p>
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={() => setConfirmId(null)} className="flex-1 rounded-full border border-[#E8EAF3] py-3 text-[14px] font-semibold" style={{ color: MUTED }}>キャンセル</button>
              <button type="button" onClick={confirmDelete} className="flex-1 rounded-full py-3 text-[14px] font-semibold text-white" style={{ backgroundColor: '#E05555' }}>削除</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 z-[60] -translate-x-1/2">
          <span className="rounded-full bg-black/80 px-4 py-2 text-[13px] font-semibold text-white shadow-lg">{toast}</span>
        </div>
      )}
    </div>
  );
}

/* ── 小コンポーネント ── */
function AnsBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg border px-3 py-1.5 text-[12px] font-bold"
      style={danger ? { borderColor: '#F3D2D2', color: '#C0392B' } : { borderColor: '#E8EAF3', color: '#54607A' }}>{label}</button>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-[#E8EAF3] bg-white p-4 shadow-[0_6px_18px_rgba(31,53,104,0.04)]">
      <p className="mb-3 text-[13px] font-extrabold" style={{ color: NAVY }}>{title}</p>
      {children}
    </section>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[12px] font-semibold" style={{ color: '#54607A' }}>{label}</span>
      <button type="button" onClick={() => onChange(!on)} aria-pressed={on} className="relative h-5 w-9 shrink-0 rounded-full transition-colors" style={{ backgroundColor: on ? PURPLE : '#D7DBE6' }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: on ? '18px' : '2px' }} />
      </button>
    </div>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: { v: string; t: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex overflow-hidden rounded-xl border border-[#E8EAF3]">
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button key={o.v} type="button" onClick={() => onChange(o.v)} className="flex-1 py-1.5 text-[11px] font-bold transition"
            style={active ? { backgroundColor: LAVENDER, color: PURPLE } : { backgroundColor: '#fff', color: '#A6AEC0' }}>{o.t}</button>
        );
      })}
    </div>
  );
}

function SideStat({ label, value, ok, okText, ngText }: { label: string; value?: string; ok?: boolean; okText?: string; ngText?: string }) {
  const right = value != null
    ? <span className="text-[11px] font-bold" style={{ color: '#1F2937' }}>{value}</span>
    : <span className="text-[11px] font-bold" style={{ color: ok ? '#1B8A4B' : '#A6AEC0' }}>{ok ? okText : ngText}</span>;
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px]" style={{ color: '#54607A' }}>{label}</span>
      {right}
    </div>
  );
}

function StatusLine({ label, ok, okText, ngText }: { label: string; ok: boolean; okText: string; ngText: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ok ? '#22C55E' : '#C9CEDB' }} />
        <span className="text-[12px] font-bold" style={{ color: '#1F2937' }}>{label}</span>
      </span>
      <span className="text-[11px] font-bold" style={{ color: ok ? '#1B8A4B' : '#A6AEC0' }}>{ok ? okText : ngText}</span>
    </div>
  );
}
