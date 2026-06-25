'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import VoiceInput from '@/components/VoiceInput';
import NeonQuickNav from '@/components/NeonQuickNav';
import { parseMemoSpeechText } from '@/lib/parse/memo-speech';
import { createMemo, deleteMemo, getMemo, parseTags, updateMemo } from '@/lib/memos';
import { loadOllamaSettings } from '@/lib/ai/ollama';
import { runMemoAi, type MemoAiKind } from '@/lib/ai/memo-ai';
import { createMemoMarkdownFile, downloadMarkdownFile } from '@/lib/markdown';
import ObsidianMemoFileInfo from '@/components/ObsidianMemoFileInfo';
import { isLocalHost } from '@/lib/env';
import type { Memo } from '@/lib/types';

const TRANSCRIPTION_TAGS = ['文字起こし', 'Transcription'];

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

  // AI（要約/整理）— PCローカル専用
  const [local, setLocal] = useState(false);
  const [aiKind, setAiKind] = useState<MemoAiKind | null>(null);
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSaving, setAiSaving] = useState(false);

  // Obsidian形式（Markdown）プレビュー・コピー（表示のみ・保存しない）
  const [showMd, setShowMd] = useState(false);
  const [mdCopied, setMdCopied] = useState(false);

  useEffect(() => {
    setLocal(isLocalHost());
  }, []);

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

  const aiLabel = aiKind === 'summary' ? 'AI要約' : aiKind === 'organize' ? 'AI整理' : '';

  // AI要約/整理を実行（保存済みメモ本文を Ollama に渡す）
  async function runAi(kind: MemoAiKind) {
    if (!memo) return;
    setAiKind(kind);
    setAiResult('');
    setAiError(null);

    if ((memo.body ?? '').trim().length === 0) {
      setAiError('要約する本文がありません。');
      return;
    }
    if (!loadOllamaSettings().enabled) {
      setAiError('Ollamaを有効にしてください。');
      return;
    }

    setAiLoading(true);
    try {
      const out = await runMemoAi(kind, memo.body);
      setAiResult(out);
    } catch {
      setAiError(
        'Ollama接続を確認してください。モデルが重くて応答に時間がかかっている可能性があります。軽量・推奨の qwen2.5:1.5b を試してください。',
      );
    } finally {
      setAiLoading(false);
    }
  }

  // 元メモに追記
  async function appendAiToMemo() {
    if (!memo || aiResult.trim().length === 0) return;
    setAiSaving(true);
    const aiTag = aiKind === 'summary' ? 'AI要約' : 'AI整理';
    const newBody = `${memo.body}\n\n--- ${aiLabel} ---\n${aiResult.trim()}`;
    const nextTags = Array.from(new Set([...memo.tags, aiTag]));
    const { memo: updated, error } = await updateMemo(memo.id, {
      title: memo.title,
      body: newBody,
      tags: nextTags,
      images: memo.images,
    });
    setAiSaving(false);
    if (error || !updated) {
      setAiError(error || '追記に失敗しました。');
      return;
    }
    setMemo(updated);
    setBody(updated.body);
    setTags(updated.tags.join(', '));
    setAiResult('');
    setAiKind(null);
  }

  // 別メモとして保存
  async function saveAiAsSeparate() {
    if (!memo || aiResult.trim().length === 0) return;
    setAiSaving(true);
    const aiTag = aiKind === 'summary' ? 'AI要約' : 'AI整理';
    const prefix = aiKind === 'summary' ? 'AI要約' : 'AI整理';
    // 元メモが「文字起こし」系タグを持つ場合は引き継ぐ
    const keepTranscription = memo.tags.filter((t) => TRANSCRIPTION_TAGS.includes(t));
    const newTags = Array.from(new Set([aiTag, ...keepTranscription]));
    const { memo: created, error } = await createMemo({
      title: `${prefix}：${memo.title || '無題のメモ'}`,
      body: aiResult.trim(),
      tags: newTags,
      images: [],
    });
    setAiSaving(false);
    if (error || !created) {
      setAiError(error || '保存に失敗しました。');
      return;
    }
    setAiResult('');
    setAiKind(null);
    router.push(`/memos/${created.id}`);
  }

  // このメモを Obsidian 互換 Markdown としてクリップボードへコピー（保存はしない）
  async function copyMarkdown() {
    if (!memo) return;
    const md = createMemoMarkdownFile(memo).content;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // フォールバック（clipboard API 不可の環境）
      try {
        const ta = document.createElement('textarea');
        ta.value = md;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setMdCopied(true);
      window.setTimeout(() => setMdCopied(false), 2000);
    } else {
      setActionError('Markdownをコピーできませんでした。テキストを選択してコピーしてください。');
    }
  }

  // このメモを .md ファイルとしてダウンロード（保存はローカルのダウンロードのみ）
  function downloadMarkdown() {
    if (!memo) return;
    const { fileName, content } = createMemoMarkdownFile(memo);
    try {
      downloadMarkdownFile(fileName, content);
    } catch {
      setActionError('Markdownのダウンロードに失敗しました。');
    }
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
      <button onClick={() => router.push('/memos')} className="self-start text-sm font-semibold" style={{ color: '#818cf8' }}>
        ← 一覧へ戻る
      </button>

      {actionError && <p className="text-sm" style={{ color: '#fca5a5' }}>{actionError}</p>}

      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            className="rounded-2xl border px-4 py-3 text-base text-white outline-none placeholder:text-[#7A86A8]"
            style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.4)' }}
            placeholder="タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="min-h-32 rounded-2xl border px-4 py-3 text-base text-white outline-none placeholder:text-[#7A86A8]"
            style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(120,160,255,0.4)' }}
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
            className="rounded-2xl border px-4 py-3 text-base text-white outline-none placeholder:text-[#7A86A8]"
            style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.3)' }}
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
              className="h-16 w-16 rounded-xl border border-dashed text-2xl"
              style={{ borderColor: 'rgba(120,160,255,0.4)', color: '#9CC4FF' }}>
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
              className="rounded-full border px-5 py-2.5 text-sm font-bold text-white active:scale-95"
              style={{ borderColor: 'rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.35)' }}>
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-full px-5 py-2.5 font-bold text-white disabled:opacity-60 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 24px rgba(60,120,255,0.45)' }}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-bold" style={{ color: '#ffffff' }}>{memo!.title || '無題のメモ'}</h1>
          {memo!.tags.length > 0 && (
            <div className="text-xs" style={{ color: '#a5b4fc' }}>{memo!.tags.map((t) => `#${t}`).join(' ')}</div>
          )}
          <p className="whitespace-pre-wrap text-base" style={{ color: '#dbe4ff' }}>{memo!.body || '（本文なし）'}</p>
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
          <div className="mt-2 text-xs" style={{ color: '#8893c4' }}>
            作成：{formatDate(memo!.createdAt)} ／ 更新：{formatDate(memo!.updatedAt)}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-[44px] rounded-full px-5 py-2.5 font-bold text-white active:scale-95"
              style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 24px rgba(60,120,255,0.45)' }}>
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
        </div>
      )}

      {/* AI要約・整理カード（読み取り表示時） */}
      {!editing && memo && (
        local ? (
          <>
            <section className="mt-2 flex flex-col gap-3 rounded-2xl border p-4" style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.4)' }}>
              <p className="text-[13px] font-bold" style={{ color: '#ffffff' }}>このメモをAIで処理</p>
              <p className="text-[12px]" style={{ color: '#a5b4fc' }}>
                保存済みメモ本文を Ollama で要約・整理できます（PCローカル専用）。まずは軽量・推奨の <strong>qwen2.5:1.5b</strong> がおすすめです。
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => runAi('summary')}
                  disabled={aiLoading}
                  className="min-h-[48px] rounded-2xl text-[14px] font-bold text-white active:opacity-70 disabled:opacity-50"
                  style={{ backgroundColor: '#7B61FF' }}>
                  AIで要約
                </button>
                <button
                  type="button"
                  onClick={() => runAi('organize')}
                  disabled={aiLoading}
                  className="min-h-[48px] rounded-2xl text-[14px] font-bold text-white active:opacity-70 disabled:opacity-50"
                  style={{ backgroundColor: '#7B61FF' }}>
                  AIで整理
                </button>
              </div>
            </section>

            {(aiLoading || aiError || aiResult) && (
              <section className="flex flex-col gap-3 rounded-2xl border p-4" style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.4)' }}>
                <p className="text-[13px] font-bold" style={{ color: '#ffffff' }}>
                  {aiLabel || 'AI'}結果
                </p>
                {aiLoading && (
                  <p className="rounded-2xl px-4 py-3 text-[13px] font-semibold" style={{ backgroundColor: 'rgba(99,102,241,0.18)', color: '#c7d2fe' }}>
                    Ollama で{aiLabel}しています…
                  </p>
                )}
                {aiError && (
                  <p className="rounded-2xl px-4 py-3 text-[13px] font-semibold" style={{ backgroundColor: 'rgba(224,85,85,0.15)', color: '#ff9b9b' }}>
                    ⚠️ {aiError}
                  </p>
                )}
                {!aiLoading && aiResult && (
                  <>
                    <textarea
                      value={aiResult}
                      onChange={(e) => setAiResult(e.target.value)}
                      rows={10}
                      className="resize-y rounded-2xl border px-4 py-3 text-[14px] leading-relaxed text-white outline-none"
                      style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(120,160,255,0.4)' }}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={appendAiToMemo}
                        disabled={aiSaving}
                        className="min-h-[48px] rounded-2xl text-[14px] font-bold text-white active:opacity-70 disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 24px rgba(60,120,255,0.4)' }}>
                        {aiSaving ? '保存中…' : '元メモに追記'}
                      </button>
                      <button
                        type="button"
                        onClick={saveAiAsSeparate}
                        disabled={aiSaving}
                        className="min-h-[48px] rounded-2xl border text-[14px] font-bold active:opacity-70 disabled:opacity-50"
                        style={{ borderColor: 'rgba(120,160,255,0.5)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
                        {aiSaving ? '保存中…' : '別メモとして保存'}
                      </button>
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        ) : (
          <p className="mt-2 rounded-2xl border p-4 text-[12px]" style={{ borderColor: 'rgba(242,213,138,0.4)', background: 'rgba(242,213,138,0.10)', color: '#f2d58a' }}>
            AIの要約・整理は <strong>PCローカル版専用</strong>です。
          </p>
        )
      )}

      {/* Obsidian形式（Markdown）プレビュー・コピー（読み取り表示時・保存はしない） */}
      {!editing && memo && (
        <section className="mt-2 flex flex-col gap-3 rounded-2xl border p-4" style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.4)' }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-bold" style={{ color: '#ffffff' }}>Obsidian形式（Markdown）</p>
            <button
              type="button"
              onClick={() => setShowMd((v) => !v)}
              className="min-h-[40px] rounded-full border px-4 text-[13px] font-bold active:opacity-70"
              style={{ borderColor: 'rgba(120,160,255,0.5)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
              {showMd ? '閉じる' : 'Obsidian形式で表示'}
            </button>
          </div>
          {showMd && (
            <>
              <p className="text-[12px]" style={{ color: '#a5b4fc' }}>
                このメモを Obsidian 互換の Markdown で表示します（プレビューのみ・保存はされません）。
              </p>
              <textarea
                readOnly
                value={createMemoMarkdownFile(memo).content}
                rows={12}
                onFocus={(e) => e.currentTarget.select()}
                className="resize-y rounded-2xl border px-4 py-3 text-[13px] leading-relaxed text-white outline-none"
                style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(120,160,255,0.4)', fontFamily: 'Consolas, Meiryo, monospace' }}
              />
              {(() => {
                const f = createMemoMarkdownFile(memo);
                return <ObsidianMemoFileInfo fileName={f.fileName} path={f.path} variant="dark" />;
              })()}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={copyMarkdown}
                  className="min-h-[48px] rounded-2xl text-[14px] font-bold text-white active:opacity-70"
                  style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 24px rgba(60,120,255,0.4)' }}>
                  {mdCopied ? '✓ コピーしました' : 'Markdownをコピー'}
                </button>
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="min-h-[48px] rounded-2xl border text-[14px] font-bold active:opacity-70"
                  style={{ borderColor: 'rgba(120,160,255,0.5)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
                  Markdownをダウンロード
                </button>
              </div>
              <p className="text-[11px]" style={{ color: '#8893c4' }}>.mdファイルとして保存します（端末のダウンロード）。</p>
              <p className="text-[11px]" style={{ color: '#8893c4' }}>ダウンロードした.mdファイルは、Obsidianに入れて使えます。</p>
            </>
          )}
        </section>
      )}

      {/* 削除確認モーダル（MyBrain スタイル） */}
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
              このメモを削除しますか？
            </p>
            <p className="mt-1 text-center text-[12px]" style={{ color: '#a5b4fc' }}>
              この操作は元に戻せません。
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

      {/* 下部ネオンクイックナビ（メモ / 予定 / AI）。モーダル表示中は重なり防止のため非表示。 */}
      {!confirmingDelete && !previewUri && <NeonQuickNav />}
    </>
  );
}
