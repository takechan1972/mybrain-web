'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import VoiceInput from '@/components/VoiceInput';
import { parseMemoSpeechText } from '@/lib/parse/memo-speech';
import { deleteMemo, getMemo, parseTags, updateMemo } from '@/lib/memos';
import type { Memo } from '@/lib/types';

/** data URI 画像を最大1280pxに縮小し JPEG(0.8) で再エンコード（一覧画面と同じ圧縮ロジック） */
function compressDataUri(dataUri: string, maxSize = 1280, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('image load failed'));
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      if (scale >= 1 && dataUri.length < 500_000) {
        resolve(dataUri);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUri;
  });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function MemoDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [memo, setMemo] = useState<Memo | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const baseBodyRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 編集中の画像追加（一覧画面と同じ：圧縮してから images に追加）
  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const raw = typeof reader.result === 'string' ? reader.result : '';
        if (!raw) return;
        compressDataUri(raw)
          .then((uri) => setImages((prev) => [...prev, uri]))
          .catch(() => setImages((prev) => [...prev, raw]));
      };
      reader.readAsDataURL(file);
    });
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  // 追加音声入力：本文末尾に追記（タイトルは変更しない）
  function handleAppendResult(text: string) {
    const base = baseBodyRef.current.trim();
    setBody(base.length > 0 ? `${base}\n\n${text}` : text);
  }
  function handleAppendStop(finalText: string) {
    const parsed = parseMemoSpeechText(finalText);
    const add = parsed.body.trim();
    const base = baseBodyRef.current.trim();
    // 本文は解析した内容のみを追記（生テキストやマーカー語は入れない）
    setBody(base.length > 0 ? (add.length > 0 ? `${base}\n\n${add}` : base) : add);
    // 編集画面で「タイトルは○○」と明示したときだけタイトルを更新（それ以外は触らない）
    if (parsed.hasTitleMarker && parsed.title) setTitle(parsed.title);
  }

  useEffect(() => {
    let active = true;
    getMemo(id).then(({ memo: m, error }) => {
      if (!active) return;
      setLoadError(error);
      setMemo(m);
      if (m) {
        setTitle(m.title);
        setBody(m.body);
        setTags(m.tags.join(', '));
        setImages(m.images);
      }
    });
    return () => {
      active = false;
    };
  }, [id]);

  async function handleSave() {
    setActionError(null);
    setSaving(true);
    // 画像は編集状態の images を保存（編集で触らなければ既存画像がそのまま保持される）
    const { memo: updated, error } = await updateMemo(id, {
      title,
      body,
      tags: parseTags(tags),
      images,
    });
    setSaving(false);
    if (error) {
      setActionError(`更新できませんでした：${error}`);
      return;
    }
    if (updated) {
      setMemo(updated);
      setEditing(false);
    }
  }

  // 削除ボタン：まず確認モーダルを表示（window.confirm はモバイルで抑制されることがあるため使わない）
  function requestDelete() {
    setActionError(null);
    setConfirmingDelete(true);
  }

  // 確認後：このメモ（現在開いている id）だけを削除して一覧へ戻る
  async function performDelete() {
    setActionError(null);
    setDeleting(true);
    const { ok, error } = await deleteMemo(id);
    setDeleting(false);
    if (!ok) {
      setActionError(`削除できませんでした：${error}`);
      setConfirmingDelete(false);
      return;
    }
    setConfirmingDelete(false);
    // 一覧ページはマウント時に自前で再取得する。router.refresh() は使わない
    // （dev環境でソフトナビ時にCSSが一時的に外れる崩れを避けるため）。
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem('memo_flash', '削除しました');
      } catch {
        // 失敗してもメッセージ無しで続行
      }
    }
    router.push('/memos');
  }

  if (memo === undefined && !loadError) {
    return <p className="py-8 text-center text-sm text-gray-400">読み込み中…</p>;
  }
  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-xl border bg-red-50 p-4 text-sm text-red-600">取得エラー：{loadError}</p>
        <button onClick={() => router.push('/memos')} className="self-center text-sm text-brand">
          ← 一覧へ戻る
        </button>
      </div>
    );
  }
  if (memo === null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="py-8 text-center text-sm text-gray-400">メモが見つかりませんでした。</p>
        <button onClick={() => router.push('/memos')} className="self-center text-sm text-brand">
          ← 一覧へ戻る
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button onClick={() => router.push('/memos')} className="self-start text-sm text-brand">
        ← 一覧へ戻る
      </button>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            className="rounded-lg border px-3 py-2 text-base"
            placeholder="タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="min-h-32 rounded-lg border px-3 py-2 text-base"
            placeholder="本文"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {/* 追加音声入力：本文末尾に追記（タイトルは変更しない） */}
          <VoiceInput
            label="＋ 追加音声入力"
            listeningLabel="■ 追加音声を聞き取り中…（停止）"
            onResult={handleAppendResult}
            onStop={handleAppendStop}
            getInitial={() => {
              baseBodyRef.current = body;
              return '';
            }}
          />
          <input
            className="rounded-lg border px-3 py-2 text-base"
            placeholder="タグ（カンマ区切り）"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          {/* 既存画像の表示・削除＋追加（タップで拡大プレビュー） */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {images.map((uri, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uri}
                  alt={`画像${i + 1}`}
                  onClick={() => setPreviewUri(uri)}
                  className="h-16 w-16 cursor-pointer rounded-xl object-cover"
                />
                <button
                  type="button"
                  aria-label="画像を削除"
                  onClick={() => removeImage(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#1F2937] text-[11px] text-white">
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-16 w-16 rounded-xl border border-dashed border-gray-300 text-2xl text-gray-400">
              ＋
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                // キャンセル時は画像の追加・削除も保存前の状態へ戻す
                setImages(memo?.images ?? []);
                setEditing(false);
              }}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm">
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
          <h1 className="text-xl font-bold">{memo!.title || '無題のメモ'}</h1>
          {memo!.tags.length > 0 && (
            <div className="text-xs text-gray-500">{memo!.tags.map((t) => `#${t}`).join(' ')}</div>
          )}
          <p className="whitespace-pre-wrap text-base">{memo!.body || '（本文なし）'}</p>
          {memo!.images.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {memo!.images.map((uri, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={i}
                  src={uri}
                  alt={`画像${i + 1}`}
                  onClick={() => setPreviewUri(uri)}
                  className="h-24 w-24 cursor-pointer rounded-xl object-cover"
                />
              ))}
            </div>
          )}
          <div className="mt-2 text-xs text-gray-400">
            作成：{formatDate(memo!.createdAt)} ／ 更新：{formatDate(memo!.updatedAt)}
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setEditing(true)} className="rounded-lg bg-brand px-4 py-2 font-bold text-white">
              編集
            </button>
            <button
              type="button"
              onClick={requestDelete}
              className="min-h-[44px] rounded-lg bg-gray-100 px-4 py-2 font-bold text-red-600 active:opacity-60">
              削除
            </button>
          </div>
        </div>
      )}

      {/* 削除確認モーダル（MyBrain スタイル） */}
      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-10 sm:items-center sm:pb-0">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => !deleting && setConfirmingDelete(false)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-[#E5E8F0] bg-white p-6 shadow-[0_20px_60px_rgba(31,53,104,0.18)]">
            <p className="text-center text-[15px] font-bold" style={{ color: '#223A70' }}>
              このメモを削除しますか？
            </p>
            <p className="mt-1 text-center text-[12px]" style={{ color: '#8A94A6' }}>
              この操作は元に戻せません。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="min-h-[44px] flex-1 rounded-full border border-[#E5E8F0] py-3 text-[14px] font-semibold disabled:opacity-60"
                style={{ color: '#8A94A6' }}>
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

      {/* 画像拡大プレビュー */}
      {previewUri && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPreviewUri(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUri} alt="プレビュー" className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            onClick={() => setPreviewUri(null)}
            className="absolute right-4 top-6 rounded-full bg-white/15 px-4 py-2 text-sm font-bold text-white">
            ✕ 閉じる
          </button>
        </div>
      )}
    </div>
  );
}
