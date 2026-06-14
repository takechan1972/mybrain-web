'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import AiBar from '@/components/AiBar';
import VoiceInput from '@/components/VoiceInput';
import SwipeableRow from '@/components/SwipeableRow';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  SearchIcon,
  SlidersIcon,
} from '@/components/icons';
import { deriveTitleFromBody, parseMemoSpeechText } from '@/lib/parse/memo-speech';
import { createMemo, deleteMemo, listMemos, parseTags } from '@/lib/memos';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import type { Memo } from '@/lib/types';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const TITLE_MAX = 100;
const BODY_MAX = 10000;
// メモ音声のタイトル/本文マーカー（ライブ反映で生テキストをタイトルに入れない判定に使う）
const MEMO_MARKER_RE = /タイトルは|たいとるは|題名は|だいめいは|内容は|ないようは|本文は|ほんぶんは/;

function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** data URI 画像を最大1280pxに縮小し JPEG(0.8) で再エンコード（巨大写真の保存失敗対策） */
function compressDataUri(dataUri: string, maxSize = 1280, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('image load failed'));
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      // 既に小さい画像はそのまま使う
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

function isToday(ts: number): boolean {
  const d = new Date(ts);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function MemosPage() {
  const configured = isSupabaseConfigured();
  const [memos, setMemos] = useState<Memo[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // スワイプ削除：開いている行のID、削除確認対象、削除中フラグ
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [confirmMemo, setConfirmMemo] = useState<Memo | null>(null);
  const [deletingMemo, setDeletingMemo] = useState(false);
  const baseBodyRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 選択画像を縮小して data URI 化（スマホ写真は数MB→base64で巨大になり保存に失敗するため、
  // 最大1280pxへリサイズ＋JPEG圧縮してから images jsonb に保存する）
  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setSaveError(null);
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onerror = () => setSaveError('画像の読み込みに失敗しました。');
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

  async function refresh() {
    const { memos: rows } = await listMemos();
    setMemos(rows);
  }

  // スワイプの「削除」タップ → 確認モーダル（対象は1件のみ）
  function requestDeleteMemo(m: Memo) {
    setSaveError(null);
    setConfirmMemo(m);
  }

  // 確認後：選択したメモだけを削除して一覧を再取得
  async function performDeleteMemo() {
    if (!confirmMemo) return;
    setDeletingMemo(true);
    const { ok, error } = await deleteMemo(confirmMemo.id);
    setDeletingMemo(false);
    if (!ok) {
      setConfirmMemo(null);
      setSaveError(`メモを削除できませんでした${error ? `：${error}` : '。'}`);
      return;
    }
    setConfirmMemo(null);
    setOpenSwipeId(null);
    await refresh(); // 一覧を再取得（Home・AI相談は各画面の focus 再取得で反映）
    setSaveOk('メモを削除しました');
  }

  useEffect(() => {
    if (configured) void refresh();
    if (typeof window !== 'undefined') {
      const flash = window.sessionStorage.getItem('memo_flash');
      if (flash) {
        setSaveOk(flash);
        window.sessionStorage.removeItem('memo_flash');
      }
    }
  }, [configured]);

  // 本文マイクのライブ反映（マーカーが無いときの通常ディクテーション）
  function handleVoiceResult(text: string) {
    const base = baseBodyRef.current.trim();
    setBody(base.length > 0 ? `${base}\n${text}` : text);
  }

  // タイトルマイクのライブ反映：マーカーが含まれるときは生テキストをタイトルに入れない（解析結果のみ）。
  function handleTitleVoiceResult(text: string) {
    if (MEMO_MARKER_RE.test(text)) {
      const parsed = parseMemoSpeechText(text);
      setTitle(parsed.title ?? '');
    } else {
      setTitle(text);
    }
  }

  // 1回の音声で「タイトルは○○、内容は○○」をタイトル/本文に振り分ける共通処理。
  // fromTitleMic: タイトル欄のマイク由来か（マーカー無しのとき タイトルへ入れるか本文へ入れるかが変わる）。
  function applyMemoVoice(finalText: string, fromTitleMic: boolean) {
    const parsed = parseMemoSpeechText(finalText);
    const base = baseBodyRef.current;
    const trimmedBase = base.trim();
    if (process.env.NODE_ENV !== 'production') {
      console.log('[memos] voice parse:', {
        mic: fromTitleMic ? 'title' : 'body',
        hasTitleMarker: parsed.hasTitleMarker,
        hasBodyMarker: parsed.hasBodyMarker,
        title: parsed.title,
        bodyLen: parsed.body.length,
      });
    }

    // タイトルマーカーがあれば明示タイトルを採用（マーカー語は含めない）
    if (parsed.hasTitleMarker && parsed.title) setTitle(parsed.title);

    if (parsed.hasBodyMarker) {
      // 本文マーカーあり → 解析した本文のみを反映（既存本文があれば追記）
      const add = parsed.body;
      setBody(trimmedBase.length > 0 ? (add.length > 0 ? `${trimmedBase}\n${add}` : trimmedBase) : add);
    } else if (parsed.hasTitleMarker) {
      // タイトルのみ指定 → 本文は録音前の状態に戻す（生テキストを残さない）
      setBody(base);
    } else if (fromTitleMic) {
      // マーカー無し＋タイトル欄マイク → 全文をタイトルに（本文は触らない）
      setTitle(parsed.body);
      setBody(base);
    } else {
      // マーカー無し＋本文欄マイク → 従来挙動：全文を本文へ、未入力時のみ自動タイトル
      const newBody = trimmedBase.length > 0 ? `${trimmedBase}\n${parsed.body}` : parsed.body;
      setBody(newBody);
      if (title.trim().length === 0) {
        const auto = deriveTitleFromBody(parsed.body || newBody);
        if (auto.length > 0) setTitle(auto);
      }
    }
  }

  // 本文マイク停止／タイトルマイク停止
  function handleVoiceStop(finalText: string) {
    applyMemoVoice(finalText, false);
  }
  function handleTitleVoiceStop(finalText: string) {
    applyMemoVoice(finalText, true);
  }

  async function handleSave() {
    setSaveError(null);
    setSaveOk(null);
    if (title.trim().length === 0 && body.trim().length === 0) {
      setSaveError('タイトルか本文を入力してください。');
      return;
    }
    setSaving(true);
    const { error } = await createMemo({ title, body, tags: parseTags(tags), images });
    setSaving(false);
    if (error) {
      setSaveError(`保存できませんでした：${error}`);
      return;
    }
    setSaveOk('保存しました');
    setTitle('');
    setBody('');
    setTags('');
    setImages([]);
    await refresh();
  }

  const q = query.trim().toLowerCase();
  const visible =
    q.length === 0
      ? memos
      : memos.filter(
          (m) =>
            m.title.toLowerCase().includes(q) ||
            m.body.toLowerCase().includes(q) ||
            m.tags.some((t) => t.toLowerCase().includes(q)),
        );
  const todayCount = memos.filter((m) => isToday(m.createdAt)).length;

  return (
    <div className="flex flex-col gap-5">
      {/* ヘッダー */}
      <header className="flex items-center justify-between">
        <Link
          href="/"
          aria-label="戻る"
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-[#223A70]">
          <ChevronLeftIcon size={22} />
        </Link>
        <h1 className="text-[18px] font-bold" style={{ color: NAVY }}>
          メモ管理
        </h1>
        <button
          type="button"
          aria-label="検索"
          className="flex h-9 w-9 items-center justify-center rounded-full text-[#8A94A6]">
          <SearchIcon size={20} />
        </button>
      </header>

      {/* 検索バー（pill） */}
      <div className="flex items-center gap-3 rounded-full border border-[#E5E8F0] bg-white px-5 py-3 shadow-sm">
        <span className="text-[#8A94A6]">
          <SearchIcon size={18} />
        </span>
        <input
          className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#8A94A6]"
          placeholder="メモを検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-[#A6AEC0]">
          <SlidersIcon size={18} />
        </span>
      </div>

      {/* 状況カード */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="今日のメモ" value={todayCount} />
        <StatCard label="総メモ数" value={memos.length} />
      </div>

      {/* メモ入力カード（主役） */}
      <div className="flex flex-col gap-4 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_8px_24px_rgba(31,53,104,0.06)]">
        {/* タイトル */}
        <div className="flex items-center gap-2 rounded-2xl bg-[#F3F5FA] px-4 py-3">
          <input
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#8A94A6]"
            placeholder="タイトルを入力..."
            maxLength={TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="text-[11px] text-[#A6AEC0]">
            {title.length}/{TITLE_MAX}
          </span>
          {/* タイトル欄のマイクもメモ単位で解析（「タイトルは○○、内容は○○」を両欄に振り分け） */}
          <VoiceInput
            iconOnly
            onResult={handleTitleVoiceResult}
            onStop={handleTitleVoiceStop}
            getInitial={() => {
              baseBodyRef.current = body;
              return '';
            }}
          />
        </div>

        {/* 本文 */}
        <div className="rounded-2xl bg-[#F3F5FA] px-4 py-3">
          <textarea
            className="min-h-44 w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-[#8A94A6]"
            placeholder="メモの内容を入力... 自由に記録しましょう。"
            maxLength={BODY_MAX}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {/* ツール行 */}
          <div className="mt-2 flex items-center justify-between border-t border-[#E5E8F0] pt-3">
            <div className="flex items-center gap-2">
              <ToolButton label="画像追加" onClick={() => fileInputRef.current?.click()}>
                <ImageIcon size={18} />
              </ToolButton>
              <VoiceInput
                iconOnly
                onResult={handleVoiceResult}
                onStop={handleVoiceStop}
                getInitial={() => {
                  baseBodyRef.current = body;
                  return '';
                }}
              />
            </div>
            <span className="text-[11px] text-[#A6AEC0]">
              {body.length}/{BODY_MAX}
            </span>
          </div>
        </div>

        {/* タグ */}
        <input
          className="rounded-2xl bg-[#F3F5FA] px-4 py-3 text-[14px] outline-none placeholder:text-[#8A94A6]"
          placeholder="タグ（カンマ区切り 例: アイデア, 仕事）"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />

        {/* 画像入力（隠し）＋選択済みサムネイル */}
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
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
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
                  aria-label="削除"
                  onClick={() => removeImage(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#1F2937] text-[11px] text-white">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
        {saveOk && <p className="text-sm text-green-700">{saveOk}</p>}

        {/* アクション */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setSaveOk('AIで要約・整理は近日対応です。')}
            className="h-12 rounded-2xl border text-[14px] font-semibold"
            style={{ borderColor: NAVY, color: NAVY }}>
            AIで要約・整理する
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-12 rounded-2xl text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(34,58,112,0.25)] disabled:opacity-60"
            style={{ backgroundColor: NAVY }}>
            {saving ? '保存中…' : '保存する'}
          </button>
        </div>
      </div>

      {/* 最近のメモ */}
      <div className="rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_8px_24px_rgba(31,53,104,0.06)]">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-bold" style={{ color: NAVY }}>
            最近のメモ
          </h2>
          <span className="flex items-center gap-0.5 text-[12px] font-semibold" style={{ color: MUTED }}>
            すべて見る
            <ChevronRightIcon size={14} />
          </span>
        </div>
        {!configured ? (
          <p className="py-3 text-sm text-[#8A94A6]">Supabase 未設定のため表示できません。</p>
        ) : visible.length === 0 ? (
          <p className="py-3 text-sm text-[#8A94A6]">メモがありません。上のフォームから追加してください。</p>
        ) : (
          <ul className="flex flex-col">
            {visible.slice(0, 10).map((m) => (
              <li key={m.id} className="border-b border-[#EEF0F5] last:border-b-0">
                <SwipeableRow
                  rounded={false}
                  open={openSwipeId === m.id}
                  onOpenChange={(o) => setOpenSwipeId(o ? m.id : null)}
                  onDelete={() => requestDeleteMemo(m)}>
                  <Link href={`/memos/${m.id}`} className="flex flex-col gap-1 bg-white py-3 active:opacity-70">
                  <span className="flex items-center gap-1.5 text-[14px]">
                    <span className="text-[#A6AEC0]">{formatDate(m.createdAt)}　</span>
                    <span className="font-semibold text-[#1F2937]">{m.title || '無題のメモ'}</span>
                    {m.images.length > 0 && (
                      <span className="text-[#7B61FF]" title="画像あり">
                        <ImageIcon size={15} />
                      </span>
                    )}
                  </span>
                  {m.tags.length > 0 && (
                    <span className="text-[12px]" style={{ color: '#7B61FF' }}>
                      {m.tags.map((t) => `#${t}`).join(' ')}
                    </span>
                  )}
                  {m.images.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-2">
                      {m.images.map((uri, i) => (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          key={i}
                          src={uri}
                          alt={`画像${i + 1}`}
                          onClick={(e) => {
                            // 一覧の行リンク（詳細へ遷移）を発火させず、その場で拡大表示
                            e.preventDefault();
                            e.stopPropagation();
                            setPreviewUri(uri);
                          }}
                          className="h-12 w-12 cursor-pointer rounded-lg border border-[#E5E8F0] object-cover"
                        />
                      ))}
                    </span>
                  )}
                  </Link>
                </SwipeableRow>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* AI相談バー（共通・ナビの上） */}
      <AiBar />

      {/* メモの削除確認モーダル（スワイプ削除） */}
      {confirmMemo && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-10 sm:items-center sm:pb-0">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => !deletingMemo && setConfirmMemo(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-[#E5E8F0] bg-white p-6 shadow-[0_20px_60px_rgba(31,53,104,0.18)]">
            <p className="text-center text-[15px] font-bold" style={{ color: NAVY }}>
              このメモを削除しますか？
            </p>
            <p className="mt-1 text-center text-[12px]" style={{ color: MUTED }}>
              この操作は元に戻せません。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmMemo(null)}
                disabled={deletingMemo}
                className="min-h-[44px] flex-1 rounded-full border border-[#E5E8F0] py-3 text-[14px] font-semibold disabled:opacity-60"
                style={{ color: MUTED }}>
                キャンセル
              </button>
              <button
                type="button"
                onClick={performDeleteMemo}
                disabled={deletingMemo}
                className="min-h-[44px] flex-1 rounded-full py-3 text-[14px] font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: '#E05555' }}>
                {deletingMemo ? '削除中…' : '削除'}
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#E5E8F0] bg-white px-4 py-3 shadow-sm">
      <div className="text-[12px] text-[#8A94A6]">{label}</div>
      <div className="mt-0.5 text-[20px] font-bold" style={{ color: NAVY }}>
        {value}
        <span className="ml-1 text-[12px] font-normal text-[#A6AEC0]">件</span>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F3F5FA] text-[#223A70]">
      {children}
    </button>
  );
}
