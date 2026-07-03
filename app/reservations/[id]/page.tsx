'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import NeonQuickNav from '@/components/NeonQuickNav';
import {
  deleteReservation,
  formatReservationWhen,
  getReservation,
  localInputToMs,
  msToLocalInput,
  updateReservation,
} from '@/lib/reservations';
import { isGoogleCalendarConfigured, exportReservationToGoogleCalendar, updateReservationInGoogleCalendar, deleteReservationEventFromGoogleCalendar } from '@/lib/google';
import type { Reservation } from '@/lib/types';

function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ReservationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [item, setItem] = useState<Reservation | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Googleカレンダー書き出し（1件・確認モーダル経由）。設定があるときだけボタンを出す。
  const [calConfigured, setCalConfigured] = useState(false);
  const [confirmingCalendar, setConfirmingCalendar] = useState(false);
  const [calExporting, setCalExporting] = useState(false);
  const [calMessage, setCalMessage] = useState<string | null>(null);
  const [calLink, setCalLink] = useState<string | null>(null);
  // Googleカレンダー「更新」導線（編集保存後のみ・追加フローとは別state）。
  const [showCalUpdate, setShowCalUpdate] = useState(false);
  const [calUpdating, setCalUpdating] = useState(false);
  const [calUpdateMsg, setCalUpdateMsg] = useState<string | null>(null);
  const [calUpdateOk, setCalUpdateOk] = useState(false);
  // Googleカレンダー「削除」導線（このカレンダーのコピーだけを消す。MyBrain の予定は消さない）。確認モーダル経由。
  const [calDeleteConfirmOpen, setCalDeleteConfirmOpen] = useState(false);
  const [calDeleteLoading, setCalDeleteLoading] = useState(false);
  const [calDeleteMsg, setCalDeleteMsg] = useState<string | null>(null);
  const [calDeleteMsgType, setCalDeleteMsgType] = useState<'success' | 'error' | 'neutral' | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [scheduleLocal, setScheduleLocal] = useState('');
  const [editAllDay, setEditAllDay] = useState(false); // 編集時の終日（日付のみ入力にする）
  const [notify, setNotify] = useState(false);

  useEffect(() => {
    let active = true;
    getReservation(id).then(({ reservation, error }) => {
      if (!active) return;
      setLoadError(error);
      setItem(reservation);
      if (reservation) {
        setTitle(reservation.title);
        setContent(reservation.content);
        setEditAllDay(reservation.allDay);
        // 終日は日付のみ（YYYY-MM-DD）、通常は日時。開始は startAt 優先、無ければ scheduleAt。
        const startMs = reservation.startAt ?? reservation.scheduleAt;
        setScheduleLocal(
          reservation.allDay
            ? (startMs != null ? msToLocalInput(startMs).slice(0, 10) : '')
            : msToLocalInput(reservation.scheduleAt),
        );
        setNotify(reservation.notificationEnabled);
      }
    });
    return () => {
      active = false;
    };
  }, [id]);

  // Googleカレンダー連携の公開設定が揃っているかをマウント後に判定（SSR では false のまま）。
  useEffect(() => {
    setCalConfigured(isGoogleCalendarConfigured());
  }, []);

  // 確認後：この予定をGoogleカレンダーへ1件書き出す（トークン取得→イベント作成）。
  async function performCalendarExport() {
    if (!item) return;
    // 確認モーダルを閉じ、進行メッセージを画面に出す（ポップアップが閉じても見え続ける）。
    setConfirmingCalendar(false);
    setCalLink(null);
    setCalMessage('Googleカレンダーへ書き出し中です...');
    setCalExporting(true);
    try {
      const result = await exportReservationToGoogleCalendar(item);
      if (result.state === 'success') {
        setCalMessage('Googleカレンダーへ書き出しました');
        setCalLink(result.htmlLink ?? null);
      } else if (result.state === 'already-exists') {
        // 既に登録済み。重複作成はしない（リンクが無ければ作らない）。
        setCalMessage('この予定はすでにGoogleカレンダーに登録されています');
        setCalLink(result.htmlLink ?? null);
      } else if (result.state === 'cancelled') {
        setCalMessage('Googleカレンダー連携をキャンセルしました');
      } else if (result.state === 'unconfigured') {
        setCalMessage('Googleカレンダー連携が設定されていません');
      } else if (result.state === 'error') {
        setCalMessage(`Googleカレンダーへの書き出しに失敗しました：${result.error ?? '不明なエラー'}`);
      } else {
        // 想定外の結果でも必ずフィードバックを出す（無反応を防ぐ）。
        setCalMessage('Googleカレンダーへの書き出し結果を確認できませんでした。もう一度お試しください。');
      }
    } catch {
      // 例外時もメッセージを必ず出す。
      setCalMessage('Googleカレンダーへの書き出し結果を確認できませんでした。もう一度お試しください。');
    } finally {
      // 成功・失敗・例外いずれでもローディング解除とモーダルを閉じる。
      setCalExporting(false);
      setConfirmingCalendar(false);
    }
  }

  async function handleSave() {
    setActionError(null);
    // 新しい保存を始めるとき、前回のカレンダー更新の状態はクリアする。
    setShowCalUpdate(false);
    setCalUpdateMsg(null);
    setCalUpdateOk(false);
    // 終日は日付のみ必須。通常は従来どおり（日時は任意）。
    let allDayStartAt: number | null = null;
    if (editAllDay) {
      const [y, m, d] = scheduleLocal.trim().slice(0, 10).split('-').map(Number);
      if (!y || !m || !d) {
        setActionError('終日の予定は日付を選んでください');
        return;
      }
      allDayStartAt = new Date(y, m - 1, d).getTime();
    }
    setSaving(true);
    const { reservation, error } = await updateReservation(
      id,
      editAllDay
        ? { title, content, startAt: allDayStartAt, endAt: null, allDay: true, notificationEnabled: notify }
        : { title, content, scheduleAt: localInputToMs(scheduleLocal), allDay: false, notificationEnabled: notify },
    );
    setSaving(false);
    if (error) {
      setActionError(`更新できませんでした：${error}`);
      return;
    }
    if (reservation) {
      setItem(reservation);
      setEditing(false);
      // MyBrain 更新成功後、設定済み＆開始日時ありのときだけ「Googleカレンダーを更新」導線を出す（OAuthはタップ後）。
      if (calConfigured && (reservation.startAt ?? reservation.scheduleAt) != null) {
        setShowCalUpdate(true);
      }
    }
  }

  // 編集保存後：この予定に対応する既存のGoogleカレンダーイベントを更新（ユーザーがタップしたときのみ）。
  // - 既存の updateReservationInGoogleCalendar を再利用（events.patch・未登録なら作成しない）。
  // - 失敗・キャンセルでも MyBrain 側の更新は成功のまま（別state）。
  async function performCalendarUpdate() {
    if (!item) return;
    setCalUpdating(true);
    setCalUpdateMsg(null);
    try {
      const result = await updateReservationInGoogleCalendar(item);
      if (result.state === 'success') {
        setCalUpdateOk(true);
        setCalUpdateMsg('Googleカレンダーを更新しました');
        setShowCalUpdate(false); // 成功後はボタンを消す
      } else if (result.state === 'not-found') {
        setCalUpdateOk(false);
        setCalUpdateMsg('Googleカレンダーにまだ追加されていません。先に「Googleカレンダーへ追加」してください。');
        setShowCalUpdate(false); // 追加が先。ボタンは消して追加へ誘導
      } else if (result.state === 'cancelled') {
        setCalUpdateOk(false);
        setCalUpdateMsg('Googleカレンダーの更新をキャンセルしました');
        // 再試行できるようボタンは残す
      } else {
        // error / unconfigured / 想定外：予定は保存済みのまま
        setCalUpdateOk(false);
        setCalUpdateMsg('Googleカレンダーの更新に失敗しました（予定はMyBrainに保存済みです）');
        // 再試行できるようボタンは残す
      }
    } catch {
      setCalUpdateOk(false);
      setCalUpdateMsg('Googleカレンダーの更新に失敗しました（予定はMyBrainに保存済みです）');
    } finally {
      setCalUpdating(false);
    }
  }

  // 確認後：この予定に対応するGoogleカレンダーのイベントだけを削除する（ユーザーがタップしたときのみ）。
  // - 既存の deleteReservationEventFromGoogleCalendar を使う（予定IDで検索→1件削除）。
  // - **MyBrain の予定は削除しない**（performDelete / deleteReservation はここから呼ばない）。
  // - 失敗・キャンセルでも MyBrain 側は無変更。画面遷移もしない。
  async function handleDeleteFromGoogleCalendar() {
    if (!item) return;
    // 確認モーダルを閉じ、進行状態に入る（ポップアップが閉じてもメッセージは画面に残す）。
    setCalDeleteConfirmOpen(false);
    setCalDeleteMsg(null);
    setCalDeleteMsgType(null);
    setCalDeleteLoading(true);
    try {
      const result = await deleteReservationEventFromGoogleCalendar(item);
      if (result.state === 'success') {
        setCalDeleteMsg('Googleカレンダーから削除しました');
        setCalDeleteMsgType('success');
      } else if (result.state === 'not-found') {
        setCalDeleteMsg('Googleカレンダーに登録されていません');
        setCalDeleteMsgType('neutral');
      } else if (result.state === 'unconfigured') {
        setCalDeleteMsg('Googleカレンダー連携が設定されていません');
        setCalDeleteMsgType('neutral');
      } else if (result.state === 'cancelled') {
        setCalDeleteMsg('Googleカレンダーの削除をキャンセルしました');
        setCalDeleteMsgType('neutral');
      } else {
        // error / 想定外：MyBrain の予定はそのまま
        setCalDeleteMsg('Googleカレンダーからの削除に失敗しました（MyBrainの予定はそのままです）');
        setCalDeleteMsgType('error');
      }
    } catch {
      setCalDeleteMsg('Googleカレンダーからの削除に失敗しました（MyBrainの予定はそのままです）');
      setCalDeleteMsgType('error');
    } finally {
      setCalDeleteLoading(false);
    }
  }

  // 削除ボタン：まず確認モーダルを表示（window.confirm はモバイルで抑制されることがあるため使わない）
  function requestDelete() {
    setActionError(null);
    setConfirmingDelete(true);
  }

  // 確認後：この予定（現在開いている id）だけを削除して一覧へ戻る
  async function performDelete() {
    setActionError(null);
    setDeleting(true);
    const { ok, error } = await deleteReservation(id);
    setDeleting(false);
    if (!ok) {
      setActionError(`削除できませんでした：${error}`);
      setConfirmingDelete(false);
      return;
    }
    setConfirmingDelete(false);
    // router.refresh() は使わない（dev環境のソフトナビでCSSが外れる崩れ回避）
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem('reservation_flash', '削除しました');
      } catch {
        // 失敗してもメッセージ無しで続行
      }
    }
    router.push('/reservations');
  }

  if (item === undefined && !loadError) {
    return <p className="py-8 text-center text-sm text-gray-400">読み込み中…</p>;
  }
  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-xl border bg-red-50 p-4 text-sm text-red-600">取得エラー：{loadError}</p>
        <button onClick={() => router.push('/reservations')} className="self-center text-sm text-brand">
          ← 一覧へ戻る
        </button>
      </div>
    );
  }
  if (item === null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="py-8 text-center text-sm text-gray-400">予定が見つかりませんでした。</p>
        <button onClick={() => router.push('/reservations')} className="self-center text-sm text-brand">
          ← 一覧へ戻る
        </button>
      </div>
    );
  }

  return (
    <>
      {/* 宇宙背景（haikei.png）＋暗オーバーレイ（メモ／予定／履歴画面と統一） */}
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
            'linear-gradient(to bottom, rgba(5,7,22,0.30) 0%, rgba(5,7,22,0.55) 45%, rgba(5,7,22,0.92) 100%)',
        }}
      />

      <div className="relative z-10 flex flex-col gap-3" style={{ paddingBottom: 'calc(180px + env(safe-area-inset-bottom))' }}>
      <button onClick={() => router.push('/reservations')} className="self-start text-sm font-semibold" style={{ color: '#7dd3fc' }}>
        ← 一覧へ戻る
      </button>

      {actionError && <p className="text-sm" style={{ color: '#fca5a5' }}>{actionError}</p>}

      {calMessage && (
        <p className="text-sm" style={{ color: '#bae6fd' }}>
          {calMessage}
          {calLink && (
            <>
              {' '}
              <a href={calLink} target="_blank" rel="noopener noreferrer" style={{ color: '#7dd3fc', textDecoration: 'underline' }}>
                Googleカレンダーで開く
              </a>
            </>
          )}
        </p>
      )}

      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            className="rounded-2xl border px-4 py-3 text-base text-white outline-none placeholder:text-[#7A86A8]"
            style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(56,189,248,0.4)' }}
            placeholder="予定タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="text-xs" style={{ color: '#7dd3fc' }}>{editAllDay ? '予定日' : '予定日時'}</label>
          <input
            className="rounded-2xl border px-4 py-3 text-base text-white outline-none [color-scheme:dark]"
            style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(56,189,248,0.4)' }}
            type={editAllDay ? 'date' : 'datetime-local'}
            value={scheduleLocal}
            onChange={(e) => setScheduleLocal(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm" style={{ color: '#bae6fd' }}>
            <input
              type="checkbox"
              checked={editAllDay}
              onChange={(e) => {
                const next = e.target.checked;
                setEditAllDay(next);
                // 終日へ：日付部分だけ残す。通常へ：時刻が無ければ 00:00 を補う。
                setScheduleLocal((cur) => (cur ? (next ? cur.slice(0, 10) : cur.length === 10 ? `${cur}T00:00` : cur) : cur));
              }}
            />
            {editAllDay ? '📅 終日 ON' : '📅 終日 OFF'}
          </label>
          <textarea
            className="min-h-24 rounded-2xl border px-4 py-3 text-base text-white outline-none placeholder:text-[#7A86A8]"
            style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(56,189,248,0.4)' }}
            placeholder="内容メモ"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm" style={{ color: '#bae6fd' }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            {notify ? '🔔 通知 ON' : '🔕 通知 OFF'}
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="rounded-full border px-5 py-2.5 text-sm font-bold text-white active:scale-95"
              style={{ borderColor: 'rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.35)' }}>
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-full px-5 py-2.5 font-bold text-white disabled:opacity-60 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #2E7EFF, #38BDF8)', boxShadow: '0 6px 24px rgba(56,189,248,0.45)' }}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-bold" style={{ color: '#ffffff' }}>{item!.title || '無題の予定'}</h1>
          <div className="text-sm" style={{ color: '#bae6fd' }}>🗓 {formatReservationWhen(item!)}</div>
          <div className="text-sm" style={{ color: '#7dd3fc' }}>{item!.notificationEnabled ? '🔔 通知 ON' : '🔕 通知 OFF'}</div>
          <p className="whitespace-pre-wrap text-base" style={{ color: '#dbeafe' }}>{item!.content || '（内容なし）'}</p>
          <div className="mt-2 text-xs" style={{ color: '#7d93c4' }}>
            作成：{formatDate(item!.createdAt)} ／ 更新：{formatDate(item!.updatedAt)}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => { setEditing(true); setShowCalUpdate(false); setCalUpdateMsg(null); setCalUpdateOk(false); }}
              className="min-h-[44px] rounded-full px-5 py-2.5 font-bold text-white active:scale-95"
              style={{ background: 'linear-gradient(135deg, #2E7EFF, #38BDF8)', boxShadow: '0 6px 24px rgba(56,189,248,0.45)' }}>
              編集
            </button>
            <button
              type="button"
              onClick={requestDelete}
              className="min-h-[44px] rounded-full border px-5 py-2.5 font-bold active:opacity-60"
              style={{ borderColor: 'rgba(224,85,85,0.5)', background: 'rgba(224,85,85,0.12)', color: '#ff9b9b' }}>
              削除
            </button>
          </div>
          {calConfigured && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => { setCalMessage(null); setCalLink(null); setConfirmingCalendar(true); }}
                disabled={calExporting}
                className="min-h-[44px] rounded-full border px-5 py-2.5 font-bold active:scale-95 disabled:opacity-50"
                style={{ borderColor: 'rgba(56,189,248,0.5)', background: 'rgba(56,189,248,0.12)', color: '#7dd3fc' }}>
                {calExporting ? '書き出し中...' : 'Googleカレンダーへ書き出し'}
              </button>
            </div>
          )}
          {showCalUpdate && calConfigured && (
            <div className="mt-2">
              <button
                type="button"
                onClick={performCalendarUpdate}
                disabled={calUpdating}
                className="min-h-[44px] rounded-full border px-5 py-2.5 font-bold active:scale-95 disabled:opacity-50"
                style={{ borderColor: 'rgba(56,189,248,0.5)', background: 'rgba(56,189,248,0.12)', color: '#7dd3fc' }}>
                {calUpdating ? '更新中…' : 'Googleカレンダーを更新'}
              </button>
            </div>
          )}
          {calUpdateMsg && (
            <p className="mt-1 text-sm" style={{ color: calUpdateOk ? '#86efac' : '#fca5a5' }}>{calUpdateMsg}</p>
          )}
          {calConfigured && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => { setCalDeleteMsg(null); setCalDeleteMsgType(null); setCalDeleteConfirmOpen(true); }}
                disabled={calDeleteLoading}
                className="min-h-[44px] rounded-full border px-5 py-2.5 font-bold active:scale-95 disabled:opacity-50"
                style={{ borderColor: 'rgba(224,85,85,0.5)', background: 'rgba(224,85,85,0.12)', color: '#ff9b9b' }}>
                {calDeleteLoading ? '削除中…' : '📅 Googleカレンダーから削除'}
              </button>
            </div>
          )}
          {calDeleteMsg && (
            <p
              className="mt-1 text-sm"
              style={{ color: calDeleteMsgType === 'success' ? '#86efac' : calDeleteMsgType === 'error' ? '#fca5a5' : '#a5b4fc' }}>
              {calDeleteMsg}
            </p>
          )}
        </div>
      )}

      {/* 削除確認モーダル（MyBrain スタイル・メモ詳細と統一） */}
      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-10 sm:items-center sm:pb-0">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => !deleting && setConfirmingDelete(false)}
          />
          <div
            className="relative w-full max-w-md rounded-3xl border p-6"
            style={{
              background: 'rgba(20, 16, 38, 0.92)',
              borderColor: 'rgba(120,160,255,0.3)',
              boxShadow: '0 0 24px rgba(99,102,241,0.18), 0 20px 60px rgba(0,0,0,0.55)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
            }}>
            <p className="text-center text-[15px] font-bold" style={{ color: '#ffffff' }}>
              この予定を削除しますか？
            </p>
            <p className="mt-1 text-center text-[12px]" style={{ color: '#a5b4fc' }}>
              削除すると元に戻せません。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="min-h-[44px] flex-1 rounded-full border py-3 text-[14px] font-semibold disabled:opacity-60"
                style={{ borderColor: 'rgba(255,255,255,0.2)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
                キャンセル
              </button>
              <button
                type="button"
                onClick={performDelete}
                disabled={deleting}
                className="min-h-[44px] flex-1 rounded-full py-3 text-[14px] font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: '#E05555' }}>
                {deleting ? '削除中…' : '削除'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Googleカレンダー書き出し確認モーダル（削除モーダルと同じスタイル） */}
      {confirmingCalendar && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-10 sm:items-center sm:pb-0">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => !calExporting && setConfirmingCalendar(false)}
          />
          <div
            className="relative w-full max-w-md rounded-3xl border p-6"
            style={{
              background: 'rgba(20, 16, 38, 0.92)',
              borderColor: 'rgba(56,189,248,0.3)',
              boxShadow: '0 0 24px rgba(56,189,248,0.18), 0 20px 60px rgba(0,0,0,0.55)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
            }}>
            <p className="text-center text-[15px] font-bold" style={{ color: '#ffffff' }}>
              この予定をGoogleカレンダーに追加しますか？
            </p>
            <p className="mt-2 text-center text-[14px] font-semibold" style={{ color: '#bae6fd' }}>
              {item!.title || '無題の予定'}
            </p>
            <p className="mt-0.5 text-center text-[12px]" style={{ color: '#7dd3fc' }}>
              🗓 {formatReservationWhen(item!)}
            </p>
            <p className="mt-2 text-center text-[12px]" style={{ color: '#a5b4fc' }}>
              あなたのGoogleカレンダーに予定が追加されます。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmingCalendar(false)}
                disabled={calExporting}
                className="min-h-[44px] flex-1 rounded-full border py-3 text-[14px] font-semibold disabled:opacity-60"
                style={{ borderColor: 'rgba(255,255,255,0.2)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
                キャンセル
              </button>
              <button
                type="button"
                onClick={performCalendarExport}
                disabled={calExporting}
                className="min-h-[44px] flex-1 rounded-full py-3 text-[14px] font-semibold text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #2E7EFF, #38BDF8)' }}>
                {calExporting ? '書き出し中...' : '追加'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Googleカレンダー削除確認モーダル（このカレンダーのコピーだけ削除。MyBrain の予定は消さない） */}
      {calDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-10 sm:items-center sm:pb-0">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => !calDeleteLoading && setCalDeleteConfirmOpen(false)}
          />
          <div
            className="relative w-full max-w-md rounded-3xl border p-6"
            style={{
              background: 'rgba(20, 16, 38, 0.92)',
              borderColor: 'rgba(224,85,85,0.35)',
              boxShadow: '0 0 24px rgba(224,85,85,0.16), 0 20px 60px rgba(0,0,0,0.55)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
            }}>
            <p className="text-center text-[15px] font-bold" style={{ color: '#ffffff' }}>
              Googleカレンダーからこの予定を削除しますか？
            </p>
            <p className="mt-2 text-center text-[14px] font-semibold" style={{ color: '#bae6fd' }}>
              {item!.title || '無題の予定'}
            </p>
            <p className="mt-2 text-center text-[12px]" style={{ color: '#a5b4fc' }}>
              MyBrainの予定は削除されません。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setCalDeleteConfirmOpen(false)}
                disabled={calDeleteLoading}
                className="min-h-[44px] flex-1 rounded-full border py-3 text-[14px] font-semibold disabled:opacity-60"
                style={{ borderColor: 'rgba(255,255,255,0.2)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDeleteFromGoogleCalendar}
                disabled={calDeleteLoading}
                className="min-h-[44px] flex-1 rounded-full py-3 text-[14px] font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: '#E05555' }}>
                {calDeleteLoading ? '削除中…' : '削除'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* 下部ネオンクイックナビ（メモ / 予定 / AI）。モーダル表示中は重なり防止のため非表示。 */}
      {!confirmingDelete && !confirmingCalendar && !calDeleteConfirmOpen && <NeonQuickNav />}
    </>
  );
}
