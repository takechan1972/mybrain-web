'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MicIcon, SearchIcon } from './icons';
import DesktopSidebar from './DesktopSidebar';
import {
  createReservation,
  deleteReservation,
  formatSchedule,
  listReservations,
  localInputToMs,
  msToLocalInput,
} from '@/lib/reservations';
import { useSpeech } from '@/lib/useSpeech';
import { parseScheduleFromText } from '@/lib/parse/schedule';
import { loadOllamaSettings, testOllama } from '@/lib/ai/ollama';
import { isLocalHost } from '@/lib/env';
import type { Reservation } from '@/lib/types';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const PURPLE = '#7B61FF';
const LAVENDER = '#EEF0FF';

/** カテゴリ定義（DBにカテゴリ列はないため、タイトル/内容から推定して色分けする） */
type CatKey = 'work' | 'private' | 'health' | 'growth';
const CATEGORIES: Record<CatKey, { label: string; color: string; bg: string; border: string }> = {
  work: { label: '仕事', color: '#6D4BD8', bg: '#F1ECFE', border: '#D9CEFF' },
  private: { label: 'プライベート', color: '#D6457E', bg: '#FCE9F1', border: '#F6CFDF' },
  health: { label: '健康', color: '#1F9E6B', bg: '#E6F7EF', border: '#BFE9D5' },
  growth: { label: '自己啓発', color: '#C9881A', bg: '#FBF2DD', border: '#F0E0B5' },
};

const WORK_KW = ['会議', '打ち合わせ', 'ミーティング', '仕事', '商談', 'レビュー', '作業', 'クライアント', '開発', '資料'];
const HEALTH_KW = ['病院', '歯医者', 'ジム', '運動', 'ランニング', '散歩', '健康', '通院', '診察'];
const GROWTH_KW = ['勉強', '学習', '英会話', '読書', 'レッスン', '資格', 'セミナー', '研修'];

function categoryOf(r: Reservation): CatKey {
  const t = `${r.title} ${r.content}`;
  if (HEALTH_KW.some((k) => t.includes(k))) return 'health';
  if (GROWTH_KW.some((k) => t.includes(k))) return 'growth';
  if (WORK_KW.some((k) => t.includes(k))) return 'work';
  // 平日昼間=仕事寄り、それ以外=プライベート寄りの簡易推定
  return 'private';
}

