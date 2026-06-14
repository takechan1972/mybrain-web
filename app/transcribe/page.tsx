'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronLeftIcon, MicIcon } from '@/components/icons';
import { createMemo } from '@/lib/memos';

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
    const { memo, error: err } = await createMemo({
      title: title.trim() || '文字起こしメモ',
      body: text.trim(),
      tags: ['文字起こし'],
      images: [],
    });
    setSaving(false);
    if (err || !memo) {
      showToast(err || '保存に失敗しました。');
      return;
    }
    showToast('メモとして保存しました');
    router.push('/memos');
  }

  return (
    <div className="flex flex-col gap-5" style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
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

      {/* ファイル選択 */}
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

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-6">
          <span className="rounded-full bg-black/80 px-4 py-2 text-[13px] font-semibold text-white shadow-lg">{toast}</span>
        </div>
      )}
    </div>
  );
}
