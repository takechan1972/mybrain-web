'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  deleteReservation,
  formatReservationWhen,
  getReservation,
  localInputToMs,
  msToLocalInput,
  updateReservation,
} from '@/lib/reservations';
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

  async function handleDelete() {
    if (typeof window !== 'undefined' && !window.confirm('この予定を削除しますか？元に戻せません。')) return;
    setActionError(null);
    const { ok, error } = await deleteReservation(id);
    if (!ok) {
      setActionError(`削除できませんでした：${error}`);
      return;
    }
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
    <div className="flex flex-col gap-3">
      <button onClick={() => router.push('/reservations')} className="self-start text-sm text-brand">
        ← 一覧へ戻る
      </button>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            className="rounded-lg border px-3 py-2 text-base"
            placeholder="予定タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="text-xs text-gray-500">予定日時</label>
          <input
            className="rounded-lg border px-3 py-2 text-base"
            type="datetime-local"
            value={scheduleLocal}
            onChange={(e) => setScheduleLocal(e.target.value)}
          />
          <textarea
            className="min-h-24 rounded-lg border px-3 py-2 text-base"
            placeholder="内容メモ"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            {notify ? '🔔 通知 ON' : '🔕 通知 OFF'}
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm">
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 font-bold text-white disabled:opacity-60">
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-bold">{item!.title || '無題の予定'}</h1>
          <div className="text-sm text-gray-700">🗓 {formatReservationWhen(item!)}</div>
          <div className="text-sm text-gray-500">{item!.notificationEnabled ? '🔔 通知 ON' : '🔕 通知 OFF'}</div>
          <p className="whitespace-pre-wrap text-base">{item!.content || '（内容なし）'}</p>
          <div className="mt-2 text-xs text-gray-400">
            作成：{formatDate(item!.createdAt)} ／ 更新：{formatDate(item!.updatedAt)}
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setEditing(true)} className="rounded-lg bg-brand px-4 py-2 font-bold text-white">
              編集
            </button>
            <button onClick={handleDelete} className="rounded-lg bg-gray-100 px-4 py-2 text-red-600">
              削除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
