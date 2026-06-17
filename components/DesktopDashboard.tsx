'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DesktopSidebar from './DesktopSidebar';
import { useEffect, useState, type ComponentType } from 'react';
import {
  BellIcon,
  CalendarIcon,
  ChatIcon,
  ChevronRightIcon,
  FileTextIcon,
  MicIcon,
  SearchIcon,
  SendIcon,
} from './icons';
import { loadOllamaSettings, testOllama } from '@/lib/ai/ollama';
import { isLocalHost } from '@/lib/env';
import type { Memo, Reservation } from '@/lib/types';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const PURPLE = '#7B61FF';
const LAVENDER = '#EEF0FF';

const TRANSCRIPTION_TAGS = ['文字起こし', 'Transcription'];
const SUMMARY_TAGS = ['AI要約', 'AI整理'];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'こんばんは';
  if (h < 11) return 'おはようございます';
  if (h < 18) return 'こんにちは';
  return 'こんばんは';
}

function hhmm(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ymdHm(ms: number): string {
  if (!ms || ms <= 0) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isToday(ms: number | null): boolean {
  if (!ms) return false;
  const d = new Date(ms);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

const DOT_COLORS = ['#7B61FF', '#3B82F6', '#F59E0B', '#22C55E'];

const QUICK_PROMPTS = ['今日の予定を整理して', '最近のメモを要約して', 'やることリストを作って', 'アイデアを整理して'];

export default function DesktopDashboard({
  memos,
  reservations,
  userName,
}: {
  memos: Memo[];
  reservations: Reservation[];
  userName: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [local, setLocal] = useState(false);
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:1.5b');
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);

  useEffect(() => {
    const isLocal = isLocalHost();
    setLocal(isLocal);
    const s = loadOllamaSettings();
    setOllamaModel(s.model);
    if (isLocal && s.enabled) {
      testOllama(s.endpoint).then((r) => setOllamaOk(r.ok));
    } else {
      setOllamaOk(false);
    }
  }, []);

  const todays = reservations
    .filter((r) => isToday(r.scheduleAt))
    .sort((a, b) => (a.scheduleAt ?? 0) - (b.scheduleAt ?? 0));
  const recentMemos = memos.slice(0, 3);
  const transcriptions = memos
    .filter((m) => m.tags.some((t) => TRANSCRIPTION_TAGS.includes(t)))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const recentTranscriptions = transcriptions.slice(0, 3);
  const summarizedCount = memos.filter((m) => m.tags.some((t) => SUMMARY_TAGS.includes(t))).length;

  function sendConsult(text: string) {
    const v = text.trim();
    if (v.length === 0) return;
    router.push(`/consult?q=${encodeURIComponent(v)}`);
  }

  const today = new Date();

  return (
    <div className="fixed inset-0 z-40 hidden bg-[#F7F8FC] lg:flex">
      {/* ── 左サイドバー ── */}
      <DesktopSidebar active="home" bottom={
        <>
          {/* ローカルAI状態 */}
          <div className="rounded-2xl border border-[#E8EAF3] bg-[#FBFBFE] p-3">
            <p className="mb-2 text-[11px] font-bold" style={{ color: MUTED }}>ローカルAIの状態</p>
            <StatusLine label="Ollama" sub={`モデル: ${ollamaModel}`} ok={local && ollamaOk === true} okText={ollamaOk === null ? '確認中…' : '接続OK'} ngText={local ? '未接続' : 'PCローカル専用'} />
            <div className="my-2 h-px bg-[#EEF0F5]" />
            <StatusLine label="Whisper" sub="ローカル文字起こし" ok={local} okText="使用可能" ngText="PCローカル専用" />
          </div>
          {/* 応援カード */}
          <div className="flex items-center gap-2 rounded-2xl p-3" style={{ backgroundColor: LAVENDER }}>
            <span className="text-lg">😊</span>
            <span className="text-[11px] leading-tight" style={{ color: NAVY }}>
              今日もいい一日を！<br />MyBrainがサポートします
            </span>
          </div>
        </>
      } />

      {/* ── 中央＋右：スクロール領域 ── */}
      <div className="flex-1 overflow-y-auto">
        {/* ヘッダー */}
        <header className="flex items-center gap-4 px-8 pt-6">
          <div className="flex-1">
            <h1 className="text-[24px] font-extrabold" style={{ color: NAVY }}>
              ☀️ {greeting()}{userName && userName !== 'ゲスト' ? `、${userName}さん` : ''}！
            </h1>
            <p className="text-[13px]" style={{ color: MUTED }}>今日もMyBrainと一緒に、よい一日を始めましょう。</p>
          </div>
          <div className="relative w-80 max-w-[40%]">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#A6AEC0' }}>
              <SearchIcon size={16} />
            </span>
            <input
              readOnly
              onClick={() => router.push('/memos')}
              placeholder="メモ・予定・タグを検索..."
              className="w-full cursor-pointer rounded-full border border-[#E8EAF3] bg-white py-2.5 pl-9 pr-4 text-[13px] outline-none"
              style={{ color: '#1F2937' }}
            />
          </div>
          <button type="button" aria-label="通知" className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#54607A] shadow-sm">
            <BellIcon size={18} />
          </button>
          <span className="flex h-10 w-10 items-center justify-center rounded-full text-lg" style={{ backgroundColor: LAVENDER }}>🪻</span>
        </header>

        {/* 本体：メイン＋右パネル */}
        <div className="flex gap-6 px-8 py-6">
          <main className="grid flex-1 grid-cols-2 gap-6">
            {/* カードA：今日の予定 */}
            <Card title="今日の予定" Icon={CalendarIcon} href="/reservations">
              <div className="flex gap-4">
                <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl" style={{ backgroundColor: LAVENDER }}>
                  <span className="text-[18px] font-extrabold" style={{ color: NAVY }}>{today.getMonth() + 1}月{today.getDate()}日</span>
                  <span className="text-[11px]" style={{ color: MUTED }}>{['日', '月', '火', '水', '木', '金', '土'][today.getDay()]}曜日</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                  {todays.length === 0 ? (
                    <p className="text-[13px]" style={{ color: MUTED }}>今日の予定はありません。</p>
                  ) : (
                    todays.slice(0, 4).map((r, i) => (
                      <Link key={r.id} href={`/reservations/${r.id}`} className="flex items-center gap-3 text-[13px] active:opacity-70">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: DOT_COLORS[i % DOT_COLORS.length] }} />
                        <span className="w-12 shrink-0 font-bold" style={{ color: NAVY }}>{hhmm(r.scheduleAt)}</span>
                        <span className="truncate" style={{ color: '#54607A' }}>{r.title || '無題の予定'}</span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </Card>

            {/* カードB：最近の文字起こし */}
            <Card title="最近の文字起こし" Icon={MicIcon} href="/transcribe">
              {recentTranscriptions.length === 0 ? (
                <p className="text-[13px]" style={{ color: MUTED }}>まだ文字起こしメモはありません。</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {recentTranscriptions.map((m) => (
                    <li key={m.id}>
                      <Link href={`/memos/${m.id}`} className="flex items-center gap-3 active:opacity-70">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: LAVENDER, color: PURPLE }}>
                          <MicIcon size={16} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[13px] font-semibold" style={{ color: '#1F2937' }}>{m.title || '無題のメモ'}</span>
                          <span className="text-[11px]" style={{ color: '#A6AEC0' }}>{ymdHm(m.createdAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* カードC：最近のメモ */}
            <Card title="最近のメモ" Icon={FileTextIcon} href="/memos">
              {recentMemos.length === 0 ? (
                <p className="text-[13px]" style={{ color: MUTED }}>まだメモがありません。最初のメモを書いてみましょう。</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {recentMemos.map((m) => (
                    <li key={m.id}>
                      <Link href={`/memos/${m.id}`} className="flex items-start gap-3 active:opacity-70">
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: LAVENDER, color: NAVY }}>
                          <FileTextIcon size={16} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-[13px] font-semibold" style={{ color: '#1F2937' }}>{m.title || '無題のメモ'}</span>
                            <span className="shrink-0 text-[11px]" style={{ color: '#A6AEC0' }}>{ymdHm(m.createdAt).slice(0, 10)}</span>
                          </span>
                          <span className="truncate text-[12px]" style={{ color: MUTED }}>{m.body || '（本文なし）'}</span>
                          {m.tags.length > 0 && (
                            <span className="mt-0.5 truncate text-[11px]" style={{ color: PURPLE }}>{m.tags.map((t) => `#${t}`).join(' ')}</span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* カードD：AI相談（クイック入力） */}
            <Card title="AI相談（クイック入力）" Icon={ChatIcon}>
              <p className="mb-2 text-[12px]" style={{ color: MUTED }}>どんなことでも相談してみてください。</p>
              <div className="relative">
                <textarea
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  rows={3}
                  placeholder="例：今日の予定を整理して優先順位をつけて"
                  className="w-full resize-none rounded-2xl border border-[#E8EAF3] bg-[#FBFBFE] px-4 py-3 pr-12 text-[13px] outline-none focus:border-[#7B61FF]"
                  style={{ color: '#1F2937' }}
                />
                <button
                  type="button"
                  onClick={() => sendConsult(q)}
                  aria-label="送信"
                  className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: PURPLE }}>
                  <SendIcon size={16} />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => sendConsult(p)}
                    className="truncate rounded-xl border border-[#E8EAF3] bg-white px-3 py-2 text-[12px] font-semibold active:opacity-70"
                    style={{ color: '#54607A' }}>
                    {p}
                  </button>
                ))}
              </div>
            </Card>
          </main>

          {/* ── 右サイドパネル ── */}
          <aside className="flex w-80 shrink-0 flex-col gap-5">
            {/* AIステータス */}
            <div className="rounded-3xl border border-[#E8EAF3] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.05)]">
              <p className="mb-3 flex items-center gap-2 text-[14px] font-bold" style={{ color: NAVY }}>✨ AIステータス</p>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold" style={{ color: '#1F2937' }}>Ollama</span>
                <Badge ok={local && ollamaOk === true} okText={ollamaOk === null ? '確認中…' : '接続OK'} ngText={local ? '未接続' : 'ローカル専用'} />
              </div>
              <div className="mt-1 flex items-center justify-between text-[12px]" style={{ color: MUTED }}>
                <span>モデル</span>
                <span className="rounded-md px-2 py-0.5" style={{ backgroundColor: LAVENDER, color: PURPLE }}>{ollamaModel}</span>
              </div>
              <div className="my-3 h-px bg-[#EEF0F5]" />
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold" style={{ color: '#1F2937' }}>Whisper</span>
                <Badge ok={local} okText="使用可能" ngText="ローカル専用" />
              </div>
              <p className="mt-1 text-[12px]" style={{ color: MUTED }}>文字起こし（ローカル）</p>
            </div>

            {/* 今日のサマリー */}
            <div className="rounded-3xl border border-[#E8EAF3] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.05)]">
              <p className="mb-3 flex items-center gap-2 text-[14px] font-bold" style={{ color: NAVY }}>📊 今日のサマリー</p>
              <SummaryRow Icon={FileTextIcon} label="メモ" value={memos.length} unit="件" />
              <SummaryRow Icon={CalendarIcon} label="予定" value={reservations.length} unit="件" />
              <SummaryRow Icon={MicIcon} label="文字起こし" value={transcriptions.length} unit="件" />
              <SummaryRow Icon={ChatIcon} label="要約済みメモ" value={summarizedCount} unit="件" last />
            </div>

            {/* クイックアクション */}
            <div className="rounded-3xl border border-[#E8EAF3] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.05)]">
              <p className="mb-3 flex items-center gap-2 text-[14px] font-bold" style={{ color: NAVY }}>⚡ クイックアクション</p>
              <QuickAction label="最近のメモを要約" tint="#EEF0FF" onClick={() => sendConsult('最近のメモを要約して')} Icon={FileTextIcon} />
              <QuickAction label="今日の情報を整理" tint="#FFF4E5" onClick={() => sendConsult('今日の予定を整理して')} Icon={CalendarIcon} />
              <QuickAction label="文字起こしを開始" tint="#EAF7EF" onClick={() => router.push('/transcribe')} Icon={MicIcon} />
              <QuickAction label="新しいメモを書く" tint="#EEF0FF" onClick={() => router.push('/memos')} Icon={ChatIcon} last />
            </div>
          </aside>
        </div>

        {/* 下部ヒントカード */}
        <div className="mx-8 mb-10 flex items-center gap-4 rounded-3xl border border-[#E5DDFB] p-6" style={{ background: 'linear-gradient(135deg, #F3EEFF, #EAF1FF)' }}>
          <span className="text-2xl">💡</span>
          <div className="flex-1">
            <p className="text-[15px] font-bold" style={{ color: NAVY }}>MyBrainの使い方のヒント</p>
            <p className="text-[13px]" style={{ color: '#54607A' }}>
              スマホでメモを入力 → パソコンでAIに要約・整理して、あなたの知識を深めましょう。
            </p>
          </div>
          <span className="text-2xl">📱 ➡️ 🧠 ✨</span>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  Icon,
  href,
  children,
}: {
  title: string;
  Icon: ComponentType<{ size?: number }>;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-[#E8EAF3] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.05)]">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[15px] font-bold" style={{ color: NAVY }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: LAVENDER, color: PURPLE }}>
            <Icon size={16} />
          </span>
          {title}
        </p>
        {href && (
          <Link href={href} className="rounded-full px-3 py-1 text-[12px] font-semibold active:opacity-70" style={{ backgroundColor: LAVENDER, color: PURPLE }}>
            すべて見る
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function StatusLine({ label, sub, ok, okText, ngText }: { label: string; sub: string; ok: boolean; okText: string; ngText: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ok ? '#22C55E' : '#C9CEDB' }} />
        <span className="flex flex-col">
          <span className="text-[12px] font-bold" style={{ color: '#1F2937' }}>{label}</span>
          <span className="text-[10px]" style={{ color: MUTED }}>{sub}</span>
        </span>
      </span>
      <span className="text-[11px] font-bold" style={{ color: ok ? '#1B8A4B' : '#A6AEC0' }}>{ok ? okText : ngText}</span>
    </div>
  );
}

function Badge({ ok, okText, ngText }: { ok: boolean; okText: string; ngText: string }) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
      style={ok ? { backgroundColor: '#E8F8EE', color: '#1B8A4B' } : { backgroundColor: '#F1F2F6', color: '#8A94A6' }}>
      {ok ? okText : ngText}
    </span>
  );
}

function SummaryRow({ Icon, label, value, unit, last }: { Icon: ComponentType<{ size?: number }>; label: string; value: number; unit: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2 ${last ? '' : 'border-b border-[#EEF0F5]'}`}>
      <span className="flex items-center gap-2 text-[13px]" style={{ color: '#54607A' }}>
        <Icon size={16} />
        {label}
      </span>
      <span className="text-[15px] font-extrabold" style={{ color: NAVY }}>{value}<span className="ml-0.5 text-[11px] font-semibold" style={{ color: MUTED }}>{unit}</span></span>
    </div>
  );
}

function QuickAction({ label, tint, onClick, Icon, last }: { label: string; tint: string; onClick: () => void; Icon: ComponentType<{ size?: number }>; last?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[13px] font-semibold active:opacity-70 ${last ? '' : 'mb-2'}`}
      style={{ backgroundColor: tint, color: '#54607A' }}>
      <Icon size={16} />
      <span className="flex-1">{label}</span>
      <ChevronRightIcon size={14} />
    </button>
  );
}
