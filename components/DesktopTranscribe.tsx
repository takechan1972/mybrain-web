'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { SearchIcon } from './icons';
import DesktopSidebar from './DesktopSidebar';
import { updateMemo } from '@/lib/memos';
import { getMemoStore } from '@/lib/storage/memo-store';
import { writeSavedMemoToVaultIfEnabled, overwriteVaultMemoFileIfFound } from '@/lib/fs';
import type { Memo } from '@/lib/types';
import { runMemoAi, type MemoAiKind } from '@/lib/ai/memo-ai';
import { loadOllamaSettings, testOllama } from '@/lib/ai/ollama';
import { isLocalHost } from '@/lib/env';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const PURPLE = '#7B61FF';
const LAVENDER = '#EEF0FF';

const ACCEPT = '.m4a,.mp3,.wav,.mp4,.mov,.mkv,.avi,audio/*,video/*';
const NICE_FORMATS = 'mp3, wav, m4a, mp4, mov, mkv, avi';

type Status = 'idle' | 'waiting' | 'processing' | 'done' | 'error';
type Tab = 'result' | 'summary' | 'organize' | 'save';

const RECENT_KEY = 'mybrain.transcribe.recent';

interface RecentItem {
  name: string;
  duration: string;
  at: number;
  text: string;
}

