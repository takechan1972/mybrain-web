'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronLeftIcon, MicIcon } from '@/components/icons';
import { createMemo, updateMemo } from '@/lib/memos';
import { runMemoAi, type MemoAiKind } from '@/lib/ai/memo-ai';
import { isLocalHost } from '@/lib/env';
import DesktopTranscribe from '@/components/DesktopTranscribe';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const LAVENDER = '#EEF0FF';
const PURPLE = '#7B61FF';

const ACCEPT = '.m4a,.mp3,.wav,audio/*';

export default function TranscribePage() {
  const router = useRouter();
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [local, setLocal] = useState(true);

  // 保存済みメモ（AI処理の対象）
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState('');
  const [savedBody, setSavedBody] = useState('');

  // AI（要約/整理）
  const [aiKind, setAiKind] = useState<MemoAiKind | null>(null);
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSaving, setAiSaving] = useState(false);

  useEffect(() => {
    setLocal(isLocalHost());
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setText('');
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('model', 'small');
      const res = await fetch('/api/whisper', { method: 'POST', body: form });
      const data = (await res.json()) as { ok?: boolean; text?: string; error?: string };
      if (res.ok && data.ok) {
        setText(data.text ?? '');
        if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
        showToast('文字起こしが完了しました');
      } else {
        setError(data.error || 'Whisperが利用できません。Python環境とffmpegを確認してください');
      }
    } catch {
      setError('Whisperが利用できません。Python環境とffmpegを確認してください');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (text.trim().length === 0) {
      showToast('文字起こし結果がありません。');
      return;
    }
    setSaving(true);
    const t = title.trim() || '文字起こしメモ';
    const b = text.trim();
    const { memo, error: err } = await createMemo({
      title: t,
      body: b,
      tags: ['文字起こし'],
      images: [],
    });
    setSaving(false);
    if (err || !memo) {
      showToast(err || '保存に失敗しました。');
      return;
    }
    // 画面遷移せず、AI操作カードを表示できるよう保存メモを保持
    setSavedId(memo.id);
    setSavedTitle(t);
    setSavedBody(b);
    setAiKind(null);
    setAiResult('');
    setAiError(null);
    showToast('メモとして保存しました');
  }

  // AI要約/整理を実行（保存済みメモ本文を Ollama に渡す）
  async function runAi(kind: MemoAiKind) {
    setAiKind(kind);
    setAiResult('');
    setAiError(null);
    setAiLoading(true);
    try {
      const out = await runMemoAi(kind, savedBody);
      setAiResult(out);
    } catch {
      setAiError(
        'Ollama接続を確認してください。モデルが重くて応答に時間がかかっている可能性があります。軽量・推奨の qwen2.5:1.5b を試してください。',
      );
    } finally {
      setAiLoading(false);
    }
  }

  const aiLabel = aiKind === 'summary' ? 'AI要約' : aiKind === 'organize' ? 'AI整理' : '';

  // 元メモに追記
  async function appendToOriginal() {
    if (!savedId || aiResult.trim().length === 0) return;
    setAiSaving(true);
    const newBody = `${savedBody}\n\n--- ${aiLabel} ---\n${aiResult.trim()}`;
    const { memo, error: err } = await updateMemo(savedId, {
      title: savedTitle,
      body: newBody,
      tags: ['文字起こし', aiKind === 'summary' ? 'AI要約' : 'AI整理'],
      images: [],
    });
    setAiSaving(false);
    if (err || !memo) {
      showToast(err || '追記に失敗しました。');
      return;
    }
    setSavedBody(newBody);
    showToast('元メモに追記しました');
  }

  // 別メモとして保存
  async function saveAsSeparate() {
    if (aiResult.trim().length === 0) return;
    setAiSaving(true);
    const prefix = aiKind === 'summary' ? '文字起こし要約' : '文字起こし整理';
    const { memo, error: err } = await createMemo({
      title: `${prefix}：${savedTitle}`,
      body: aiResult.trim(),
      tags: ['文字起こし', aiKind === 'summary' ? 'AI要約' : 'AI整理'],
      images: [],
    });
    setAiSaving(false);
    if (err || !memo) {
      showToast(err || '保存に失敗しました。');
      return;
    }
    showToast('別メモとして保存しました');
  }

  return (
    <>
    <DesktopTranscribe />
    <div className="flex flex-col gap-5 lg:hidden" style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
      {/* ヘッダー */}
      <header className="flex items-center justify-between">
        <Link href="/" aria-label="戻る" className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full" style={{ color: NAVY }}>
          <ChevronLeftIcon size={22} />
        </Link>
        <h1 className="text-[18px] font-bold" style={{ color: NAVY }}>文字起こし</h1>
        <span className="h-9 w-9" />
      </header>

      <p className="text-[12px]" style={{ color: MUTED }}>
        音声ファイル（m4a / mp3 / wav）をローカル Whisper で文字起こしし、メモとして保存できます。PCローカル利用のみ（外部公開なし・APIキー不要）。
      </p>

      {!local && (
        <p className="rounded-2xl border border-[#E5E8F0] bg-yellow-50 p-4 text-[13px] text-yellow-800">
          文字起こしは <strong>PCローカル版専用</strong>です。公開（Vercel）環境では Whisper（ローカル Python）に接続できないため利用できません。お使いのPCでローカル起動するとご利用いただけます。
        </p>
      )}

      {/* ファイル選択（ローカル環境のみ） */}
      {local && (
      <section className="flex flex-col gap-3 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <label
          className="flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-2xl text-[14px] font-bold text-white active:opacity-70"
          style={{ backgroundColor: PURPLE }}>
          <MicIcon size={18} />
          音声ファイルを選択
          <input type="file" accept={ACCEPT} onChange={handleFile} disabled={loading} className="hidden" />
        </label>
        {fileName && (
          <p className="truncate text-[12px]" style={{ color: MUTED }}>選択中：{fileName}</p>
        )}
        {loading && (
          <p className="rounded-2xl px-4 py-3 text-[13px] font-semibold" style={{ backgroundColor: LAVENDER, color: NAVY }}>
            文字起こし中です…（モデル small・初回はモデル読み込みに時間がかかります）
          </p>
        )}
        {error && (
          <p className="rounded-2xl px-4 py-3 text-[13px] font-semibold" style={{ backgroundColor: '#FDECEC', color: '#C0392B' }}>
            ⚠️ {error}
          </p>
        )}
      </section>
      )}

      {/* 結果（編集可能） */}
      {(text || (!loading && !error && fileName)) && (
        <section className="flex flex-col gap-3 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold" style={{ color: MUTED }}>タイトル</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="文字起こしメモ"
              className="rounded-2xl border border-[#E5E8F0] bg-white px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]"
              style={{ color: '#1F2937' }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold" style={{ color: MUTED }}>文字起こし結果（編集できます）</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="ここに文字起こし結果が表示されます。"
              className="resize-y rounded-2xl border border-[#E5E8F0] bg-white px-4 py-3 text-[14px] leading-relaxed outline-none focus:border-[#7B61FF]"
              style={{ color: '#1F2937' }}
            />
          </label>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || text.trim().length === 0}
            className="flex min-h-[52px] items-center justify-center rounded-2xl text-[15px] font-bold text-white transition active:opacity-70 disabled:opacity-50"
            style={{ backgroundColor: NAVY }}>
            {saving ? '保存中…' : 'メモとして保存'}
          </button>
        </section>
      )}

      {/* 保存後のAI操作カード（PCローカルのみ） */}
      {savedId && local && (
        <section className="flex flex-col gap-3 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
          <p className="text-[13px] font-bold" style={{ color: NAVY }}>保存したメモをAIで処理</p>
          <p className="text-[12px]" style={{ color: MUTED }}>
            保存済みメモ「{savedTitle}」を Ollama で要約・整理できます。まずは軽量・推奨の <strong>qwen2.5:1.5b</strong> がおすすめです。
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => runAi('summary')}
              disabled={aiLoading}
              className="min-h-[48px] rounded-2xl text-[14px] font-bold text-white active:opacity-70 disabled:opacity-50"
              style={{ backgroundColor: PURPLE }}>
              AIで要約
            </button>
            <button
              type="button"
              onClick={() => runAi('organize')}
              disabled={aiLoading}
              className="min-h-[48px] rounded-2xl text-[14px] font-bold text-white active:opacity-70 disabled:opacity-50"
              style={{ backgroundColor: PURPLE }}>
              AIで整理
            </button>
          </div>
          <button
            type="button"
            onClick={() => router.push('/memos')}
            className="min-h-[44px] rounded-2xl border border-[#E5E8F0] bg-white text-[13px] font-bold active:opacity-70"
            style={{ color: NAVY }}>
            メモ一覧で開く
          </button>
        </section>
      )}

      {/* AI結果カード */}
      {savedId && local && (aiLoading || aiError || aiResult) && (
        <section className="flex flex-col gap-3 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
          <p className="text-[13px] font-bold" style={{ color: NAVY }}>
            {aiLabel || 'AI'}結果
          </p>
          {aiLoading && (
            <p className="rounded-2xl px-4 py-3 text-[13px] font-semibold" style={{ backgroundColor: LAVENDER, color: NAVY }}>
              Ollama で{aiLabel}しています…
            </p>
          )}
          {aiError && (
            <p className="rounded-2xl px-4 py-3 text-[13px] font-semibold" style={{ backgroundColor: '#FDECEC', color: '#C0392B' }}>
              ⚠️ {aiError}
            </p>
          )}
          {!aiLoading && aiResult && (
            <>
              <textarea
                value={aiResult}
                onChange={(e) => setAiResult(e.target.value)}
                rows={10}
                className="resize-y rounded-2xl border border-[#E5E8F0] bg-white px-4 py-3 text-[14px] leading-relaxed outline-none focus:border-[#7B61FF]"
                style={{ color: '#1F2937' }}
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={appendToOriginal}
                  disabled={aiSaving}
                  className="min-h-[48px] rounded-2xl text-[14px] font-bold text-white active:opacity-70 disabled:opacity-50"
                  style={{ backgroundColor: NAVY }}>
                  {aiSaving ? '保存中…' : '元メモに追記'}
                </button>
                <button
                  type="button"
                  onClick={saveAsSeparate}
                  disabled={aiSaving}
                  className="min-h-[48px] rounded-2xl border text-[14px] font-bold active:opacity-70 disabled:opacity-50"
                  style={{ borderColor: NAVY, color: NAVY }}>
                  {aiSaving ? '保存中…' : '別メモとして保存'}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-6">
          <span className="rounded-full bg-black/80 px-4 py-2 text-[13px] font-semibold text-white shadow-lg">{toast}</span>
        </div>
      )}
    </div>
    </>
  );
}