/* ── 日付ユーティリティ ── */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
/** その日を含む週の月曜日 */
function mondayOf(d: Date): Date {
  const s = startOfDay(d);
  const day = (s.getDay() + 6) % 7; // 月=0 ... 日=6
  return addDays(s, -day);
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
const WD = ['月', '火', '水', '木', '金', '土', '日'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8:00〜21:00

type View = 'week' | 'month' | 'list';

export default function DesktopSchedules() {
  const router = useRouter();
  const [items, setItems] = useState<Reservation[]>([]);
  const [anchor, setAnchor] = useState<Date>(() => new Date()); // 表示基準日
  const [selectedDay, setSelectedDay] = useState<Date>(() => startOfDay(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<CatKey | 'all'>('all');
  const [view, setView] = useState<View>('week');
  const [toast, setToast] = useState<string | null>(null);

  // ローカルAI/音声ステータス
  const [local, setLocal] = useState(false);
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:1.5b');
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);

  // 作成モーダル
  const [creating, setCreating] = useState(false);
  const [nTitle, setNTitle] = useState('');
  const [nContent, setNContent] = useState('');
  const [nWhen, setNWhen] = useState('');
  const [nAllDay, setNAllDay] = useState(false); // 終日（日付のみ入力にする）
  const [nNotify, setNNotify] = useState(false);
  const [nSaving, setNSaving] = useState(false);

  // クイック追加
  const [quickTitle, setQuickTitle] = useState('');

  // 削除確認
  const [confirmDel, setConfirmDel] = useState<Reservation | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 音声入力（既存 useSpeech + parseScheduleFromText を再利用）
  const lastVoiceRef = useRef('');
  const { supported: speechSupported, listening, start: startSpeech, stop: stopSpeech } = useSpeech((t) => {
    lastVoiceRef.current = t;
  });

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }

  async function refresh() {
    const { reservations } = await listReservations();
    setItems(reservations);
  }

  useEffect(() => {
    setLocal(isLocalHost());
    const s = loadOllamaSettings();
    setOllamaModel(s.model);
    if (isLocalHost() && s.enabled) testOllama(s.endpoint).then((r) => setOllamaOk(r.ok));
    else setOllamaOk(false);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const weekStart = useMemo(() => mondayOf(anchor), [anchor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = useMemo(() => startOfDay(new Date()), []);

  // 検索＋カテゴリで絞った全予定
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      if (catFilter !== 'all' && categoryOf(r) !== catFilter) return false;
      if (q.length > 0) {
        const hay = `${r.title} ${r.content}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, query, catFilter]);

  // 指定日の時間あり予定
  function dayTimedEvents(day: Date): Reservation[] {
    return filtered
      .filter((r) => r.scheduleAt !== null && sameDay(new Date(r.scheduleAt), day))
      .sort((a, b) => (a.scheduleAt ?? 0) - (b.scheduleAt ?? 0));
  }

  const selected = items.find((r) => r.id === selectedId) ?? null;

  // 選択日の予定（右下/詳細補助）。週の予定が無ければ最初の予定を自動選択
  useEffect(() => {
    if (selectedId && items.some((r) => r.id === selectedId)) return;
    const inWeek = filtered
      .filter((r) => r.scheduleAt !== null && weekDays.some((d) => sameDay(new Date(r.scheduleAt as number), d)))
      .sort((a, b) => (a.scheduleAt ?? 0) - (b.scheduleAt ?? 0));
    setSelectedId((inWeek[0] ?? filtered[0])?.id ?? null);
  }, [filtered, weekDays, items, selectedId]);

  // 今後の予定（今日以降、昇順 上位5件）
  const upcoming = useMemo(() => {
    const now = Date.now();
    return filtered
      .filter((r) => r.scheduleAt !== null && (r.scheduleAt as number) >= now)
      .sort((a, b) => (a.scheduleAt as number) - (b.scheduleAt as number))
      .slice(0, 5);
  }, [filtered]);

  // 今週のカテゴリ別件数集計
  const weekAgg = useMemo(() => {
    const wkEnd = addDays(weekStart, 7).getTime();
    const counts: Record<CatKey, number> = { work: 0, private: 0, health: 0, growth: 0 };
    items.forEach((r) => {
      if (r.scheduleAt === null) return;
      if (r.scheduleAt >= weekStart.getTime() && r.scheduleAt < wkEnd) counts[categoryOf(r)] += 1;
    });
    const total = counts.work + counts.private + counts.health + counts.growth;
    return { counts, total };
  }, [items, weekStart]);

  /* ── 操作 ── */
  function openCreate(prefillWhen?: string, prefillTitle?: string) {
    setNTitle(prefillTitle ?? '');
    setNContent('');
    setNWhen(prefillWhen ?? '');
    setNAllDay(false);
    setNNotify(false);
    setCreating(true);
  }

  async function handleCreate() {
    const title = nTitle.trim();
    if (title.length === 0) {
      showToast('予定のタイトルを入力してください。');
      return;
    }
    // 終日は日付のみ必須。通常は従来どおり（scheduleAt 互換・日時は任意）。
    let allDayStartAt: number | null = null;
    if (nAllDay) {
      const [y, m, d] = nWhen.trim().slice(0, 10).split('-').map(Number);
      if (!y || !m || !d) {
        showToast('終日の予定は日付を選んでください');
        return;
      }
      allDayStartAt = new Date(y, m - 1, d).getTime();
    }
    setNSaving(true);
    const { reservation, error } = await createReservation(
      nAllDay
        ? { title, content: nContent.trim(), startAt: allDayStartAt, endAt: null, allDay: true, notificationEnabled: nNotify }
        : { title, content: nContent.trim(), scheduleAt: localInputToMs(nWhen), allDay: false, notificationEnabled: nNotify },
    );
    setNSaving(false);
    if (error || !reservation) {
      showToast(error ?? '予定の保存に失敗しました。');
      return;
    }
    setCreating(false);
    await refresh();
    if (reservation.scheduleAt !== null) {
      setAnchor(new Date(reservation.scheduleAt));
      setSelectedDay(startOfDay(new Date(reservation.scheduleAt)));
    }
    setSelectedId(reservation.id);
    showToast('予定を作成しました');
  }

  async function handleDelete() {
    if (!confirmDel) return;
    setDeleting(true);
    const { ok, error } = await deleteReservation(confirmDel.id);
    setDeleting(false);
    if (!ok) {
      showToast(error ? `削除できませんでした：${error}` : '削除できませんでした。');
      setConfirmDel(null);
      return;
    }
    setConfirmDel(null);
    setSelectedId(null);
    await refresh();
    showToast('予定を削除しました');
  }

  // クイック追加：今日 / 明日 / 時間指定
  async function quickAdd(kind: 'today' | 'tomorrow' | 'pick') {
    const title = quickTitle.trim();
    if (title.length === 0) {
      showToast('予定タイトルを入力してください。');
      return;
    }
    if (kind === 'pick') {
      const base = new Date();
      base.setHours(base.getHours() + 1, 0, 0, 0);
      openCreate(msToLocalInput(base.getTime()), title);
      setQuickTitle('');
      return;
    }
    const d = kind === 'today' ? new Date() : addDays(new Date(), 1);
    d.setHours(9, 0, 0, 0);
    const { reservation, error } = await createReservation({
      title,
      content: '',
      scheduleAt: d.getTime(),
      notificationEnabled: false,
    });
    if (error || !reservation) {
      showToast(error ?? '保存に失敗しました。');
      return;
    }
    setQuickTitle('');
    await refresh();
    setAnchor(d);
    setSelectedDay(startOfDay(d));
    setSelectedId(reservation.id);
    showToast(kind === 'today' ? '今日の予定に追加しました' : '明日の予定に追加しました');
  }

  // 音声でクイック追加：停止時に解析してフォームを開く
  function toggleVoice() {
    if (!speechSupported) {
      showToast('この環境では音声入力を利用できません。');
      return;
    }
    if (listening) {
      stopSpeech();
      const parsed = parseScheduleFromText(lastVoiceRef.current.trim());
      if (parsed.title.length === 0 && lastVoiceRef.current.trim().length === 0) {
        showToast('音声を聞き取れませんでした。');
        return;
      }
      openCreate(parsed.scheduleAt !== null ? msToLocalInput(parsed.scheduleAt) : '', parsed.title);
      setNContent(parsed.content);
    } else {
      lastVoiceRef.current = '';
      startSpeech('');
    }
  }

  function shareLink() {
    if (!selected) return;
    const text = `${selected.title}（${formatSchedule(selected.scheduleAt)}）`;
    navigator.clipboard?.writeText(text).then(
      () => showToast('共有リンクをコピーしました'),
      () => showToast('コピーできませんでした'),
    );
  }

  const periodLabel = `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日 〜`;

  return (
    <div className="fixed inset-0 z-40 hidden overflow-hidden bg-[#F7F8FC] lg:flex">
      {/* ── 左サイドバー ── */}
      <DesktopSidebar active="reservations" bottom={
        <>
          <div className="rounded-2xl border border-[#E8EAF3] bg-[#FBFBFE] p-3">
            <p className="mb-2 text-[11px] font-bold" style={{ color: MUTED }}>AI・音声ステータス</p>
            <StatusLine label="Ollama" ok={local && !!ollamaOk} okText="接続OK" ngText={local ? (ollamaOk === null ? '確認中…' : '未接続') : 'ローカル専用'} />
            <p className="ml-3.5 mt-0.5 text-[10px]" style={{ color: MUTED }}>モデル: {ollamaModel}</p>
            <div className="my-2 h-px bg-[#EEF0F5]" />
            <StatusLine label="Whisper" ok={local} okText="使用可能" ngText="ローカル専用" />
          </div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: LAVENDER }}>
            <p className="text-[12px] font-bold" style={{ color: NAVY }}>計画が未来をつくる</p>
            <p className="mt-1 text-[10px]" style={{ color: '#54607A' }}>今日の一歩が、明日のあなたを助けます。</p>
          </div>
        </>
      } />

      {/* ── 右側：ヘッダー＋本体 ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ヘッダー */}
        <header className="flex items-center gap-3 border-b border-[#E8EAF3] bg-white px-8 py-4">
          <div className="flex-1">
            <h1 className="text-[20px] font-extrabold" style={{ color: NAVY }}>予定管理</h1>
            <p className="text-[12px]" style={{ color: MUTED }}>スケジュールを整理して、効率的な毎日を過ごしましょう</p>
          </div>
          <button type="button" onClick={() => { setAnchor(new Date()); setSelectedDay(startOfDay(new Date())); }} className="rounded-xl border border-[#E8EAF3] px-3 py-2 text-[13px] font-bold" style={{ color: '#54607A' }}>今日</button>
          <div className="flex items-center overflow-hidden rounded-xl border border-[#E8EAF3]">
            <button type="button" onClick={() => setAnchor((d) => addDays(d, -7))} className="px-3 py-2 text-[14px]" style={{ color: '#54607A' }}>‹</button>
            <span className="border-x border-[#E8EAF3] px-3 py-2 text-[12px] font-semibold" style={{ color: NAVY }}>{periodLabel}</span>
            <button type="button" onClick={() => setAnchor((d) => addDays(d, 7))} className="px-3 py-2 text-[14px]" style={{ color: '#54607A' }}>›</button>
          </div>
          <div className="flex overflow-hidden rounded-xl border border-[#E8EAF3]">
            {(['week', 'month', 'list'] as View[]).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className="px-3 py-2 text-[12px] font-bold transition"
                style={view === v ? { backgroundColor: LAVENDER, color: PURPLE } : { backgroundColor: '#fff', color: '#A6AEC0' }}>
                {v === 'week' ? '週' : v === 'month' ? '月' : 'リスト'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => openCreate()} className="rounded-xl px-4 py-2.5 text-[13px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>＋ 新しい予定</button>
        </header>

        {/* 検索・フィルター行 */}
        <div className="flex items-center gap-2 px-8 py-3">
          <div className="relative w-72">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#A6AEC0' }}><SearchIcon size={15} /></span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="予定を検索..." className="w-full rounded-full border border-[#E8EAF3] bg-white py-2 pl-9 pr-4 text-[13px] outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
          </div>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value as CatKey | 'all')} className="rounded-full border border-[#E8EAF3] bg-white px-3 py-2 text-[12px] font-semibold outline-none" style={{ color: '#54607A' }}>
            <option value="all">すべてのカテゴリ</option>
            {(Object.keys(CATEGORIES) as CatKey[]).map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-2">
            {(Object.keys(CATEGORIES) as CatKey[]).map((k) => (
              <span key={k} className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: MUTED }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CATEGORIES[k].color }} />{CATEGORIES[k].label}
              </span>
            ))}
          </div>
        </div>

        {/* 本体スクロール */}
        <div className="flex flex-1 gap-6 overflow-hidden px-8 pb-6">
          {/* 中央 */}
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto pr-1">
            {view === 'week' ? (
              <WeekGrid
                weekDays={weekDays}
                today={today}
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
                dayEvents={dayTimedEvents}
                selectedId={selectedId}
                onSelectEvent={(r) => { setSelectedId(r.id); if (r.scheduleAt) setSelectedDay(startOfDay(new Date(r.scheduleAt))); }}
              />
            ) : view === 'list' ? (
              <ListView events={filtered} onSelect={(r) => setSelectedId(r.id)} selectedId={selectedId} />
            ) : (
              <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-[#E8EAF3] bg-white text-center text-[13px]" style={{ color: MUTED }}>
                月表示は準備中です。週／リスト表示をご利用ください。
              </div>
            )}

            {/* 下部カード */}
            <div className="grid grid-cols-2 gap-5">
              {/* 今後の予定 */}
              <div className="rounded-3xl border border-[#E8EAF3] bg-white p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[14px] font-extrabold" style={{ color: NAVY }}>今後の予定</p>
                </div>
                {upcoming.length === 0 ? (
                  <p className="py-6 text-center text-[12px]" style={{ color: MUTED }}>今後の予定はありません。</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {upcoming.map((r) => {
                      const c = CATEGORIES[categoryOf(r)];
                      return (
                        <button key={r.id} type="button" onClick={() => setSelectedId(r.id)} className="flex items-center gap-3 rounded-2xl border border-[#EEF0F5] px-3 py-2 text-left hover:bg-[#FBFBFE]">
                          <span className="h-8 w-1 rounded-full" style={{ backgroundColor: c.color }} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-bold" style={{ color: NAVY }}>{r.title}</p>
                            <p className="text-[11px]" style={{ color: MUTED }}>{formatSchedule(r.scheduleAt)}</p>
                          </div>
                          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: c.bg, color: c.color }}>{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <button type="button" onClick={() => setView('list')} className="mt-3 text-[12px] font-bold" style={{ color: PURPLE }}>すべての予定を見る →</button>
              </div>

              {/* カテゴリ別集計 */}
              <div className="rounded-3xl border border-[#E8EAF3] bg-white p-5">
                <p className="mb-3 text-[14px] font-extrabold" style={{ color: NAVY }}>カテゴリ別集計（今週）</p>
                <div className="flex items-center gap-5">
                  <CategoryPie counts={weekAgg.counts} total={weekAgg.total} />
                  <div className="flex flex-1 flex-col gap-1.5">
                    {(Object.keys(CATEGORIES) as CatKey[]).map((k) => (
                      <div key={k} className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[12px]" style={{ color: '#54607A' }}>
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CATEGORIES[k].color }} />{CATEGORIES[k].label}
                        </span>
                        <span className="text-[12px] font-bold" style={{ color: NAVY }}>{weekAgg.counts[k]} 件</span>
                      </div>
                    ))}
                    {weekAgg.total === 0 && <p className="text-[11px]" style={{ color: MUTED }}>今週の予定はありません。</p>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 右カラム */}
          <aside className="w-80 shrink-0 overflow-y-auto">
            {/* 予定の詳細 */}
            <section className="mb-5 rounded-3xl border border-[#E8EAF3] bg-white p-5 shadow-[0_6px_18px_rgba(31,53,104,0.04)]">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[14px] font-extrabold" style={{ color: NAVY }}>予定の詳細</p>
                {selected && <button type="button" onClick={() => setSelectedId(null)} className="text-[16px]" style={{ color: '#A6AEC0' }}>×</button>}
              </div>
              {!selected ? (
                <p className="py-8 text-center text-[12px]" style={{ color: MUTED }}>予定を選択すると詳細が表示されます。</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[16px] font-extrabold" style={{ color: NAVY }}>{selected.title || '無題の予定'}</h3>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: CATEGORIES[categoryOf(selected)].bg, color: CATEGORIES[categoryOf(selected)].color }}>{CATEGORIES[categoryOf(selected)].label}</span>
                  </div>
                  <div className="mt-3 flex flex-col gap-1.5 text-[12px]" style={{ color: '#54607A' }}>
                    <DetailRow icon="🕐" value={formatSchedule(selected.scheduleAt)} />
                    <DetailRow icon="🔁" value="繰り返しなし" />
                    <DetailRow icon="🔔" value={selected.notificationEnabled ? '通知ON' : '通知OFF'} />
                    {selected.content.trim().length > 0 && <DetailRow icon="📝" value={selected.content} />}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <SmallBtn label="編集" onClick={() => router.push(`/reservations/${selected.id}`)} />
                    <SmallBtn label="複製" onClick={() => openCreate(msToLocalInput(selected.scheduleAt), `${selected.title}（コピー）`)} />
                    <SmallBtn label="削除" danger onClick={() => setConfirmDel(selected)} />
                  </div>
                  <button type="button" onClick={() => showToast('Googleカレンダー連携は準備中です')} className="mt-2 w-full rounded-xl border border-[#E8EAF3] py-2 text-[12px] font-bold" style={{ color: '#54607A' }}>📅 Googleカレンダーに連携</button>
                  <button type="button" onClick={shareLink} className="mt-2 w-full rounded-xl border border-[#E8EAF3] py-2 text-[12px] font-bold" style={{ color: '#54607A' }}>🔗 共有リンクをコピー</button>
                </>
              )}
            </section>

            {/* クイック追加 */}
            <section className="rounded-3xl border border-[#E8EAF3] bg-white p-5 shadow-[0_6px_18px_rgba(31,53,104,0.04)]">
              <p className="mb-3 text-[14px] font-extrabold" style={{ color: NAVY }}>クイック追加</p>
              <input value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)} placeholder="予定タイトル" className="mb-3 w-full rounded-xl border border-[#E8EAF3] px-3 py-2.5 text-[13px] outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
              <div className="flex flex-col gap-2">
                <button type="button" onClick={() => quickAdd('today')} className="rounded-xl py-2.5 text-[13px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>今日の予定に追加</button>
                <button type="button" onClick={() => quickAdd('tomorrow')} className="rounded-xl border border-[#E8EAF3] py-2.5 text-[13px] font-bold" style={{ color: '#54607A' }}>明日の予定に追加</button>
                <button type="button" onClick={() => quickAdd('pick')} className="rounded-xl border border-[#E8EAF3] py-2.5 text-[13px] font-bold" style={{ color: '#54607A' }}>時間指定で追加</button>
                <button type="button" onClick={toggleVoice} className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-bold"
                  style={listening ? { backgroundColor: PURPLE, color: '#fff' } : { border: '1px solid #D9CEFF', color: PURPLE }}>
                  {listening ? <span className="h-2.5 w-2.5 rounded-sm bg-white" /> : <MicIcon size={15} />}
                  {listening ? '聞き取り中…（停止）' : '音声で追加'}
                </button>
              </div>
              {!speechSupported && <p className="mt-2 text-[10px]" style={{ color: MUTED }}>※ この環境では音声入力に対応していません。</p>}
            </section>
          </aside>
        </div>
      </div>

      {/* 作成モーダル */}
      {creating && (
        <Modal onClose={() => !nSaving && setCreating(false)}>
          <p className="text-[16px] font-bold" style={{ color: NAVY }}>新しい予定</p>
          <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="予定タイトル（例: 歯医者）" className="rounded-2xl border border-[#E8EAF3] px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
          <label className="text-[11px] font-semibold" style={{ color: MUTED }}>{nAllDay ? '予定日' : '予定日時'}</label>
          <input type={nAllDay ? 'date' : 'datetime-local'} value={nWhen} onChange={(e) => setNWhen(e.target.value)} className="rounded-2xl border border-[#E8EAF3] px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
          <label className="flex items-center gap-2 text-[13px]" style={{ color: NAVY }}>
            <input
              type="checkbox"
              checked={nAllDay}
              onChange={(e) => {
                const next = e.target.checked;
                setNAllDay(next);
                // 終日へ：日付部分だけ残す。通常へ：時刻が無ければ 00:00 を補う。
                setNWhen((cur) => (cur ? (next ? cur.slice(0, 10) : cur.length === 10 ? `${cur}T00:00` : cur) : cur));
              }}
            />
            {nAllDay ? '📅 終日 ON' : '📅 終日 OFF'}
          </label>
          <textarea value={nContent} onChange={(e) => setNContent(e.target.value)} rows={4} placeholder="内容メモ" className="resize-y rounded-2xl border border-[#E8EAF3] px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
          <label className="flex items-center gap-2 text-[13px]" style={{ color: NAVY }}>
            <input type="checkbox" checked={nNotify} onChange={(e) => setNNotify(e.target.checked)} />
            {nNotify ? '🔔 通知 ON' : '🔕 通知 OFF'}
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="rounded-2xl bg-gray-100 px-5 py-2.5 text-[14px] font-bold" style={{ color: '#54607A' }}>キャンセル</button>
            <button type="button" onClick={handleCreate} disabled={nSaving} className="rounded-2xl px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>{nSaving ? '保存中…' : '保存'}</button>
          </div>
        </Modal>
      )}

      {/* 削除確認 */}
      {confirmDel && (
        <Modal onClose={() => !deleting && setConfirmDel(null)}>
          <p className="text-center text-[15px] font-bold" style={{ color: NAVY }}>この予定を削除しますか？</p>
          <p className="text-center text-[12px]" style={{ color: MUTED }}>この操作は元に戻せません。</p>
          <div className="mt-2 flex gap-3">
            <button type="button" onClick={() => setConfirmDel(null)} disabled={deleting} className="flex-1 rounded-full border border-[#E8EAF3] py-3 text-[14px] font-semibold" style={{ color: MUTED }}>キャンセル</button>
            <button type="button" onClick={handleDelete} disabled={deleting} className="flex-1 rounded-full py-3 text-[14px] font-semibold text-white" style={{ backgroundColor: '#E05555' }}>{deleting ? '削除中…' : '削除'}</button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 z-[60] -translate-x-1/2">
          <span className="rounded-full bg-black/80 px-4 py-2 text-[13px] font-semibold text-white shadow-lg">{toast}</span>
        </div>
      )}
    </div>
  );
}

/* ── 週間グリッド ── */
function WeekGrid({
  weekDays, today, selectedDay, onSelectDay, dayEvents, selectedId, onSelectEvent,
}: {
  weekDays: Date[];
  today: Date;
  selectedDay: Date;
  onSelectDay: (d: Date) => void;
  dayEvents: (d: Date) => Reservation[];
  selectedId: string | null;
  onSelectEvent: (r: Reservation) => void;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-[#E8EAF3] bg-white">
      {/* 曜日ヘッダー */}
      <div className="grid border-b border-[#E8EAF3]" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
        <div className="py-3" />
        {weekDays.map((d, i) => {
          const isToday = sameDay(d, today);
          const isSel = sameDay(d, selectedDay);
          const isSat = i === 5;
          const isSun = i === 6;
          return (
            <button key={i} type="button" onClick={() => onSelectDay(d)} className="flex flex-col items-center gap-1 border-l border-[#EEF0F5] py-2"
              style={{ backgroundColor: isSat ? '#F4F8FE' : isSun ? '#FEF5F5' : '#fff' }}>
              <span className="text-[11px] font-semibold" style={{ color: isSat ? '#3B82C4' : isSun ? '#D6457E' : MUTED }}>{WD[i]}</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold"
                style={isToday ? { backgroundColor: PURPLE, color: '#fff' } : isSel ? { backgroundColor: LAVENDER, color: PURPLE } : { color: NAVY }}>
                {d.getDate()}
              </span>
            </button>
          );
        })}
      </div>
      {/* 時間グリッド */}
      <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
        {/* 時間軸 */}
        <div className="flex flex-col">
          {HOURS.map((h) => (
            <div key={h} className="h-14 border-b border-[#F4F5F9] pr-2 pt-1 text-right text-[10px]" style={{ color: '#A6AEC0' }}>{String(h).padStart(2, '0')}:00</div>
          ))}
        </div>
        {weekDays.map((d, i) => {
          const evs = dayEvents(d);
          const isSat = i === 5, isSun = i === 6;
          return (
            <div key={i} className="relative border-l border-[#EEF0F5]" style={{ backgroundColor: isSat ? '#FAFCFF' : isSun ? '#FFFAFA' : '#fff' }}>
              {HOURS.map((h) => (<div key={h} className="h-14 border-b border-[#F4F5F9]" />))}
              {evs.map((r) => {
                const dt = new Date(r.scheduleAt as number);
                const minutes = dt.getHours() * 60 + dt.getMinutes();
                const top = ((minutes - 8 * 60) / 60) * 56; // 1時間=56px(h-14)
                if (top < -20 || top > HOURS.length * 56) return null;
                const c = CATEGORIES[categoryOf(r)];
                const sel = r.id === selectedId;
                return (
                  <button key={r.id} type="button" onClick={() => onSelectEvent(r)}
                    className="absolute left-1 right-1 overflow-hidden rounded-lg px-1.5 py-1 text-left"
                    style={{ top: Math.max(top, 0), minHeight: 44, backgroundColor: c.bg, border: `1px solid ${sel ? c.color : c.border}`, boxShadow: sel ? `0 0 0 1px ${c.color}` : 'none' }}>
                    <p className="text-[10px] font-bold" style={{ color: c.color }}>{String(dt.getHours()).padStart(2, '0')}:{String(dt.getMinutes()).padStart(2, '0')}</p>
                    <p className="truncate text-[11px] font-bold" style={{ color: NAVY }}>{r.title}</p>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── リスト表示 ── */
function ListView({ events, onSelect, selectedId }: { events: Reservation[]; onSelect: (r: Reservation) => void; selectedId: string | null }) {
  const sorted = [...events].sort((a, b) => {
    if (a.scheduleAt === null) return 1;
    if (b.scheduleAt === null) return -1;
    return a.scheduleAt - b.scheduleAt;
  });
  if (sorted.length === 0) {
    return <div className="flex h-48 items-center justify-center rounded-3xl border border-dashed border-[#E8EAF3] bg-white text-[13px]" style={{ color: MUTED }}>予定がありません。</div>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-3xl border border-[#E8EAF3] bg-white p-4">
      {sorted.map((r) => {
        const c = CATEGORIES[categoryOf(r)];
        const sel = r.id === selectedId;
        return (
          <button key={r.id} type="button" onClick={() => onSelect(r)} className="flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition"
            style={{ borderColor: sel ? c.color : '#EEF0F5', backgroundColor: sel ? c.bg : '#fff' }}>
            <span className="h-9 w-1 rounded-full" style={{ backgroundColor: c.color }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-bold" style={{ color: NAVY }}>{r.title || '無題の予定'}</p>
              <p className="text-[11px]" style={{ color: MUTED }}>{formatSchedule(r.scheduleAt)}</p>
            </div>
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: c.bg, color: c.color }}>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── カテゴリ円グラフ ── */
function CategoryPie({ counts, total }: { counts: Record<CatKey, number>; total: number }) {
  if (total === 0) {
    return <div className="h-20 w-20 shrink-0 rounded-full border-8 border-[#EEF0F5]" />;
  }
  const order: CatKey[] = ['work', 'private', 'health', 'growth'];
  let acc = 0;
  const stops = order.map((k) => {
    const start = (acc / total) * 100;
    acc += counts[k];
    const end = (acc / total) * 100;
    return `${CATEGORIES[k].color} ${start}% ${end}%`;
  });
  return (
    <div className="relative h-20 w-20 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops.join(', ')})` }}>
      <span className="absolute inset-[10px] flex items-center justify-center rounded-full bg-white text-[12px] font-extrabold" style={{ color: NAVY }}>{total}件</span>
    </div>
  );
}

/* ── 小コンポーネント ── */
function DetailRow({ icon, value }: { icon: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0">{icon}</span>
      <span className="leading-relaxed">{value}</span>
    </div>
  );
}

function SmallBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border py-2 text-[12px] font-bold"
      style={danger ? { borderColor: '#F3D2D2', color: '#C0392B' } : { borderColor: '#E8EAF3', color: '#54607A' }}>
      {label}
    </button>
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

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex w-full max-w-md flex-col gap-3 rounded-3xl border border-[#E8EAF3] bg-white p-6 shadow-[0_20px_60px_rgba(31,53,104,0.18)]">
        {children}
      </div>
    </div>
  );
}
