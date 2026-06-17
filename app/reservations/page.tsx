'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarIcon, ChevronRightIcon, MicIcon } from '@/components/icons';
import SwipeableRow from '@/components/SwipeableRow';
import DesktopSchedules from '@/components/DesktopSchedules';
import { useSpeech } from '@/lib/useSpeech';
import { parseScheduleFromText, containsScheduleNoise } from '@/lib/parse/schedule';
import {
  createReservation,
  deleteReservation,
  formatSchedule,
  listReservations,
  localInputToMs,
  msToLocalInput,
} from '@/lib/reservations';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import type { Reservation } from '@/lib/types';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const LAVENDER = '#EEF0FF';

// 配信コード確認用マーカー。ngrok 経由でも最新コードが読み込まれているか画面で確認できる。
// （古いビルドが配信されているとこのバージョンは表示されない/古い値のまま）
const SCHEDULE_CODE_VERSION = 'sched-voice-v6-additional-guard';

// 開発用デバッグ表示の出し分け。NEXT_PUBLIC_DEBUG_MODE=true のときだけ画面に出す。
// （通常ユーザーにはマーカー・transcript・解析結果などを一切表示しない）
const DEBUG_MODE = process.env.NEXT_PUBLIC_DEBUG_MODE === 'true';

type Filter = 'today' | 'upcoming' | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'upcoming', label: '今後' },
  { key: 'all', label: 'すべて' },
];

function startOfToday(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}
function endOfToday(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - 1;
}

function PencilIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export default function ReservationsPage() {
  const configured = isSupabaseConfigured();
  const [items, setItems] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('today');
  const [needLogin, setNeedLogin] = useState(false);
  // スワイプ削除：開いている行のID、削除確認対象、削除中フラグ
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [confirmReservation, setConfirmReservation] = useState<Reservation | null>(null);
  const [deletingReservation, setDeletingReservation] = useState(false);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [scheduleLocal, setScheduleLocal] = useState('');
  const [notify, setNotify] = useState(false);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  // 音声入力のモード（normal=クイック / additional=フォーム内 追加音声）とデバッグ表示
  const [voiceMode, setVoiceMode] = useState<'normal' | 'additional' | null>(null);
  const [voiceDebug, setVoiceDebug] = useState({
    transcript: '',
    title: '',
    dt: '',
    content: '',
    rejected: '',
    finalTitle: '',
  });

  // 音声認識（メモ画面と同じ useSpeech フックを共用）。
  // 認識テキストはライブで解析し、タイトル/日時/内容へ振り分ける（全文をタイトルに入れない）。
  const lastVoiceRef = useRef('');
  const isDev = process.env.NODE_ENV !== 'production';
  const {
    supported: speechSupported,
    listening,
    start: startSpeech,
    stop: stopSpeech,
  } = useSpeech((t) => {
    lastVoiceRef.current = t;
    if (isDev) console.log('[reservations] transcript received (len):', t.trim().length);
    // ライブで解析してフォームへ反映（停止を押さなくても title/日時/内容が正しく埋まる）
    applyVoice(t);
  });

  // タイトル更新の単一経路（開発時はソース付きでログ）。生テキスト/ノイズは弾く。
  // normal / additional のどちらの音声経路もここを必ず通る。
  function setTitleSafe(value: string, source: string) {
    const v = value ?? '';
    if (isDev) console.log(`[reservations] setTitle source=${source}`, JSON.stringify(v));
    // 音声由来でノイズ（日時・内容ラベル）が残る値は採用しない（生テキスト混入の最終防壁）
    if (source !== 'manual' && containsScheduleNoise(v)) {
      if (isDev) console.warn('[reservations] setTitle blocked (schedule noise):', JSON.stringify(v));
      setVoiceDebug((d) => ({ ...d, rejected: `ノイズ検出のため不採用: ${v}` }));
      setTitle('');
      return;
    }
    setTitle(v);
  }

  // 音声：全文を必ず parseScheduleFromText で解析してから各フィールドへ振り分ける唯一の経路。
  // normal（クイック）も additional（フォーム内）も applyVoice を通る。setTitle(transcript) は行わない。
  function applyVoice(text: string) {
    const t = text.trim();
    if (isDev) console.log('[reservations] applyVoice: transcript =', JSON.stringify(t));
    if (t.length === 0) return;
    const parsed = parseScheduleFromText(t);
    if (isDev) {
      console.log('[reservations] parse result:', {
        title: parsed.title,
        scheduleAt: parsed.scheduleAt ? new Date(parsed.scheduleAt).toISOString() : null,
        contentLen: parsed.content.length,
      });
    }
    // 画面デバッグ用に解析結果を記録
    setVoiceDebug((d) => ({
      ...d,
      transcript: t,
      title: parsed.title,
      dt: parsed.scheduleAt ? new Date(parsed.scheduleAt).toLocaleString('ja-JP') : '(なし)',
      content: parsed.content,
      rejected: '',
    }));
    setTitleSafe(parsed.title, 'parsed');
    setContent(parsed.content);
    if (parsed.scheduleAt !== null) {
      setScheduleLocal(msToLocalInput(parsed.scheduleAt));
      setVoiceHint(parsed.title.length === 0 ? 'タイトルを聞き取れませんでした。もう一度話すか、手入力してください。' : null);
    } else {
      // 日時が取れない＝聞き取り失敗。生テキストはタイトルに残さない方針を明示する。
      setVoiceHint('予定の日時を読み取れませんでした。日時を含めて話してください（例：明日の15時に歯医者）。');
    }
  }

  // 音声入力開始。mode で normal（クイック）/ additional（フォーム内 追加音声）を区別する。
  // 非対応環境では無反応にせず日本語エラーを表示。
  function startVoiceAdd(mode: 'normal' | 'additional') {
    openForm();
    setVoiceMode(mode);
    setVoiceDebug({ transcript: '', title: '', dt: '', content: '', rejected: '', finalTitle: '' });
    if (isDev) console.log(`[reservations] voice add tapped. mode=${mode} supported=${speechSupported}`);
    if (!speechSupported) {
      setSaveError('この環境では音声入力を開始できません。HTTPS環境または対応ブラウザで確認してください。');
      if (isDev) console.error('[reservations] SpeechRecognition is not available in this context (HTTP/unsupported browser).');
      return;
    }
    lastVoiceRef.current = '';
    setContent('');
    startSpeech('');
    if (isDev) console.log('[reservations] recognition started');
  }

  function stopVoiceAdd() {
    stopSpeech();
    if (isDev) console.log('[reservations] recognition stopped');
    applyVoice(lastVoiceRef.current);
  }

  async function refresh(): Promise<Reservation[]> {
    setLoading(true);
    const { reservations, error } = await listReservations();
    setItems(reservations);
    setListError(error);
    setLoading(false);
    return reservations;
  }

  useEffect(() => {
    if (isDev) console.log('[reservations] mounted. code version =', SCHEDULE_CODE_VERSION);
    if (configured) {
      void refresh();
      // ngrok など別オリジンではセッションが共有されない。ログイン状態を確認して案内する。
      const sb = getSupabaseBrowserClient();
      void sb?.auth.getUser().then(({ data }) => {
        const loggedIn = Boolean(data.user?.id);
        setNeedLogin(!loggedIn);
        if (isDev) console.log('[reservations] auth check on mount: loggedIn =', loggedIn);
      });
    } else {
      setLoading(false);
    }
    if (typeof window !== 'undefined') {
      const flash = window.sessionStorage.getItem('reservation_flash');
      if (flash) {
        setSaveOk(flash);
        window.sessionStorage.removeItem('reservation_flash');
      }
    }
    // 画面に戻ってきたとき（タブ切替・他画面から復帰）に最新の予定を再読込する
    if (!configured) return;
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  function openForm() {
    setSaveError(null);
    setSaveOk(null);
    setVoiceHint(null);
    setFormOpen(true);
  }

  async function handleCreate() {
    setSaveError(null);
    setSaveOk(null);
    if (isDev) console.log('[reservations] save button clicked');

    // 録音中に保存された場合は停止して最新テキストを反映
    if (listening) stopVoiceAdd();

    // 保存時に音声テキストを再解析して、タイトル・日時を補完する。
    // （音声入力後にユーザーが「停止」を押さず保存しても、日時が取りこぼされないように）
    let scheduleAt = localInputToMs(scheduleLocal);
    let finalTitle = title.trim();
    let finalContent = content.trim();
    if (scheduleAt === null || finalTitle.length === 0) {
      // 録音直後は setState が未反映のことがあるため、音声の生テキスト(ref)も解析元に使う
      const src = finalContent || finalTitle || lastVoiceRef.current.trim();
      if (src.length > 0) {
        const parsed = parseScheduleFromText(src);
        if (scheduleAt === null) scheduleAt = parsed.scheduleAt;
        if (finalTitle.length === 0) {
          finalTitle = parsed.title;
          // 音声全文からタイトルを起こした場合、生の文をそのまま詳細欄に残さない
          finalContent = parsed.content;
        }
      }
    }

    // 保存前の最終防壁：タイトルに日時/内容ラベル等のノイズが残っていたら必ず再解析する。
    // （UIステートが一時的に誤っていても、生テキストがDBに保存されるのを防ぐ）
    if (containsScheduleNoise(finalTitle)) {
      if (isDev) console.warn('[reservations] title has schedule noise → re-parse before save:', JSON.stringify(finalTitle));
      const parsed = parseScheduleFromText(finalTitle);
      if (scheduleAt === null) scheduleAt = parsed.scheduleAt;
      finalTitle = parsed.title;
      if (finalContent.length === 0) finalContent = parsed.content;
    }

    // 画面デバッグ：保存直前のタイトルを記録（生テキストが残っていないか確認できる）
    setVoiceDebug((d) => ({ ...d, finalTitle }));
    if (isDev) {
      console.log('[reservations] form state before save:', {
        titleLength: finalTitle.length,
        scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : null,
      });
    }

    if (finalTitle.length === 0) {
      setSaveError('予定のタイトルを入力してください。');
      return;
    }

    setSaving(true);
    const { reservation, error } = await createReservation({
      title: finalTitle,
      content: finalContent,
      scheduleAt,
      notificationEnabled: notify,
    });
    setSaving(false);
    if (isDev) console.log('[reservations] createReservation result:', { ok: Boolean(reservation), error });
    if (error || !reservation) {
      // createReservation は既にユーザー向け日本語メッセージを返すのでそのまま表示
      setSaveError(error ?? '予定の保存に失敗しました。入力内容とログイン状態を確認してください。');
      return;
    }

    // 保存後に一覧を再取得（ベストエフォート）。insert は id 付きで成功確認済みなので、
    // 一覧反映が遅れても保存失敗扱いにはしない（誤検知で「保存できたのに失敗」を防ぐ）。
    const latest = await refresh();
    if (isDev && !latest.some((r) => r.id === reservation.id)) {
      console.warn('[reservations] 保存は成功したが一覧再取得に未反映（反映遅延の可能性）');
    }

    setTitle('');
    setContent('');
    setScheduleLocal('');
    setNotify(false);
    setFormOpen(false);
    // 新しい予定が確実に見えるタブへ切り替え、行き先をメッセージで伝える
    if (scheduleAt !== null && scheduleAt >= startOfToday() && scheduleAt <= endOfToday()) {
      setFilter('today');
      setSaveOk('保存しました。今日の予定に追加されました。');
    } else if (scheduleAt !== null && scheduleAt > endOfToday()) {
      setFilter('upcoming');
      setSaveOk('保存しました。今後の予定に追加されました。');
    } else {
      setFilter('all');
      setSaveOk('保存しました。「すべて」に表示されています。');
    }
  }

  // スワイプの「削除」タップ → 確認モーダルを表示（対象は1件のみ）
  function requestDeleteReservation(r: Reservation) {
    setSaveError(null);
    setConfirmReservation(r);
  }

  // 確認後：選択した予定だけを削除して一覧を再取得
  async function performDeleteReservation() {
    if (!confirmReservation) return;
    setDeletingReservation(true);
    const { ok, error } = await deleteReservation(confirmReservation.id);
    setDeletingReservation(false);
    if (!ok) {
      setConfirmReservation(null);
      setSaveError(`予定を削除できませんでした${error ? `：${error}` : '。'}`);
      return;
    }
    setConfirmReservation(null);
    setOpenSwipeId(null);
    await refresh(); // 一覧を再取得（Home・AI相談は各画面の focus 再取得で反映）
    setSaveOk('予定を削除しました。');
  }

  // フィルター適用（予定日時の昇順。null は末尾）
  const filtered = useMemo(() => {
    const sFrom = startOfToday();
    const tEnd = endOfToday();
    const list = items.filter((r) => {
      if (filter === 'all') return true;
      if (r.scheduleAt === null) return false;
      if (filter === 'today') return r.scheduleAt >= sFrom && r.scheduleAt <= tEnd;
      return r.scheduleAt > tEnd; // upcoming
    });
    return list.sort((a, b) => {
      if (a.scheduleAt === null && b.scheduleAt === null) return 0;
      if (a.scheduleAt === null) return 1;
      if (b.scheduleAt === null) return -1;
      return a.scheduleAt - b.scheduleAt;
    });
  }, [items, filter]);

  if (!configured) {
    return (
      <div className="flex flex-col gap-4" style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
        <h1 className="text-[22px] font-bold" style={{ color: NAVY }}>
          予定管理
        </h1>
        <p className="rounded-2xl border border-[#E5E8F0] bg-yellow-50 p-4 text-sm text-yellow-800">
          Supabase が未設定です。<code>.env.local</code> を設定して再起動してください。
        </p>
      </div>
    );
  }

  return (
    <>
    <DesktopSchedules />
    <div className="flex flex-col gap-5 lg:hidden" style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-bold" style={{ color: NAVY }}>
          予定管理
          {/* 配信コード確認用マーカー（デバッグモード時のみ表示） */}
          {DEBUG_MODE && (
            <span className="ml-2 align-middle text-[10px] font-normal" style={{ color: '#C0C8D8' }}>
              {SCHEDULE_CODE_VERSION}
            </span>
          )}
        </h1>
        <button
          type="button"
          onClick={() => (formOpen ? setFormOpen(false) : openForm())}
          className="flex items-center gap-1 rounded-full px-4 py-2 text-[13px] font-bold text-white active:opacity-80"
          style={{ backgroundColor: NAVY, boxShadow: '0 4px 12px rgba(34,58,112,0.25)' }}>
          {formOpen ? '閉じる' : '＋ 新規'}
        </button>
      </div>

      {/* 未ログイン案内（ngrok など別オリジンでセッション未確立のとき） */}
      {needLogin && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3">
          <p className="text-[13px] font-semibold text-yellow-800">
            予定を保存するにはログインが必要です。
          </p>
          <Link
            href="/login"
            className="shrink-0 rounded-full px-4 py-2 text-[12px] font-bold text-white active:opacity-80"
            style={{ backgroundColor: NAVY }}>
            ログイン
          </Link>
        </div>
      )}

      {/* クイックアクション */}
      <div className="relative z-20 flex gap-3">
        <button
          type="button"
          onClick={() => (listening ? stopVoiceAdd() : startVoiceAdd('normal'))}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl border py-3 text-[13px] font-semibold shadow-[0_8px_24px_rgba(31,53,104,0.07)] active:opacity-60"
          style={
            listening
              ? { backgroundColor: '#7B61FF', borderColor: '#7B61FF', color: '#fff' }
              : { backgroundColor: '#fff', borderColor: '#E5E8F0', color: NAVY }
          }>
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ backgroundColor: listening ? 'rgba(255,255,255,0.25)' : LAVENDER }}>
            {listening ? <span className="h-2.5 w-2.5 rounded-sm bg-white" /> : <MicIcon size={16} />}
          </span>
          {listening ? '聞き取り中…（停止）' : '音声で追加'}
        </button>
        <button
          type="button"
          onClick={openForm}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#E5E8F0] bg-white py-3 text-[13px] font-semibold shadow-[0_8px_24px_rgba(31,53,104,0.07)] active:opacity-60"
          style={{ color: NAVY }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: LAVENDER }}>
            <PencilIcon size={15} />
          </span>
          手入力で追加
        </button>
      </div>

      {/* 新規フォーム */}
      {formOpen && (
        <div className="flex flex-col gap-3 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
          {/* 音声入力：例「明日の15時に歯医者」→ タイトル/日時/内容を自動抽出（停止後に手修正可） */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={listening ? '音声入力を停止' : '追加音声入力'}
              onClick={() => (listening ? stopVoiceAdd() : startVoiceAdd('additional'))}
              className="relative z-20 flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[13px] font-bold active:opacity-60"
              style={
                listening
                  ? { backgroundColor: '#7B61FF', color: '#fff' }
                  : { backgroundColor: '#F3F5FA', color: NAVY }
              }>
              {listening ? <span className="h-2.5 w-2.5 rounded-sm bg-white" /> : <MicIcon size={16} />}
              {listening ? '聞き取り中…（停止）' : '🎤 音声入力'}
            </button>
            <span className="text-[11px]" style={{ color: '#A6AEC0' }}>
              例：明日の15時に歯医者
            </span>
          </div>
          {!speechSupported && (
            <p className="rounded-xl bg-yellow-50 px-3 py-2 text-[12px] font-semibold text-yellow-700">
              この環境では音声入力を開始できません。HTTPS環境または対応ブラウザで確認してください。
            </p>
          )}
          {voiceHint && <p className="text-[12px] text-yellow-700">{voiceHint}</p>}
          {/* 音声入力デバッグ表示（NEXT_PUBLIC_DEBUG_MODE=true のときのみ。通常ユーザーには非表示） */}
          {DEBUG_MODE && (voiceDebug.transcript || voiceMode) && (
            <div className="rounded-xl border border-dashed border-[#C9D2E8] bg-[#F7F8FC] px-3 py-2 text-[11px] leading-relaxed" style={{ color: '#5B6577' }}>
              <div className="font-bold" style={{ color: NAVY }}>🔎 {SCHEDULE_CODE_VERSION}</div>
              <div>mode: {voiceMode ?? '-'}</div>
              <div>transcript: {voiceDebug.transcript || '-'}</div>
              <div>parsed title: {voiceDebug.title || '-'}</div>
              <div>parsed datetime: {voiceDebug.dt || '-'}</div>
              <div>parsed content: {voiceDebug.content || '-'}</div>
              {voiceDebug.rejected && <div className="text-red-600">rejected: {voiceDebug.rejected}</div>}
              {voiceDebug.finalTitle && <div>final title (save): {voiceDebug.finalTitle}</div>}
            </div>
          )}
          <input
            className="rounded-xl border border-[#E5E8F0] bg-[#F7F8FC] px-3 py-2.5 text-[14px] outline-none focus:border-[#C9D2E8]"
            placeholder="予定タイトル（例: 歯医者）"
            value={title}
            onChange={(e) => setTitleSafe(e.target.value, 'manual')}
          />
          <label className="text-[11px] font-semibold" style={{ color: MUTED }}>
            予定日時
          </label>
          <input
            className="rounded-xl border border-[#E5E8F0] bg-[#F7F8FC] px-3 py-2.5 text-[14px] outline-none focus:border-[#C9D2E8]"
            type="datetime-local"
            value={scheduleLocal}
            onChange={(e) => setScheduleLocal(e.target.value)}
          />
          <textarea
            className="min-h-20 rounded-xl border border-[#E5E8F0] bg-[#F7F8FC] px-3 py-2.5 text-[14px] outline-none focus:border-[#C9D2E8]"
            placeholder="内容メモ"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <label className="flex items-center gap-2 text-[13px]" style={{ color: NAVY }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            {notify ? '🔔 通知 ON' : '🔕 通知 OFF'}
          </label>
          {saveError && (
            <p className="rounded-xl bg-red-50 px-3 py-2.5 text-[13px] font-semibold text-red-600">
              {saveError}
            </p>
          )}
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="self-end rounded-full px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
            style={{ backgroundColor: '#7B61FF' }}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      )}

      {saveOk && (
        <p className="rounded-full bg-[#EAF7EF] px-4 py-2 text-center text-[13px] font-semibold text-green-700">
          {saveOk}
        </p>
      )}
      {listError && <p className="text-[13px] text-red-600">一覧エラー：{listError}</p>}

      {/* フィルタータブ */}
      <div className="flex gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className="flex-1 rounded-full px-4 py-2 text-[13px] font-semibold transition"
              style={
                active
                  ? { backgroundColor: NAVY, color: '#fff', boxShadow: '0 4px 12px rgba(34,58,112,0.25)' }
                  : { backgroundColor: '#F3F5FA', color: MUTED }
              }>
              {f.label}
            </button>
          );
        })}
      </div>

      {/* 一覧 */}
      {loading ? (
        <p className="py-8 text-center text-sm" style={{ color: '#A6AEC0' }}>
          読み込み中…
        </p>
      ) : filtered.length === 0 ? (
        <EmptyState filter={filter} onAdd={openForm} />
      ) : (
        <section className="flex flex-col gap-3">
          {filtered.map((r) => (
            <SwipeableRow
              key={r.id}
              open={openSwipeId === r.id}
              onOpenChange={(o) => setOpenSwipeId(o ? r.id : null)}
              onDelete={() => requestDeleteReservation(r)}>
              <Link
                href={`/reservations/${r.id}`}
                className="flex items-start gap-3 rounded-3xl border border-[#E5E8F0] bg-white p-4 shadow-[0_10px_28px_rgba(31,53,104,0.07)] active:opacity-70">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: LAVENDER, color: NAVY }}>
                  <CalendarIcon size={20} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[12px] font-semibold" style={{ color: '#A6AEC0' }}>
                    {formatSchedule(r.scheduleAt)}
                  </span>
                  <span className="text-[15px] font-bold text-[#1F2937]">{r.title || '無題の予定'}</span>
                  {r.content.trim().length > 0 && (
                    <span className="line-clamp-2 text-[13px] leading-relaxed" style={{ color: MUTED }}>
                      {r.content}
                    </span>
                  )}
                </div>
                <span className="mt-1 shrink-0" style={{ color: '#A6AEC0' }}>
                  <ChevronRightIcon size={16} />
                </span>
              </Link>
            </SwipeableRow>
          ))}
        </section>
      )}

      {/* 予定の削除確認モーダル（スワイプ削除） */}
      {confirmReservation && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-10 sm:items-center sm:pb-0">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => !deletingReservation && setConfirmReservation(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-[#E5E8F0] bg-white p-6 shadow-[0_20px_60px_rgba(31,53,104,0.18)]">
            <p className="text-center text-[15px] font-bold" style={{ color: NAVY }}>
              この予定を削除しますか？
            </p>
            <p className="mt-1 text-center text-[12px]" style={{ color: MUTED }}>
              この操作は元に戻せません。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmReservation(null)}
                disabled={deletingReservation}
                className="min-h-[44px] flex-1 rounded-full border border-[#E5E8F0] py-3 text-[14px] font-semibold disabled:opacity-60"
                style={{ color: MUTED }}>
                キャンセル
              </button>
              <button
                type="button"
                onClick={performDeleteReservation}
                disabled={deletingReservation}
                className="min-h-[44px] flex-1 rounded-full py-3 text-[14px] font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: '#E05555' }}>
                {deletingReservation ? '削除中…' : '削除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

function EmptyState({ filter, onAdd }: { filter: Filter; onAdd: () => void }) {
  const title =
    filter === 'today'
      ? '今日はまだ予定がありません'
      : filter === 'upcoming'
        ? '今後の予定はまだありません'
        : 'まだ予定がありません';
  return (
    <section className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-[#E5E8F0] bg-white/60 px-5 py-12 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: LAVENDER, color: NAVY }}>
        <CalendarIcon size={28} />
      </span>
      <p className="text-[15px] font-bold" style={{ color: NAVY }}>
        {title}
      </p>
      <p className="max-w-[260px] text-[12px] leading-relaxed" style={{ color: MUTED }}>
        新しい予定を追加して、スケジュールを整理しましょう。
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-1 rounded-full px-5 py-2.5 text-[13px] font-bold text-white active:opacity-80"
        style={{ backgroundColor: '#7B61FF', boxShadow: '0 4px 12px rgba(123,97,255,0.25)' }}>
        ＋ 予定を追加
      </button>
    </section>
  );
}
