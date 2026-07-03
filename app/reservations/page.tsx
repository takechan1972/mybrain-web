'use client';

import Link from 'next/link';
import NextImage from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import DesktopSchedules from '@/components/DesktopSchedules';
import VoiceInput from '@/components/VoiceInput';
import { SendIcon } from '@/components/icons';
import { createReservation, localInputToMs } from '@/lib/reservations';
import {
  exportReservationToGoogleCalendar,
  isGoogleCalendarConfigured,
  readGoogleCalendarEventsInRange,
} from '@/lib/google';
import type { GoogleCalendarEvent } from '@/lib/google';
import type { Reservation } from '@/lib/types';
import { isPaidPlan } from '@/lib/plan';
import { useFullAccess } from '@/lib/auth/use-full-access';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';

const NAVY = '#223A70';
const MUTED = '#8A94A6';

/** epoch ms を端末ローカルの "HH:mm" にする（読み取り表示用）。null は空文字。 */
function formatEventClock(ms: number | null): string {
  if (ms == null) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
  const router = useRouter();
  const configured = isSupabaseConfigured();
  // 無料プランは AI相談バーをロック（有料プランで利用可）。運営/家族はフルアクセスで利用可。
  const fullAccess = useFullAccess();
  const isPaid = isPaidPlan() || fullAccess;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  // 保存後の Googleカレンダー追加導線（設定済み＆開始日時ありのときだけ表示。OAuthはタップ後のみ）
  const [savedCalReservation, setSavedCalReservation] = useState<Reservation | null>(null);
  const [calBusy, setCalBusy] = useState(false);
  const [calMsg, setCalMsg] = useState<string | null>(null);
  const [calOk, setCalOk] = useState(false);
  // Googleカレンダー「今日の予定」読み取り表示（ユーザーのタップ起点のみ・保存しない）
  const [calReadConfigured, setCalReadConfigured] = useState(false);
  const [calReadLoading, setCalReadLoading] = useState(false);
  const [calReadMsg, setCalReadMsg] = useState<string | null>(null);
  const [calReadEvents, setCalReadEvents] = useState<GoogleCalendarEvent[] | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [startLocal, setStartLocal] = useState(''); // 予定開始日時（= scheduleAt）
  const [endLocal, setEndLocal] = useState('');      // 予定終了日時（UI・内容メモへ反映）
  const [allDay, setAllDay] = useState(false);       // 終日（UI・内容メモへ反映）
  const [notify, setNotify] = useState(false);

  // AI質問バー（/consult のマイク付き入力バーと同じ仕組み。VoiceInput で音声入力 → /consult へ受け渡し）
  const [aiAsk, setAiAsk] = useState('');
  const aiBaseRef = useRef('');
  function goConsultFromReservation() {
    const q = aiAsk.trim();
    router.push(q ? `/consult?q=${encodeURIComponent(q)}` : '/consult');
  }

  useEffect(() => {
    // Googleカレンダー連携の公開設定が揃っているかだけ判定（SSR では false のまま）。
    // ここでは絶対に予定を取得しない（OAuth ポップアップはタップ後のみ）。
    setCalReadConfigured(isGoogleCalendarConfigured());
    if (configured) {
      const sb = getSupabaseBrowserClient();
      void sb?.auth.getUser().then(({ data }) => setNeedLogin(!data.user?.id));
    }
    if (typeof window !== 'undefined') {
      const flash = window.sessionStorage.getItem('reservation_flash');
      if (flash) {
        setSaveOk(flash);
        window.sessionStorage.removeItem('reservation_flash');
      }
    }
  }, [configured]);

  // 終日トグル。開始入力は終日=日付のみ / 通常=日時 と型が変わるため、値の形式も合わせて変換する。
  function toggleAllDay() {
    const next = !allDay;
    setAllDay(next);
    setStartLocal((cur) => {
      if (!cur) return cur;
      // 終日へ：日付部分だけ残す（YYYY-MM-DD）。通常へ：時刻が無ければ 00:00 を補う。
      return next ? cur.slice(0, 10) : cur.length === 10 ? `${cur}T00:00` : cur;
    });
  }

  async function handleCreate() {
    setSaveError(null);
    setSaveOk(null);
    setSavedCalReservation(null);
    setCalMsg(null);
    setCalOk(false);

    const finalTitle = title.trim();
    if (finalTitle.length === 0) {
      setSaveError('予定のタイトルを入力してください。');
      return;
    }

    // 開始日時：終日は「日付のみ」必須、通常は「日時」必須。
    let startAt: number;
    if (allDay) {
      // 終日：日付（YYYY-MM-DD）をローカル 0:00 に変換。時刻は不要。
      const dateStr = startLocal.trim().slice(0, 10);
      const [y, m, d] = dateStr.split('-').map(Number);
      if (!y || !m || !d) {
        setSaveError('終日の予定は日付を選んでください');
        return;
      }
      startAt = new Date(y, m - 1, d).getTime();
    } else {
      const ms = localInputToMs(startLocal);
      if (ms === null) {
        setSaveError('予定開始日時を入力してください。');
        return;
      }
      startAt = ms;
    }

    // 終了日時（終日のときは未使用）。開始より前は不可。
    const endAt = allDay ? null : localInputToMs(endLocal);
    if (endAt !== null && startAt !== null && endAt < startAt) {
      setSaveError('予定終了日時は開始日時より後にしてください。');
      return;
    }

    setSaving(true);
    const { reservation, error } = await createReservation({
      title: finalTitle,
      content: content.trim(),
      startAt,
      endAt,
      allDay,
      notificationEnabled: notify,
    });
    setSaving(false);
    if (error || !reservation) {
      setSaveError(error ?? '予定の保存に失敗しました。入力内容とログイン状態を確認してください。');
      return;
    }

    setTitle('');
    setContent('');
    setStartLocal('');
    setEndLocal('');
    setAllDay(false);
    setNotify(false);
    setSaveOk('予定を保存しました。');
    // Googleカレンダー設定済み＆開始日時ありのときだけ、保存後のワンタップ追加導線を出す（OAuthはタップ後）
    if (isGoogleCalendarConfigured() && reservation.startAt !== null) {
      setSavedCalReservation(reservation);
    }
  }

  // 保存済み予定1件を Googleカレンダーへ追加（ユーザーがタップしたときのみ。OAuthはこのタップ起点）。
  // - 既存の exportReservationToGoogleCalendar を再利用（作成のみ・重複防止つき）。
  // - 失敗・キャンセルでも予定は MyBrain に保存済みのまま（保存成功には影響しない）。
  async function addSavedReservationToCalendar() {
    if (!savedCalReservation) return;
    setCalBusy(true);
    setCalMsg(null);
    try {
      const result = await exportReservationToGoogleCalendar(savedCalReservation);
      if (result.state === 'success') {
        setCalOk(true);
        setCalMsg('Googleカレンダーへ追加しました');
        setSavedCalReservation(null); // 成功後はボタンを消す（重複作成防止）
      } else if (result.state === 'already-exists') {
        setCalOk(true);
        setCalMsg('Googleカレンダーにすでに登録されています');
        setSavedCalReservation(null); // 既に登録済み → ボタンを消す
      } else if (result.state === 'cancelled') {
        setCalOk(false);
        setCalMsg('Googleカレンダーへの追加をキャンセルしました');
      } else {
        // error / unconfigured / 想定外：予定は保存済みのまま
        setCalOk(false);
        setCalMsg('Googleカレンダーへの追加に失敗しました（予定はMyBrainに保存済みです）');
      }
    } catch {
      setCalOk(false);
      setCalMsg('Googleカレンダーへの追加に失敗しました（予定はMyBrainに保存済みです）');
    } finally {
      setCalBusy(false);
    }
  }

  // Googleカレンダーの「今日の予定」を読み取って表示（ユーザーがタップしたときのみ。OAuthはこのタップ起点）。
  // - 既存の読み取り専用ヘルパー readGoogleCalendarEventsInRange('today') を使う。
  // - 取得結果はどこにも保存しない（state に持つだけ。Supabase / localStorage に入れない）。
  async function readTodayCalendar() {
    setCalReadLoading(true);
    setCalReadMsg(null);
    setCalReadEvents(null);
    try {
      const result = await readGoogleCalendarEventsInRange('today');
      if (result.state === 'success') {
        setCalReadEvents(result.events ?? []);
      } else if (result.state === 'cancelled') {
        setCalReadMsg('Googleカレンダーの読み取りをキャンセルしました');
      } else if (result.state === 'unconfigured') {
        setCalReadMsg('Googleカレンダー連携が設定されていません');
      } else {
        setCalReadMsg('Googleカレンダーの予定を取得できませんでした');
      }
    } catch {
      setCalReadMsg('Googleカレンダーの予定を取得できませんでした');
    } finally {
      setCalReadLoading(false);
    }
  }

  if (!configured) {
    return (
      <div className="flex flex-col gap-4" style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
        <h1 className="text-[22px] font-bold" style={{ color: NAVY }}>予定管理</h1>
        <p className="rounded-2xl border border-[#E5E8F0] bg-yellow-50 p-4 text-sm text-yellow-800">
          Supabase が未設定です。<code>.env.local</code> を設定して再起動してください。
        </p>
      </div>
    );
  }

  return (
    <>
    <DesktopSchedules />

    {/* ── スマホ／タブレット（lg未満）：ネオン宇宙UI（メモ画面と統一） ── */}
    <div className="relative min-h-[100svh] w-full overflow-x-hidden bg-[#050716] lg:hidden">
      {/* 宇宙背景（haikei.png）。全ビューポートを覆う固定レイヤー（端に白を出さない）。 */}
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

      <div className="relative z-10 flex flex-col gap-5 px-1 pb-4">

        {/* ── 上部：公式ロゴ（透過版・メモ画面と統一） ── */}
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
        </header>

        {/* 未ログイン案内 */}
        {needLogin && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3"
            style={{ background: 'rgba(60,40,10,0.5)', borderColor: 'rgba(220,180,80,0.4)' }}>
            <p className="text-[13px] font-semibold" style={{ color: '#F2D58A' }}>
              予定を保存するにはログインが必要です。
            </p>
            <Link href="/login"
              className="shrink-0 rounded-full px-4 py-2 text-[12px] font-bold text-white active:opacity-80"
              style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)' }}>
              ログイン
            </Link>
          </div>
        )}

        {/* ── 予定タイトル ── */}
        <div className="flex items-center gap-3 rounded-2xl border px-4 py-3.5"
          style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.4)', boxShadow: '0 0 18px rgba(80,140,255,0.12) inset' }}>
          <span style={{ color: '#7BA6FF' }}><PencilIcon size={18} /></span>
          <input
            className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-[#7A86A8]"
            placeholder="予定タイトル（例: 歯医者）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {/* タイトルの音声入力（既存 VoiceInput を流用。getInitial で末尾追記） */}
          <VoiceInput
            iconOnly
            micSrc="/mic-icon.jpg"
            onResult={(t) => setTitle(t)}
            getInitial={() => title}
          />
        </div>

        {/* ── 予定開始日時 ── */}
        <div className="flex flex-col gap-1.5 rounded-2xl border px-4 py-3.5"
          style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.4)' }}>
          <label className="text-[11px] font-semibold" style={{ color: '#9CC4FF' }}>{allDay ? '予定日' : '予定開始日時'}</label>
          <input
            className="w-full bg-transparent text-[15px] text-white outline-none [color-scheme:dark]"
            type={allDay ? 'date' : 'datetime-local'}
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
          />
        </div>

        {/* ── 予定終了日時（終日のときは無効） ── */}
        <div className="flex flex-col gap-1.5 rounded-2xl border px-4 py-3.5"
          style={{
            background: 'rgba(10,14,32,0.7)',
            borderColor: 'rgba(120,160,255,0.4)',
            opacity: allDay ? 0.5 : 1,
          }}>
          <label className="text-[11px] font-semibold" style={{ color: '#9CC4FF' }}>予定終了日時</label>
          <input
            className="w-full bg-transparent text-[15px] text-white outline-none [color-scheme:dark] disabled:cursor-not-allowed"
            type="datetime-local"
            value={endLocal}
            disabled={allDay}
            onChange={(e) => setEndLocal(e.target.value)}
          />
        </div>

        {/* ── 終日トグル ── */}
        <button
          type="button"
          onClick={toggleAllDay}
          className="flex min-h-[48px] items-center justify-between rounded-2xl border px-4 text-[14px] font-bold transition active:scale-95"
          style={
            allDay
              ? { background: 'rgba(34,229,168,0.18)', borderColor: 'rgba(34,229,168,0.55)', color: '#7DF5CC' }
              : { background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.3)', color: 'rgba(255,255,255,0.8)' }
          }>
          <span>終日</span>
          {/* スイッチ風インジケータ */}
          <span className="relative h-6 w-11 rounded-full transition"
            style={{ background: allDay ? 'rgba(34,229,168,0.7)' : 'rgba(120,160,255,0.25)' }}>
            <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
              style={{ left: allDay ? '22px' : '2px' }} />
          </span>
        </button>

        {/* ── 内容メモ ── */}
        <div className="rounded-2xl border px-4 py-3.5"
          style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(120,160,255,0.4)', boxShadow: '0 0 18px rgba(80,140,255,0.1) inset' }}>
          <textarea
            className="min-h-[120px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-white outline-none placeholder:text-[#7A86A8]"
            placeholder="内容メモ"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-end border-t pt-2.5" style={{ borderColor: 'rgba(120,160,255,0.18)' }}>
            {/* 内容メモの音声入力（既存 VoiceInput を流用。getInitial で末尾追記） */}
            <VoiceInput
              iconOnly
              micSrc="/mic-icon.jpg"
              onResult={(t) => setContent(t)}
              getInitial={() => content}
            />
          </div>
        </div>

        {/* ── 通知トグル ── */}
        <button
          type="button"
          onClick={() => setNotify((v) => !v)}
          className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border px-4 text-[13px] font-bold transition active:scale-95"
          style={
            notify
              ? { background: 'rgba(34,229,168,0.18)', borderColor: 'rgba(34,229,168,0.55)', color: '#7DF5CC' }
              : { background: 'rgba(20,28,60,0.45)', borderColor: 'rgba(120,160,255,0.25)', color: 'rgba(255,255,255,0.75)' }
          }>
          {notify ? '🔔 通知ON' : '🔕 通知OFF'}
        </button>

        {saveError && <p className="text-center text-sm text-red-400">{saveError}</p>}
        {saveOk && <p className="text-center text-sm text-emerald-300">{saveOk}</p>}
        {/* 保存後：Googleカレンダーへ追加（設定済み＆開始日時あり＆保存成功時のみ。OAuthはタップ後） */}
        {savedCalReservation && (
          <button
            type="button"
            onClick={addSavedReservationToCalendar}
            disabled={calBusy}
            className="mx-auto flex h-11 w-full max-w-[280px] items-center justify-center rounded-full border text-[14px] font-bold text-white active:scale-95 disabled:opacity-60"
            style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.5)', boxShadow: '0 0 14px rgba(80,160,255,0.18)' }}>
            {calBusy ? '追加中…' : '📅 Googleカレンダーへ追加'}
          </button>
        )}
        {calMsg && <p className={`text-center text-sm ${calOk ? 'text-emerald-300' : 'text-red-400'}`}>{calMsg}</p>}

        {/* ── Googleカレンダー「今日の予定」を読み取り表示（設定済みのときのみ。取得はタップ後・保存しない） ── */}
        {calReadConfigured && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={readTodayCalendar}
              disabled={calReadLoading}
              className="mx-auto flex h-11 w-full max-w-[280px] items-center justify-center rounded-full border text-[14px] font-bold text-white active:scale-95 disabled:opacity-60"
              style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.5)', boxShadow: '0 0 14px rgba(80,160,255,0.18)' }}>
              {calReadLoading ? '取得中…' : '📅 Googleカレンダーの今日の予定を見る'}
            </button>

            {calReadMsg && (
              <p className={`text-center text-sm ${calReadMsg === 'Googleカレンダーの読み取りをキャンセルしました' ? 'text-white/70' : 'text-red-400'}`}>
                {calReadMsg}
              </p>
            )}

            {calReadEvents && (
              <div
                className="rounded-2xl border px-4 py-3"
                style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(120,160,255,0.4)', boxShadow: '0 0 18px rgba(80,140,255,0.1) inset' }}>
                <p className="mb-2 text-[12px] font-bold" style={{ color: 'rgba(170,200,255,0.85)' }}>
                  Googleカレンダー（今日）
                </p>
                {calReadEvents.length === 0 ? (
                  <p className="text-[14px] text-white/70">今日の予定はありません</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {calReadEvents.map((ev) => {
                      const clock = ev.allDay
                        ? ''
                        : `${formatEventClock(ev.start)}〜${formatEventClock(ev.end)}`.replace(/^〜$/, '');
                      return (
                        <li key={ev.id} className="flex items-start gap-2 text-[14px] text-white">
                          {ev.allDay ? (
                            <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
                              style={{ background: 'rgba(120,160,255,0.18)', color: '#AEC4FF', border: '1px solid rgba(120,160,255,0.4)' }}>
                              終日
                            </span>
                          ) : (
                            clock && <span className="shrink-0 tabular-nums text-[13px]" style={{ color: 'rgba(170,200,255,0.9)' }}>{clock}</span>
                          )}
                          <span className="min-w-0 flex-1 break-words">{ev.summary}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 保存（ネオン）＋予定一覧＋ホーム ── */}
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="flex h-[54px] flex-[1.6] items-center justify-center rounded-full px-1 text-[15px] font-extrabold text-white disabled:opacity-60"
            style={{
              background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.1) inset, 0 6px 24px rgba(60,120,255,0.5)',
            }}>
            {saving ? '保存中…' : '📅 予定を保存する'}
          </button>
          <Link href="/history?view=reservations"
            className="flex h-[54px] flex-1 items-center justify-center rounded-full border border-white/20 bg-black/35 text-[14px] font-bold text-white backdrop-blur-md transition active:scale-95"
            style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.3), 0 0 14px rgba(80,160,255,0.15)' }}>
            予定一覧
          </Link>
          <Link href="/"
            className="flex h-[54px] flex-1 items-center justify-center rounded-full border border-white/20 bg-black/35 text-[14px] font-bold text-white backdrop-blur-md transition active:scale-95"
            style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.3), 0 0 14px rgba(80,160,255,0.15)' }}>
            ホーム
          </Link>
        </div>

        {/* ── AI質問バー（有料プランのみ。無料プランはロック表示） ── */}
        {isPaid ? (
        <div className="mt-1 flex flex-col gap-1.5">
          <span className="px-1 text-[12px] font-bold" style={{ color: 'rgba(170,200,255,0.85)' }}>
            予定についてAIに質問
          </span>
          <div className="flex items-center gap-2 rounded-2xl border px-3 py-2.5"
            style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(120,160,255,0.4)', boxShadow: '0 0 18px rgba(80,140,255,0.1) inset' }}>
            <input
              type="text"
              value={aiAsk}
              onChange={(e) => setAiAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') goConsultFromReservation();
              }}
              placeholder="予定についてAIに質問..."
              className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-[#7A86A8]"
            />
            <VoiceInput
              iconOnly
              micSrc="/mic-icon.jpg"
              onResult={(t) => setAiAsk(t)}
              getInitial={() => {
                aiBaseRef.current = aiAsk;
                return aiAsk;
              }}
            />
            <button
              type="button"
              aria-label="AIに送信"
              onClick={goConsultFromReservation}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition active:scale-95"
              style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 4px 14px rgba(60,120,255,0.45)' }}>
              <SendIcon size={18} />
            </button>
          </div>
        </div>
        ) : (
          <Link
            href="/settings"
            aria-label="プランを確認"
            className="mt-1 flex items-center gap-3 rounded-2xl border px-4 py-3 active:scale-[0.99]"
            style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(242,213,138,0.35)', boxShadow: '0 0 16px rgba(242,213,138,0.08) inset, 0 6px 18px rgba(0,0,0,0.3)' }}>
            <span className="text-[16px]" aria-hidden>🔒</span>
            <span className="min-w-0 flex-1 text-[12.5px] font-bold leading-snug" style={{ color: '#f2d58a' }}>
              AI相談は有料プランで利用できます
            </span>
            <span className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold"
              style={{ background: 'rgba(242,213,138,0.16)', color: '#f2d58a', border: '1px solid rgba(242,213,138,0.4)' }}>
              プランを確認
            </span>
          </Link>
        )}

        {/* ── 機能カード（メモ＝緑 / 予定＝青[アクティブ] / AI相談＝紫） ── */}
        <div className="mt-2 grid grid-cols-3 gap-3">
          <NeonCard color="#22E5A8" title="メモ" icon={<NeonMemoIcon color="#22E5A8" />} href="/memos" />
          <NeonCard color="#38BDF8" title="予定" icon={<NeonCalendarIcon color="#38BDF8" />} href="/reservations" active />
          <NeonCard color="#A66BFF" title="AI" icon={<NeonChatIcon color="#A66BFF" />} href="/ai-assist" />
        </div>
      </div>
    </div>
    </>
  );
}

/* ── ネオン機能カード（下段ナビ・メモ画面と統一） ── */
function NeonCard({
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
                background: `linear-gradient(160deg, ${hexA(color, 0.28)} 0%, rgba(10,16,34,0.7) 72%)`,
                border: `1.5px solid ${hexA(color, 0.85)}`,
                boxShadow: `0 0 22px ${hexA(color, 0.4)}, 0 0 18px ${hexA(color, 0.22)} inset`,
              }
            : {
                background: 'linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(10,12,28,0.6) 70%)',
                border: '1px solid rgba(255,255,255,0.15)',
              }
        }>
        {active && (
          <span className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-px text-[8px] font-bold"
            style={{ background: hexA(color, 0.9), color: '#06121f' }}>
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
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function neonGlow(color: string) {
  return { filter: `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 12px ${hexA(color, 0.5)})` };
}

function NeonMemoIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={neonGlow(color)}>
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
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={neonGlow(color)}>
      <rect x="6" y="9" width="36" height="31" rx="4" stroke={color} strokeWidth="2.2" />
      <line x1="6" y1="18" x2="42" y2="18" stroke={color} strokeWidth="2" />
      <line x1="16" y1="5" x2="16" y2="13" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="32" y1="5" x2="32" y2="13" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="15" cy="26" r="2.3" fill={color} /><circle cx="24" cy="26" r="2.3" fill={color} /><circle cx="33" cy="26" r="2.3" fill={color} />
      <circle cx="15" cy="33" r="2.3" fill={color} /><circle cx="24" cy="33" r="2.3" fill={color} />
    </svg>
  );
}

function NeonChatIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={neonGlow(color)}>
      <path d="M6 10 Q6 6 10 6 H38 Q42 6 42 10 V27 Q42 31 38 31 H15 L7 41 V31 Q6 31 6 27 Z" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="17" cy="19" r="2.6" fill={color} /><circle cx="24" cy="19" r="2.6" fill={color} /><circle cx="31" cy="19" r="2.6" fill={color} />
    </svg>
  );
}