function loadRecent(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function saveRecent(items: RecentItem[]) {
  if (typeof window !== 'undefined') localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, 8)));
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function ymdHm(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function DesktopTranscribe() {
  const router = useRouter();
  const [local, setLocal] = useState(false);
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:1.5b');
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);

  // ファイル＆文字起こし
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // 表示オプション（UI）
  const [tab, setTab] = useState<Tab>('result');
  const [showTime, setShowTime] = useState(true);
  const [speakerSep, setSpeakerSep] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');

  // 右カラム設定（UI）
  const [lang, setLang] = useState('ja');
  const [model, setModel] = useState('small');
  const [autoPunct, setAutoPunct] = useState(true);

  // 保存・AI
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState('');
  const [savedBody, setSavedBody] = useState('');
  const [aiKind, setAiKind] = useState<MemoAiKind | null>(null);
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSaving, setAiSaving] = useState(false);
  const [saving, setSaving] = useState(false);

  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // 音声プレイヤー
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objUrlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [rate, setRate] = useState(1);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }

  useEffect(() => {
    setLocal(isLocalHost());
    const s = loadOllamaSettings();
    setOllamaModel(s.model);
    if (isLocalHost() && s.enabled) testOllama(s.endpoint).then((r) => setOllamaOk(r.ok));
    else setOllamaOk(false);
    setRecent(loadRecent());
    return () => {
      if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
    };
  }, []);

  async function transcribeFile(file: File) {
    if (!local) {
      setError('文字起こしは PCローカル版専用です。お使いのPCでローカル起動するとご利用いただけます。');
      setStatus('error');
      return;
    }
    setFileName(file.name);
    setFileSize(file.size);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
    setError(null);
    setText('');
    setSavedId(null);
    setStatus('processing');

    // プレイヤー用 object URL
    if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
    objUrlRef.current = URL.createObjectURL(file);
    if (audioRef.current) {
      audioRef.current.src = objUrlRef.current;
      audioRef.current.load();
    }

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('model', model || 'small');
      const res = await fetch('/api/whisper', { method: 'POST', body: form });
      const data = (await res.json()) as { ok?: boolean; text?: string; error?: string };
      if (res.ok && data.ok) {
        const out = data.text ?? '';
        setText(out);
        setStatus('done');
        setTab('result');
        showToast('文字起こしが完了しました');
        const item: RecentItem = { name: file.name, duration: fmtTime(audioRef.current?.duration ?? 0), at: Date.now(), text: out };
        const next = [item, ...loadRecent().filter((r) => r.name !== file.name)];
        saveRecent(next);
        setRecent(next.slice(0, 8));
      } else {
        setError(data.error || 'Whisperが利用できません。Python環境とffmpegを確認してください');
        setStatus('error');
      }
    } catch {
      setError('Whisperが利用できません。Python環境とffmpegを確認してください');
      setStatus('error');
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void transcribeFile(file);
    e.target.value = '';
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void transcribeFile(file);
  }

  function resetAll() {
    setFileName(''); setFileSize(0); setStatus('idle'); setError(null);
    setTitle(''); setText(''); setSavedId(null); setAiResult(''); setAiKind(null); setAiError(null);
    if (audioRef.current) audioRef.current.pause();
    setPlaying(false); setCur(0); setDur(0);
  }

  /* ── コピー / エクスポート ── */
  async function copyText() {
    if (text.trim().length === 0) { showToast('コピーする内容がありません。'); return; }
    try { await navigator.clipboard.writeText(text); showToast('コピーしました'); }
    catch { showToast('コピーできませんでした'); }
  }
  function exportAs(kind: 'txt' | 'md' | 'json') {
    if (text.trim().length === 0) { showToast('エクスポートする内容がありません。'); return; }
    const base = (title.trim() || 'transcription').replace(/[\\/:*?"<>|]/g, '_');
    let content = text;
    let mime = 'text/plain';
    if (kind === 'md') { content = `# ${title || '文字起こし'}\n\n${text}`; mime = 'text/markdown'; }
    if (kind === 'json') { content = JSON.stringify({ title, fileName, text, at: Date.now() }, null, 2); mime = 'application/json'; }
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${base}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`${kind.toUpperCase()} でエクスポートしました`);
  }

  /* ── 保存 / AI ── */
  // 保存先が obsidian-local のとき、MyBrain 保存後に「付加的に」ローカル Vault へ1件書き出す。
  // - 判定・解決・書き込みは共有ヘルパー writeSavedMemoToVaultIfEnabled に委譲（UI非接続）。
  // - ここでは返ってきた status を DesktopMemos / DesktopConsult と同じトースト文言にマッピングするだけ。
  // - 失敗は致命的ではない（メモは MyBrain に保存済みのまま）。権限の自動要求もしない。
  async function maybeWriteSavedMemoToVault(saved: Memo) {
    const outcome = await writeSavedMemoToVaultIfEnabled(saved);
    switch (outcome.status) {
      case 'written':
        showToast('Obsidianにも保存しました');
        break;
      case 'missing':
        showToast('Obsidianフォルダ未設定です。設定からVaultフォルダを選んでください。');
        break;
      case 'unsupported':
        showToast('このブラウザではObsidianフォルダ保存に対応していません。');
        break;
      case 'permission-denied':
        showToast('Obsidianフォルダの許可が必要です。設定から再接続してください。');
        break;
      case 'error':
        showToast('MyBrainには保存済みです。Obsidian保存のみ失敗しました。');
        break;
      case 'skipped':
      default:
        // 保存先が obsidian-local ではない等：トーストなし（従来挙動）。
        break;
    }
  }

  // 保存先が obsidian-local のとき、MyBrain 更新後に「付加的に」Vault 内の既存メモも上書きする。
  // - 照合・上書きは共有ヘルパー overwriteVaultMemoFileIfFound に委譲（id/source 一致の1件だけ更新）。
  // - 一致が無ければ何もしない（新規作成・リネームはしない）。
  // - 失敗は致命的ではない（メモは MyBrain に更新済みのまま）。権限の自動要求もしない。
  async function maybeOverwriteSavedMemoInVault(updatedMemo: Memo) {
    const outcome = await overwriteVaultMemoFileIfFound(updatedMemo);
    switch (outcome.status) {
      case 'updated':
        showToast('Obsidian側のメモも更新しました');
        break;
      case 'not-found':
        showToast('MyBrainは更新しました。Obsidian側の既存メモは見つからなかったため、追加作成はしていません。');
        break;
      case 'unsupported':
        showToast('このブラウザではObsidianフォルダ保存に対応していません。');
        break;
      case 'permission-denied':
        showToast('Obsidianフォルダの許可が必要です。設定から再接続してください。');
        break;
      case 'error':
        showToast('MyBrainは更新済みです。Obsidian側の更新のみ失敗しました。');
        break;
      case 'skipped':
      default:
        // 保存先が obsidian-local ではない等：トーストなし（従来挙動）。
        break;
    }
  }

  async function handleSave() {
    if (text.trim().length === 0) { showToast('文字起こし結果がありません。'); return; }
    setSaving(true);
    const t = title.trim() || '文字起こしメモ';
    const b = text.trim();
    const { memo, error: err } = await getMemoStore().createMemo({ title: t, body: b, tags: ['文字起こし'], images: [] });
    setSaving(false);
    if (err || !memo) { showToast(err || '保存に失敗しました。'); return; }
    setSavedId(memo.id); setSavedTitle(t); setSavedBody(b);
    setAiKind(null); setAiResult(''); setAiError(null);
    showToast('メモとして保存しました');
    // 付加的：obsidian-local 選択かつ Vault 接続済みのときだけ、保存済みメモを Vault にも書き出す（非致命）。
    await maybeWriteSavedMemoToVault(memo);
  }

  const aiLabel = aiKind === 'summary' ? 'AI要約' : aiKind === 'organize' ? 'AI整理' : '';

  async function runAi(kind: MemoAiKind) {
    // 未保存なら先に保存してから処理
    let body = savedBody;
    if (!savedId) {
      if (text.trim().length === 0) { showToast('文字起こし結果がありません。'); return; }
      const t = title.trim() || '文字起こしメモ';
      const { memo, error: err } = await getMemoStore().createMemo({ title: t, body: text.trim(), tags: ['文字起こし'], images: [] });
      if (err || !memo) { showToast(err || '保存に失敗しました。'); return; }
      setSavedId(memo.id); setSavedTitle(t); setSavedBody(text.trim());
      body = text.trim();
      // 付加的：obsidian-local 選択かつ Vault 接続済みのときだけ、保存済みメモを Vault にも書き出す（非致命）。
      await maybeWriteSavedMemoToVault(memo);
    }
    if (!local) { setAiError('AI要約・整理は PCローカル版専用です。'); setTab(kind === 'summary' ? 'summary' : 'organize'); setAiKind(kind); return; }
    if (!loadOllamaSettings().enabled) { setAiError('Ollamaを有効にしてください（設定 → AI設定）。'); setTab(kind === 'summary' ? 'summary' : 'organize'); setAiKind(kind); return; }
    setAiKind(kind); setAiResult(''); setAiError(null); setAiLoading(true);
    setTab(kind === 'summary' ? 'summary' : 'organize');
    try {
      setAiResult(await runMemoAi(kind, body));
    } catch {
      setAiError('Ollama接続を確認してください。モデルが重い可能性があります。軽量・推奨の qwen2.5:1.5b をお試しください。');
    } finally {
      setAiLoading(false);
    }
  }

  async function appendToOriginal() {
    if (!savedId || aiResult.trim().length === 0) return;
    setAiSaving(true);
    const newBody = `${savedBody}\n\n--- ${aiLabel} ---\n${aiResult.trim()}`;
    const { memo, error: err } = await updateMemo(savedId, {
      title: savedTitle, body: newBody, tags: ['文字起こし', aiKind === 'summary' ? 'AI要約' : 'AI整理'], images: [],
    });
    setAiSaving(false);
    if (err) { showToast(err); return; }
    setSavedBody(newBody);
    showToast('元メモに追記しました');
    // 付加的：obsidian-local 選択かつ Vault 接続済みのときだけ、更新後メモで既存ファイルを上書き（非致命）。
    // 更新が memo を返さなかった場合は Obsidian 上書きを試みない。
    if (memo) await maybeOverwriteSavedMemoInVault(memo);
  }
  async function saveAsSeparate() {
    if (aiResult.trim().length === 0) return;
    setAiSaving(true);
    const prefix = aiKind === 'summary' ? '文字起こし要約' : '文字起こし整理';
    const { memo, error: err } = await getMemoStore().createMemo({
      title: `${prefix}：${savedTitle || title || '無題'}`, body: aiResult.trim(),
      tags: ['文字起こし', aiKind === 'summary' ? 'AI要約' : 'AI整理'], images: [],
    });
    setAiSaving(false);
    if (err || !memo) { showToast(err || '保存に失敗しました。'); return; }
    showToast('別メモとして保存しました');
    // 付加的：obsidian-local 選択かつ Vault 接続済みのときだけ、保存済みメモを Vault にも書き出す（非致命）。
    await maybeWriteSavedMemoToVault(memo);
  }

  function shareLink() {
    if (text.trim().length === 0) { showToast('共有する内容がありません。'); return; }
    navigator.clipboard?.writeText(`${title || '文字起こし'}\n\n${text}`).then(
      () => showToast('共有リンク（本文）をコピーしました'),
      () => showToast('コピーできませんでした'),
    );
  }

  /* ── プレイヤー操作 ── */
  function togglePlay() {
    const a = audioRef.current;
    if (!a || !objUrlRef.current) { showToast('再生できる音声がありません。'); return; }
    if (a.paused) { void a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
  }
  function onSeek(v: number) {
    const a = audioRef.current;
    if (a) { a.currentTime = v; setCur(v); }
  }

  const statusMeta: Record<Status, { label: string; color: string; bg: string }> = {
    idle: { label: '待機中', color: '#A6AEC0', bg: '#F1F2F7' },
    waiting: { label: '待機中', color: '#A6AEC0', bg: '#F1F2F7' },
    processing: { label: '処理中', color: '#C9881A', bg: '#FBF2DD' },
    done: { label: '完了', color: '#1B8A4B', bg: '#E8F8EE' },
    error: { label: 'エラー', color: '#C0392B', bg: '#FDECEC' },
  };

  // 文字起こし本文の表示行（検索ハイライト用に分割）。実データは平文のため段落で表示。
  const paragraphs = text.split(/\n+/).filter((p) => p.trim().length > 0);

  return (
    <div className="fixed inset-0 z-40 hidden overflow-hidden bg-[#F7F8FC] lg:flex">
      {/* hidden audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />

      {/* ── 左サイドバー ── */}
      <DesktopSidebar active="transcribe" bottom={
        <>
          <div className="rounded-2xl border border-[#E8EAF3] bg-[#FBFBFE] p-3">
            <p className="mb-2 text-[11px] font-bold" style={{ color: MUTED }}>AI・音声ステータス</p>
            <StatusLine label="Ollama接続" ok={local && !!ollamaOk} okText="接続OK" ngText={local ? (ollamaOk === null ? '確認中…' : '未接続') : 'ローカル専用'} />
            <p className="ml-3.5 mt-0.5 text-[10px]" style={{ color: MUTED }}>モデル: {ollamaModel}</p>
            <div className="my-2 h-px bg-[#EEF0F5]" />
            <StatusLine label="Whisper" ok={local} okText="利用可能" ngText="ローカル専用" />
          </div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: LAVENDER }}>
            <p className="text-[12px] font-bold" style={{ color: NAVY }}>今日も素晴らしい一日になりますように！</p>
            <p className="mt-1 text-[10px]" style={{ color: '#54607A' }}>小さな一歩が、大きな未来をつくります。</p>
          </div>
        </>
      } />

      {/* ── 右側 ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* 中央 */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {/* ヘッダー */}
          <div className="mb-5 flex items-center gap-3">
            <div className="flex-1">
              <h1 className="text-[20px] font-extrabold" style={{ color: NAVY }}>文字起こし</h1>
              <p className="text-[12px]" style={{ color: MUTED }}>音声や動画をアップロードして、AIが文字起こしします</p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full border border-[#E8EAF3] bg-white px-3 py-1.5 text-[12px] font-bold">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: local ? '#22C55E' : '#C9CEDB' }} />
              Whisper（ローカル）
              <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: local ? '#E8F8EE' : '#F1F2F7', color: local ? '#1B8A4B' : '#A6AEC0' }}>{local ? '利用可能' : 'ローカル専用'}</span>
            </span>
            <Link href="/settings" className="rounded-xl border border-[#E8EAF3] bg-white px-3 py-2 text-[13px] font-bold" style={{ color: '#54607A' }}>⚙ 設定</Link>
            <button type="button" onClick={resetAll} className="rounded-xl px-4 py-2.5 text-[13px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>＋ 新しい文字起こし</button>
          </div>

          {!local && (
            <p className="mb-5 rounded-2xl border border-[#E8EAF3] bg-yellow-50 p-4 text-[13px] text-yellow-800">
              文字起こしは <strong>PCローカル版専用</strong>です。公開環境では Whisper（ローカル Python）に接続できないため利用できません。
            </p>
          )}

          {/* アップロード枠 */}
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed py-10 transition"
            style={{ borderColor: dragOver ? PURPLE : '#D9D9EC', backgroundColor: dragOver ? '#F6F4FF' : '#fff' }}>
            <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: LAVENDER, color: PURPLE }}>
              <UploadIcon size={24} />
            </span>
            <p className="text-[15px] font-bold" style={{ color: NAVY }}>音声・動画ファイルをドラッグ＆ドロップ</p>
            <p className="text-[12px]" style={{ color: MUTED }}>または</p>
            <span className="rounded-xl px-4 py-2 text-[13px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>♪ ファイルを選択</span>
            <p className="mt-1 text-[11px]" style={{ color: '#A6AEC0' }}>対応形式：{NICE_FORMATS}（最大 500MB）</p>
            <input type="file" accept={ACCEPT} onChange={handleInput} disabled={status === 'processing'} className="hidden" />
          </label>

          {/* アップロード済みファイルカード */}
          {fileName && (
            <div className="mt-5 flex items-center gap-3 rounded-3xl border border-[#E8EAF3] bg-white p-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl text-white" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>♪</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold" style={{ color: NAVY }}>{fileName}</p>
                <p className="text-[11px]" style={{ color: MUTED }}>{dur > 0 ? fmtTime(dur) : '--:--'} ・ {fmtSize(fileSize)}</p>
              </div>
              <span className="text-[12px]" style={{ color: MUTED }}>ステータス：
                <span className="ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: statusMeta[status].bg, color: statusMeta[status].color }}>{statusMeta[status].label}</span>
              </span>
              <button type="button" onClick={togglePlay} className="rounded-lg px-2 py-1 text-[16px]" style={{ color: PURPLE }}>{playing ? '⏸' : '▶'}</button>
              <button type="button" onClick={() => exportAs('txt')} className="rounded-lg px-2 py-1 text-[15px]" style={{ color: '#54607A' }}>⬇</button>
              <button type="button" onClick={resetAll} className="rounded-lg px-2 py-1 text-[15px]" style={{ color: '#C0392B' }}>🗑</button>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-2xl px-4 py-3 text-[13px] font-semibold" style={{ backgroundColor: '#FDECEC', color: '#C0392B' }}>⚠️ {error}</p>
          )}
          {status === 'processing' && (
            <p className="mt-4 rounded-2xl px-4 py-3 text-[13px] font-semibold" style={{ backgroundColor: LAVENDER, color: NAVY }}>
              文字起こし中です…（初回はモデル読み込みに時間がかかります）
            </p>
          )}

          {/* 結果エリア（ファイル選択後に表示） */}
          {(text || status === 'done') && (
            <div className="mt-5 rounded-3xl border border-[#E8EAF3] bg-white">
              {/* タブ */}
              <div className="flex items-center gap-1 border-b border-[#EEF0F5] px-4 pt-3">
                <ResultTab active={tab === 'result'} onClick={() => setTab('result')} label="文字起こし結果" />
                <ResultTab active={tab === 'summary'} onClick={() => runAi('summary')} label="要約" />
                <ResultTab active={tab === 'organize'} onClick={() => runAi('organize')} label="AI整理" />
                <ResultTab active={tab === 'save'} onClick={() => setTab('save')} label="メモに保存" />
              </div>

              {/* ツールバー */}
              {tab === 'result' && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <ToolBtn label="🔍 検索" onClick={() => setSearchOpen((o) => !o)} />
                  <ToolBtn label="⇄ 置換" onClick={() => showToast('置換は準備中です')} />
                  <Toggle label="話者分離" on={speakerSep} onChange={setSpeakerSep} />
                  <span className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: '#54607A' }}>
                    時間表示
                    <select value={showTime ? 'on' : 'off'} onChange={(e) => setShowTime(e.target.value === 'on')} className="rounded-lg border border-[#E8EAF3] px-2 py-1 text-[12px] outline-none">
                      <option value="on">ON</option><option value="off">OFF</option>
                    </select>
                  </span>
                  <div className="ml-auto flex gap-2">
                    <ToolBtn label="⧉ コピー" onClick={copyText} />
                    <div className="relative">
                      <ExportMenu onExport={exportAs} />
                    </div>
                  </div>
                </div>
              )}

              {/* 検索ボックス */}
              {tab === 'result' && searchOpen && (
                <div className="px-4 pb-2">
                  <div className="relative w-72">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#A6AEC0' }}><SearchIcon size={14} /></span>
                    <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="本文を検索..." className="w-full rounded-full border border-[#E8EAF3] py-1.5 pl-8 pr-3 text-[12px] outline-none focus:border-[#7B61FF]" />
                  </div>
                </div>
              )}

              {/* 本文 */}
              <div className="px-5 pb-5">
                {tab === 'result' && (
                  <div className="flex flex-col gap-3">
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タイトル" className="rounded-xl border border-[#E8EAF3] px-3 py-2 text-[13px] font-bold outline-none focus:border-[#7B61FF]" style={{ color: NAVY }} />
                    {paragraphs.length === 0 ? (
                      <p className="py-6 text-center text-[13px]" style={{ color: MUTED }}>ファイルを選択すると、ここに文字起こし結果が表示されます。</p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {paragraphs.map((p, i) => {
                          const hit = searchQ.trim().length > 0 && p.toLowerCase().includes(searchQ.trim().toLowerCase());
                          return (
                            <div key={i} className="flex gap-3 rounded-xl px-2 py-1" style={{ backgroundColor: hit ? '#FFF8E1' : 'transparent' }}>
                              {showTime && <span className="shrink-0 pt-0.5 text-[11px] tabular-nums" style={{ color: '#A6AEC0' }}>{fmtTime(i * 8)}</span>}
                              {speakerSep && <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: LAVENDER, color: PURPLE }}>話者{(i % 3) + 1}</span>}
                              <p className="text-[13px] leading-relaxed" style={{ color: '#37425C' }}>{p}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* 直接編集できるテキストエリア */}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: PURPLE }}>本文を編集する</summary>
                      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="mt-2 w-full resize-y rounded-xl border border-[#E8EAF3] px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
                    </details>
                  </div>
                )}

                {(tab === 'summary' || tab === 'organize') && (
                  <div className="pt-3">
                    {aiLoading && <p className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: LAVENDER, color: NAVY }}>Ollama で{aiLabel}しています…</p>}
                    {aiError && <p className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#FDECEC', color: '#C0392B' }}>⚠️ {aiError}</p>}
                    {!aiLoading && aiResult && (
                      <>
                        <textarea value={aiResult} onChange={(e) => setAiResult(e.target.value)} rows={10} className="w-full resize-y rounded-xl border border-[#E8EAF3] px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button type="button" onClick={appendToOriginal} disabled={aiSaving} className="min-h-[42px] rounded-xl text-[13px] font-bold text-white disabled:opacity-50" style={{ backgroundColor: NAVY }}>{aiSaving ? '保存中…' : '元メモに追記'}</button>
                          <button type="button" onClick={saveAsSeparate} disabled={aiSaving} className="min-h-[42px] rounded-xl border text-[13px] font-bold disabled:opacity-50" style={{ borderColor: NAVY, color: NAVY }}>{aiSaving ? '保存中…' : '別メモとして保存'}</button>
                        </div>
                      </>
                    )}
                    {!aiLoading && !aiResult && !aiError && <p className="py-6 text-center text-[12px]" style={{ color: MUTED }}>「要約」「AI整理」タブを押すとOllamaで処理します。</p>}
                  </div>
                )}

                {tab === 'save' && (
                  <div className="flex flex-col gap-3 pt-3">
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タイトル" className="rounded-xl border border-[#E8EAF3] px-3 py-2 text-[13px] font-bold outline-none focus:border-[#7B61FF]" style={{ color: NAVY }} />
                    <button type="button" onClick={handleSave} disabled={saving || text.trim().length === 0} className="min-h-[46px] rounded-xl text-[14px] font-bold text-white disabled:opacity-50" style={{ backgroundColor: NAVY }}>{saving ? '保存中…' : 'メモとして保存'}</button>
                    {savedId && <button type="button" onClick={() => router.push('/memos')} className="min-h-[42px] rounded-xl border border-[#E8EAF3] text-[13px] font-bold" style={{ color: NAVY }}>メモ一覧で開く</button>}
                  </div>
                )}
              </div>

              {/* 下部プレイヤー */}
              <div className="flex items-center gap-3 border-t border-[#EEF0F5] px-5 py-3">
                <button type="button" onClick={togglePlay} className="flex h-10 w-10 items-center justify-center rounded-full text-[16px] text-white" style={{ backgroundColor: PURPLE }}>{playing ? '⏸' : '▶'}</button>
                <span className="text-[11px] tabular-nums" style={{ color: MUTED }}>{fmtTime(cur)}</span>
                <input type="range" min={0} max={dur || 0} step={0.1} value={cur} onChange={(e) => onSeek(Number(e.target.value))} className="flex-1 accent-[#7B61FF]" />
                <span className="text-[11px] tabular-nums" style={{ color: MUTED }}>{fmtTime(dur)}</span>
                <span className="text-[13px]">🔊</span>
                <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); if (audioRef.current) audioRef.current.volume = v; }} className="w-16 accent-[#7B61FF]" />
                <select value={rate} onChange={(e) => { const r = Number(e.target.value); setRate(r); if (audioRef.current) audioRef.current.playbackRate = r; }} className="rounded-lg border border-[#E8EAF3] px-2 py-1 text-[12px] outline-none">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}x</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* ── 右カラム ── */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-[#E8EAF3] bg-[#FBFBFE] px-5 py-6">
          {/* 文字起こし設定 */}
          <SideCard title="文字起こし設定">
            <Field label="言語">
              <select value={lang} onChange={(e) => setLang(e.target.value)} className="w-full rounded-xl border border-[#E8EAF3] bg-white px-3 py-2 text-[13px] outline-none">
                <option value="ja">日本語</option><option value="en">English</option><option value="auto">自動判定</option>
              </select>
            </Field>
            <Field label="モデル">
              <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-xl border border-[#E8EAF3] bg-white px-3 py-2 text-[13px] outline-none">
                <option value="small">Whisper Small（軽量）</option>
                <option value="medium">Whisper Medium（標準）</option>
                <option value="large">Whisper Large（高精度）</option>
              </select>
            </Field>
            <div className="mt-1 flex flex-col gap-2">
              <Toggle label="話者分離" on={speakerSep} onChange={setSpeakerSep} between />
              <Toggle label="句読点の自動付与" on={autoPunct} onChange={setAutoPunct} between />
            </div>
            <Link href="/settings" className="mt-3 block rounded-xl border border-[#E8EAF3] bg-white py-2 text-center text-[12px] font-bold" style={{ color: '#54607A' }}>⚙ 詳細設定</Link>
          </SideCard>

          {/* 最近の文字起こし */}
          <SideCard title="最近の文字起こし">
            {recent.length === 0 ? (
              <p className="py-4 text-center text-[12px]" style={{ color: MUTED }}>履歴はまだありません。</p>
            ) : (
              <div className="flex flex-col gap-1">
                {recent.map((r, i) => (
                  <button key={i} type="button" onClick={() => { setText(r.text); setTitle(r.name.replace(/\.[^.]+$/, '')); setFileName(r.name); setStatus('done'); setTab('result'); }}
                    className="flex items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-[#F4F4FB]">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px]" style={{ backgroundColor: LAVENDER, color: PURPLE }}>♪</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-bold" style={{ color: NAVY }}>{r.name}</p>
                      <p className="text-[10px]" style={{ color: MUTED }}>{r.duration} ・ {ymdHm(r.at)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <Link href="/memos" className="mt-2 block text-right text-[12px] font-bold" style={{ color: PURPLE }}>すべての履歴を見る →</Link>
          </SideCard>

          {/* クイックアクション */}
          <SideCard title="クイックアクション">
            <div className="grid grid-cols-2 gap-2">
              <QuickBtn label="📝 メモに保存" onClick={handleSave} />
              <QuickBtn label="📄 要約する" onClick={() => runAi('summary')} />
              <QuickBtn label="🗂 AI整理" onClick={() => runAi('organize')} />
              <QuickBtn label="🔗 共有リンク" onClick={shareLink} />
            </div>
          </SideCard>
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-8 left-1/2 z-[60] -translate-x-1/2">
          <span className="rounded-full bg-black/80 px-4 py-2 text-[13px] font-semibold text-white shadow-lg">{toast}</span>
        </div>
      )}
    </div>
  );
}

/* ── 小コンポーネント ── */
function UploadIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ResultTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="relative px-3 pb-2.5 text-[13px] font-bold transition"
      style={{ color: active ? PURPLE : '#A6AEC0' }}>
      {label}
      {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full" style={{ backgroundColor: PURPLE }} />}
    </button>
  );
}

function ToolBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg border border-[#E8EAF3] px-2.5 py-1.5 text-[12px] font-semibold" style={{ color: '#54607A' }}>{label}</button>
  );
}

function ExportMenu({ onExport }: { onExport: (k: 'txt' | 'md' | 'json') => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-lg border border-[#E8EAF3] px-2.5 py-1.5 text-[12px] font-semibold" style={{ color: '#54607A' }}>⬇ エクスポート ▾</button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-xl border border-[#E8EAF3] bg-white shadow-lg">
          {(['txt', 'md', 'json'] as const).map((k) => (
            <button key={k} type="button" onClick={() => { onExport(k); setOpen(false); }} className="block w-full px-3 py-2 text-left text-[12px] font-semibold hover:bg-[#F4F4FB]" style={{ color: '#54607A' }}>.{k}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, on, onChange, between }: { label: string; on: boolean; onChange: (v: boolean) => void; between?: boolean }) {
  return (
    <span className={`flex items-center gap-2 text-[12px] font-semibold ${between ? 'justify-between' : ''}`} style={{ color: '#54607A' }}>
      {label}
      <button type="button" onClick={() => onChange(!on)} aria-pressed={on} className="relative h-5 w-9 shrink-0 rounded-full transition-colors" style={{ backgroundColor: on ? PURPLE : '#D7DBE6' }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: on ? '18px' : '2px' }} />
      </button>
    </span>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-[#E8EAF3] bg-white p-4 shadow-[0_6px_18px_rgba(31,53,104,0.04)]">
      <p className="mb-3 text-[13px] font-extrabold" style={{ color: NAVY }}>{title}</p>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 flex flex-col gap-1">
      <span className="text-[11px] font-semibold" style={{ color: MUTED }}>{label}</span>
      {children}
    </label>
  );
}

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-[#E8EAF3] py-2.5 text-[12px] font-bold" style={{ color: '#54607A' }}>{label}</button>
  );
}

function StatusLine({ label, ok, okText, ngText }: { label: string; ok: boolean; okText: string; ngText: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ok ? '#22C55E' : '#C9CEDB' }} />
        <span className="text-[12px] font-bold" style={{ color: '#1F2937' }}>{label}</span>
      </span>
      <span className="text-[11px] font-bold" style={{ color: ok ? '#1B8A4B' : '#A6AEC0' }}>{ok ? okText : ngText}</span>
    </div>
  );
}
