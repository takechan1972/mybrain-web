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
import { isGoogleCalendarConfigured, exportReservationToGoogleCalendar } from '@/lib/google';
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

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [scheduleLocal, setScheduleLocal] = useState('');
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
        setScheduleLocal(msToLocalInput(reservation.scheduleAt));
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
    setCalMessage(null);
    setCalLink(null);
    setCalExporting(true);
    const result = await exportReservationToGoogleCalendar(item);
    setCalExporting(false);
    setConfirmingCalendar(false);
    if (result.state === 'success') {
      setCalMessage('Googleカレンダーへ書き出しました');
      setCalLink(result.htmlLink ?? null);
    } else if (result.state === 'cancelled') {
      setCalMessage('Googleカレンダー連携をキャンセルしました');
    } else if (result.state === 'unconfigured') {
      setCalMessage('Googleカレンダー連携が設定されていません');
    } else {
      setCalMessage(`Googleカレンダーへの書き出しに失敗しました：${result.error ?? '不明なエラー'}`);
    }
  }

  async function handleSave() {
    setActionError(null);
    setSaving(true);
    const { reservation, error } = await updateReservation(id, {
      title,
      content,
      scheduleAt: localInputToMs(scheduleLocal),
      notificationEnabled: notify,
    });
    setSaving(false);
    if (error) {
      setActionError(`更新できませんでした：${error}`);
      return;
    }
    if (reservation) {
      setItem(reservation);
      setEditing(false);
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
          <label className="text-xs" style={{ color: '#7dd3fc' }}>予定日時</label>
          <input
            className="rounded-2xl border px-4 py-3 text-base text-white outline-none [color-scheme:dark]"
            style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(56,189,248,0.4)' }}
            type="datetime-local"
            value={scheduleLocal}
            onChange={(e) => setScheduleLocal(e.target.value)}
          />
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
              onClick={() => setEditing(true)}
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
                className="min-h-[44px] rounded-full border px-5 py-2.5 font-bold active:scale-95"
                style={{ borderColor: 'rgba(56,189,248,0.5)', background: 'rgba(56,189,248,0.12)', color: '#7dd3fc' }}>
                Googleカレンダーへ書き出し
              </button>
            </div>
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
      </div>

      {/* 下部ネオンクイックナビ（メモ / 予定 / AI）。モーダル表示中は重なり防止のため非表示。 */}
      {!confirmingDelete && !confirmingCalendar && <NeonQuickNav />}
    </>
  );
}
