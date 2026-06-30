'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon } from './icons';
import DesktopSidebar from './DesktopSidebar';
import VoiceInput from './VoiceInput';
import { deriveTitleFromBody, parseMemoSpeechText } from '@/lib/parse/memo-speech';
import { deleteMemo, listMemos, parseTags } from '@/lib/memos';
import { getMemoStore } from '@/lib/storage/memo-store';
import { runMemoAi, type MemoAiKind } from '@/lib/ai/memo-ai';
import { createMemoMarkdownFile, downloadMarkdownFile, exportMemosAsZip } from '@/lib/markdown';
import { downloadBlobFile } from '@/lib/download';
import { isDirectoryPickerSupported, pickDirectory, writeMemosToDirectory, resolveSavedVaultDirectory, saveVaultHandle, loadVaultHandle, clearVaultHandle, writeSavedMemoToVaultIfEnabled } from '@/lib/fs';
import { isGoogleDriveConfigured, exportMemosToGoogleDrive } from '@/lib/google';
import { savedMessageForTarget } from '@/lib/storage/memo-storage-target';
import ObsidianMemoFileInfo from '@/components/ObsidianMemoFileInfo';
import { loadOllamaSettings, ollamaChat, testOllama } from '@/lib/ai/ollama';
import { isLocalHost } from '@/lib/env';
import type { Memo } from '@/lib/types';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const PURPLE = '#7B61FF';
const LAVENDER = '#EEF0FF';

const SUMMARY_TAG = 'AI要約';
const ORGANIZE_TAG = 'AI整理';
const TRANSCRIPTION_TAGS = ['文字起こし', 'Transcription'];
const FAV_KEY = 'mybrain.memo.favorites';

// フォルダ機能はDBを変更せず、クライアント側（localStorage）で管理する。
// - フォルダ一覧: { id, name }[]
// - 割り当て: { [memoId]: folderId }（未割り当て=未分類）
const FOLDERS_KEY = 'mybrain.memo.folders';
const FOLDER_MAP_KEY = 'mybrain.memo.folderMap';

type Filter = 'all' | 'fav' | 'summary' | 'organize';
type SortKey = 'updated' | 'created';

interface Folder {
  id: string;
  name: string;
}
/** 'all'=すべてのメモ / 'unfiled'=未分類 / その他=フォルダID */
type FolderSel = 'all' | 'unfiled' | string;

function loadFolders(): Folder[] {
  if (typeof window === 'undefined') return [];
  try {
    const arr = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '[]');
    return Array.isArray(arr) ? arr.filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string') : [];
  } catch {
    return [];
  }
}
function saveFolders(folders: Folder[]) {
  if (typeof window !== 'undefined') localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}
function loadFolderMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const obj = JSON.parse(localStorage.getItem(FOLDER_MAP_KEY) ?? '{}');
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}
function saveFolderMap(map: Record<string, string>) {
  if (typeof window !== 'undefined') localStorage.setItem(FOLDER_MAP_KEY, JSON.stringify(map));
}
function newFolderId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ymdHm(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}


function loadFavs(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function saveFavs(ids: string[]) {
  if (typeof window !== 'undefined') localStorage.setItem(FAV_KEY, JSON.stringify(ids));
}

/** 本文に追記された「--- AI要約 ---」セクションを取り出す（あれば） */
function extractAiSummary(body: string): string | null {
  const m = body.match(/---\s*AI要約\s*---\n([\s\S]*?)(?:\n---|\s*$)/);
  return m ? m[1].trim() : null;
}

/** 簡易 markdown 風レンダリング（見出し・箇条書きのみ。外部依存なし） */
function renderBody(body: string) {
  const lines = body.split('\n');
  return lines.map((line, i) => {
    const t = line.trimEnd();
    if (t.startsWith('### ')) {
      return <p key={i} className="mt-3 text-[14px] font-bold" style={{ color: NAVY }}>{t.slice(4)}</p>;
    }
    if (t.startsWith('## ')) {
      return <p key={i} className="mt-3 text-[15px] font-extrabold" style={{ color: NAVY }}>{t.slice(3)}</p>;
    }
    if (/^[-・]\s/.test(t)) {
      return <p key={i} className="ml-3 text-[13px]" style={{ color: '#54607A' }}>・{t.replace(/^[-・]\s/, '')}</p>;
    }
    if (/^\d+\.\s/.test(t)) {
      return <p key={i} className="ml-3 text-[13px]" style={{ color: '#54607A' }}>{t}</p>;
    }
    if (t.length === 0) return <div key={i} className="h-2" />;
    return <p key={i} className="text-[13px] leading-relaxed" style={{ color: '#54607A' }}>{t}</p>;
  });
}

export default function DesktopMemos() {
  const router = useRouter();
  const [memos, setMemos] = useState<Memo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<'list' | 'card'>('list');
  const [favs, setFavs] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // 第3カラムの表示モード（list=一覧 / detail=詳細）。ダブルクリックで detail に切替。
  const [mode, setMode] = useState<'list' | 'detail'>('list');
  // メモ選択モード（一括操作用）。selectMode ON時のみチェックを表示・操作する。
  const [selectMode, setSelectMode] = useState(false);
  // 選択中のメモID（画面内ローカルのみ。Supabase/localStorageには保存しない。selectedId とは別物）。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // File System Access API（フォルダへ直接書き出し）の対応可否。
  // SSR では false、マウント後に判定して反映する（ハイドレーション不一致を避ける）。
  const [dirPickerSupported, setDirPickerSupported] = useState(false);
  // 接続中のローカルVaultフォルダ名（保存ハンドルがあれば表示用。null=未接続）。
  const [vaultHandleName, setVaultHandleName] = useState<string | null>(null);
  // Google Drive 連携の公開設定が揃っているか（マウント後に判定）。
  const [googleDriveConfigured, setGoogleDriveConfigured] = useState(false);
  // Obsidian形式（Markdown）プレビュー・コピー（表示のみ・保存しない）
  const [mdOpen, setMdOpen] = useState(false);
  const [mdCopied, setMdCopied] = useState(false);
  // AIアシスタント（右カラム）入力
  const [aiQuestion, setAiQuestion] = useState('');
  const aiBaseRef = useRef('');

  // フォルダ（localStorage管理）
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderMap, setFolderMap] = useState<Record<string, string>>({});
  const [folderSel, setFolderSel] = useState<FolderSel>('all');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderErr, setFolderErr] = useState<string | null>(null);
  const [confirmDelFolder, setConfirmDelFolder] = useState<Folder | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [nFolder, setNFolder] = useState<string>(''); // 作成モーダルの保存先（''=未分類）

  // 音声入力（既存 VoiceInput + parseMemoSpeechText を再利用。録音開始時の本文を base に保持して追記する）
  const baseBodyRef = useRef('');

  // ローカルAI状態
  const [local, setLocal] = useState(false);
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:1.5b');
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);

  // 新規作成モーダル
  const [creating, setCreating] = useState(false);
  const [nTitle, setNTitle] = useState('');
  const [nBody, setNBody] = useState('');
  const [nTags, setNTags] = useState('');
  const [nSaving, setNSaving] = useState(false);

  // 削除確認
  const [confirmDel, setConfirmDel] = useState<Memo | null>(null);
  const [deleting, setDeleting] = useState(false);

  // AI（要約/整理）
  const [aiKind, setAiKind] = useState<MemoAiKind | null>(null);
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSaving, setAiSaving] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }

  async function refresh() {
    const { memos: rows } = await listMemos();
    setMemos(rows);
  }

  useEffect(() => {
    setFavs(loadFavs());
    setFolders(loadFolders());
    setFolderMap(loadFolderMap());
    setLocal(isLocalHost());
    const s = loadOllamaSettings();
    setOllamaModel(s.model);
    if (isLocalHost() && s.enabled) testOllama(s.endpoint).then((r) => setOllamaOk(r.ok));
    else setOllamaOk(false);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    memos.forEach((m) => m.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [memos]);

  const counts = useMemo(
    () => ({
      all: memos.length,
      fav: memos.filter((m) => favs.includes(m.id)).length,
      summary: memos.filter((m) => m.tags.includes(SUMMARY_TAG)).length,
      organize: memos.filter((m) => m.tags.includes(ORGANIZE_TAG)).length,
    }),
    [memos, favs],
  );

  // 存在するメモのみを対象にした有効な割り当て（削除済みメモの残骸は無視）
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let unfiled = 0;
    memos.forEach((m) => {
      const fid = folderMap[m.id];
      if (fid && folders.some((f) => f.id === fid)) counts[fid] = (counts[fid] ?? 0) + 1;
      else unfiled += 1;
    });
    return { counts, unfiled, all: memos.length };
  }, [memos, folderMap, folders]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = memos.filter((m) => {
      // フォルダ絞り込み
      if (folderSel === 'unfiled') {
        const fid = folderMap[m.id];
        if (fid && folders.some((f) => f.id === fid)) return false;
      } else if (folderSel !== 'all') {
        if (folderMap[m.id] !== folderSel) return false;
      }
      if (filter === 'fav' && !favs.includes(m.id)) return false;
      if (filter === 'summary' && !m.tags.includes(SUMMARY_TAG)) return false;
      if (filter === 'organize' && !m.tags.includes(ORGANIZE_TAG)) return false;
      if (tagFilter && !m.tags.includes(tagFilter)) return false;
      if (q.length > 0) {
        const hay = `${m.title} ${m.body} ${m.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) =>
      sort === 'updated' ? (b.updatedAt || 0) - (a.updatedAt || 0) : (b.createdAt || 0) - (a.createdAt || 0),
    );
    return list;
  }, [memos, query, filter, tagFilter, favs, sort, folderSel, folderMap, folders]);

  // メモをフォルダへ割り当て（''=未分類）。localStorageに保存。
  function assignFolder(memoId: string, folderId: string) {
    setFolderMap((prev) => {
      const next = { ...prev };
      if (folderId) next[memoId] = folderId;
      else delete next[memoId];
      saveFolderMap(next);
      return next;
    });
  }

  function handleCreateFolder() {
    const name = newFolderName.trim();
    if (name.length === 0) { setFolderErr('フォルダ名を入力してください。'); return; }
    if (folders.some((f) => f.name === name)) { setFolderErr('同名のフォルダが既に存在します。'); return; }
    const folder: Folder = { id: newFolderId(), name };
    const next = [...folders, folder];
    setFolders(next);
    saveFolders(next);
    setNewFolderOpen(false);
    setNewFolderName('');
    setFolderErr(null);
    setFolderSel(folder.id);
    showToast('フォルダを作成しました');
  }

  // フォルダ削除：フォルダ定義のみ削除し、所属メモは「未分類」に戻す（メモ自体は消さない）
  function handleDeleteFolder() {
    if (!confirmDelFolder) return;
    const target = confirmDelFolder.id;
    const nextFolders = folders.filter((f) => f.id !== target);
    setFolders(nextFolders);
    saveFolders(nextFolders);
    setFolderMap((prev) => {
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([mid, fid]) => { if (fid !== target) next[mid] = fid; });
      saveFolderMap(next);
      return next;
    });
    if (folderSel === target) setFolderSel('all');
    setConfirmDelFolder(null);
    showToast('フォルダを削除しました（メモは未分類に移動）');
  }

  function handleRenameFolder(id: string) {
    const name = renameVal.trim();
    if (name.length === 0) { showToast('フォルダ名を入力してください。'); return; }
    if (folders.some((f) => f.name === name && f.id !== id)) { showToast('同名のフォルダが既に存在します。'); return; }
    const next = folders.map((f) => (f.id === id ? { ...f, name } : f));
    setFolders(next);
    saveFolders(next);
    setRenameId(null);
    setRenameVal('');
    showToast('フォルダ名を変更しました');
  }

  // 先頭を自動選択
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visible.some((m) => m.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId]);

  const selected = memos.find((m) => m.id === selectedId) ?? null;

  function toggleFav(id: string) {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveFavs(next);
      return next;
    });
  }

  // メモ選択のトグル（画面内ローカルのみ・保存しない）。新しい Set を作って再描画させる。
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // フォルダ直接書き出しの対応可否をマウント後に判定（SSR では false のまま）。
  // 保存済みVaultハンドルがあれば、接続中フォルダ名も読み込んで表示する。
  useEffect(() => {
    setDirPickerSupported(isDirectoryPickerSupported());
    setGoogleDriveConfigured(isGoogleDriveConfigured());
    void loadVaultHandle().then((handle) => {
      if (handle) setVaultHandleName(handle.name || 'ローカルVault');
    });
  }, []);

  // 一括書き出しで「多い」とみなすしきい値（ZIP / フォルダ書き出しで共有）。
  const LARGE_EXPORT_WARNING_COUNT = 10;

  // 選択したメモをまとめて1つのZIPファイルとして書き出す（端末のダウンロードのみ・Vault保存/アップロードはしない）
  async function exportSelectedMemos() {
    const targets = memos.filter((m) => selectedIds.has(m.id));
    if (targets.length === 0) return;
    if (targets.length >= LARGE_EXPORT_WARNING_COUNT) {
      const proceed = window.confirm('選択数が多いため、ZIPファイルの作成に少し時間がかかる場合があります。続けますか？');
      if (!proceed) return;
    }
    const ok = window.confirm(`選択した ${targets.length} 件のメモを1つのZIPファイルとしてまとめてダウンロードします。よろしいですか？`);
    if (!ok) return;
    try {
      const { fileName, blob, count } = await exportMemosAsZip(targets);
      downloadBlobFile(fileName, blob);
      showToast(`${count}件をZIPで書き出しました`);
    } catch {
      showToast('ZIPの書き出しに失敗しました');
    }
  }

  // 選択したメモを、ユーザーが選んだフォルダの MyBrain/Memos/ へ直接書き出す（一方向・上書きしない）。
  async function exportSelectedMemosToFolder() {
    const targets = memos.filter((m) => selectedIds.has(m.id));
    if (targets.length === 0) return;
    if (targets.length >= LARGE_EXPORT_WARNING_COUNT) {
      const proceed = window.confirm('選択数が多いため、多数のMarkdownファイルを作成します。続けますか？');
      if (!proceed) return;
    }
    const ok = window.confirm(`選択した ${targets.length} 件のメモを、選んだフォルダの MyBrain/Memos/ に書き出します。よろしいですか？`);
    if (!ok) return;
    try {
      // 保存済みVaultフォルダが使えるなら、フォルダ選択を省略して再利用する。
      const resolved = await resolveSavedVaultDirectory();
      let dirHandle = resolved.state === 'ready' ? resolved.handle : null;
      if (!dirHandle) {
        // 使えない場合のみ、従来どおりフォルダ選択にフォールバック。
        dirHandle = await pickDirectory();
        if (!dirHandle) return; // 非対応 or フォルダ選択キャンセル
        // 手動で選んだフォルダは次回用に保存する（保存失敗しても書き出しは止めない）。
        await saveVaultHandle(dirHandle);
        setVaultHandleName(dirHandle.name || 'ローカルVault');
      }
      const result = await writeMemosToDirectory(dirHandle, targets);
      if (result.failureCount === 0) {
        showToast(`${result.successCount}件をフォルダへ書き出しました`);
      } else {
        // 失敗したメモは先頭2件のタイトルだけ出し、残りは「ほかN件」とまとめる。
        const SHOWN = 2;
        const titles = result.failed.slice(0, SHOWN).map((f) => f.title || '無題のメモ');
        const rest = result.failureCount - titles.length;
        const names = rest > 0 ? `${titles.join('、')}、ほか${rest}件` : titles.join('、');
        showToast(`${result.successCount}件成功・${result.failureCount}件失敗しました：${names}`);
      }
    } catch {
      showToast('フォルダへの書き出しに失敗しました');
    }
  }

  // 選択したメモを Google Drive の MyBrain/Memos/ に書き出す（一方向・上書きしない・トークンは保存しない）。
  async function exportSelectedMemosToGoogleDrive() {
    const targets = memos.filter((m) => selectedIds.has(m.id));
    if (targets.length === 0) return;
    if (targets.length >= LARGE_EXPORT_WARNING_COUNT) {
      const proceed = window.confirm('選択数が多いため、Google Driveへのアップロードに時間がかかる場合があります。続けますか？');
      if (!proceed) return;
    }
    const ok = window.confirm(`選択した ${targets.length} 件のメモをGoogle Driveの MyBrain/Memos/ に書き出します。よろしいですか？`);
    if (!ok) return;
    const result = await exportMemosToGoogleDrive(targets);
    const SHOWN = 2;
    if (result.failureCount === 0) {
      showToast(`${result.successCount}件をGoogle Driveへ書き出しました`);
    } else if (result.successCount === 0) {
      // 全件失敗：先頭の失敗理由を出す。
      showToast(`Google Driveへの書き出しに失敗しました：${result.failed[0]?.error ?? '不明なエラー'}`);
    } else {
      // 一部失敗：失敗メモのタイトルを先頭2件まで出し、残りは「ほかN件」とまとめる。
      const titles = result.failed.slice(0, SHOWN).map((f) => f.title || '無題のメモ');
      const rest = result.failureCount - titles.length;
      const names = rest > 0 ? `${titles.join('、')}、ほか${rest}件` : titles.join('、');
      showToast(`${result.successCount}件成功・${result.failureCount}件失敗しました：${names}`);
    }
  }

  // 接続中のローカルVaultフォルダを解除する（保存ハンドルを削除するだけ・Vault内のファイルには触れない）。
  async function disconnectVault() {
    const ok = window.confirm('ローカルVault接続を解除しますか？');
    if (!ok) return;
    await clearVaultHandle();
    setVaultHandleName(null);
    showToast('ローカルVault接続を解除しました');
  }

  // 保存先が obsidian-local のとき、MyBrain 保存後に「付加的に」ローカル Vault へ1件書き出す。
  // - 判定・解決・書き込みは共有ヘルパー writeSavedMemoToVaultIfEnabled に委譲（UI非接続）。
  // - ここでは返ってきた status を Phase 4.1 と同じトースト文言にマッピングするだけ。
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

  async function handleCreate() {
    if (nTitle.trim().length === 0 && nBody.trim().length === 0) {
      showToast('タイトルか本文を入力してください。');
      return;
    }
    setNSaving(true);
    // 保存アダプタ seam 経由で作成（現状は全 target が Supabase に解決＝挙動は不変）。
    const { memo, error } = await getMemoStore().createMemo({ title: nTitle, body: nBody, tags: parseTags(nTags), images: [] });
    setNSaving(false);
    if (error || !memo) {
      showToast(error || '保存に失敗しました。');
      return;
    }
    // 作成したメモを選択中フォルダ（または作成モーダルで選んだフォルダ）へ割り当て
    if (nFolder) assignFolder(memo.id, nFolder);
    setCreating(false);
    setNTitle(''); setNBody(''); setNTags('');
    await refresh();
    setSelectedId(memo.id);
    showToast(savedMessageForTarget());
    // 付加的：obsidian-local 選択かつ Vault 接続済みのときだけ、保存済みメモを Vault にも書き出す。
    await maybeWriteSavedMemoToVault(memo);
  }

  // 音声ライブ反映：録音開始時の本文(base)末尾に追記（既存本文を上書きしない）
  function nVoiceResult(text: string) {
    const base = baseBodyRef.current.trim();
    setNBody(base.length > 0 ? `${base}\n${text}` : text);
  }
  // 録音停止時：parseMemoSpeechText で「タイトルは」「内容は」を解析して振り分け
  function nVoiceStop(finalText: string) {
    const parsed = parseMemoSpeechText(finalText);
    const base = baseBodyRef.current;
    const trimmedBase = base.trim();
    if (parsed.hasTitleMarker && parsed.title) setNTitle(parsed.title);
    if (parsed.hasBodyMarker) {
      const add = parsed.body;
      setNBody(trimmedBase.length > 0 ? (add.length > 0 ? `${trimmedBase}\n${add}` : trimmedBase) : add);
    } else if (parsed.hasTitleMarker) {
      // タイトルのみ指定 → 本文は録音前の状態に戻す（生テキストを残さない）
      setNBody(base);
    } else {
      const newBody = trimmedBase.length > 0 ? `${trimmedBase}\n${parsed.body}` : parsed.body;
      setNBody(newBody);
      if (nTitle.trim().length === 0) {
        const auto = deriveTitleFromBody(parsed.body || newBody);
        if (auto) setNTitle(auto);
      }
    }
  }

  // 作成モーダルを開く（保存先フォルダの初期値＝現在選択中フォルダ）
  function openCreate() {
    setNTitle(''); setNBody(''); setNTags('');
    setNFolder(folderSel === 'all' || folderSel === 'unfiled' ? '' : folderSel);
    setCreating(true);
  }

  async function handleDelete() {
    if (!confirmDel) return;
    setDeleting(true);
    const { ok, error } = await deleteMemo(confirmDel.id);
    setDeleting(false);
    if (!ok) {
      showToast(error || '削除に失敗しました。');
      setConfirmDel(null);
      return;
    }
    setConfirmDel(null);
    setSelectedId(null);
    setMode('list');
    await refresh();
    showToast('削除しました');
  }

  async function shareMemo() {
    if (!selected) return;
    const text = `${selected.title}\n\n${selected.body}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('クリップボードにコピーしました');
    } catch {
      showToast('コピーできませんでした');
    }
  }

  // このメモを Obsidian 互換 Markdown としてクリップボードへコピー（保存はしない）
  async function copyMemoMarkdown() {
    if (!selected) return;
    const md = createMemoMarkdownFile(selected).content;
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
      showToast('コピーできませんでした');
    }
  }

  // このメモを .md ファイルとしてダウンロード（端末のダウンロードのみ・Vault保存はしない）
  function downloadMemoMarkdown() {
    if (!selected) return;
    const { fileName, content } = createMemoMarkdownFile(selected);
    try {
      downloadMarkdownFile(fileName, content);
    } catch {
      showToast('ダウンロードに失敗しました');
    }
  }

  const aiLabel = aiKind === 'summary' ? 'AI要約' : aiKind === 'organize' ? 'AI整理' : 'AI回答';
  const aiTag = aiKind === 'summary' ? SUMMARY_TAG : aiKind === 'organize' ? ORGANIZE_TAG : 'AI';

  async function runAi(kind: MemoAiKind) {
    if (!selected) return;
    setAiKind(kind);
    setAiResult('');
    setAiError(null);
    if ((selected.body ?? '').trim().length === 0) {
      setAiError('要約する本文がありません。');
      return;
    }
    if (!loadOllamaSettings().enabled) {
      setAiError('Ollamaを有効にしてください。');
      return;
    }
    setAiLoading(true);
    try {
      setAiResult(await runMemoAi(kind, selected.body));
    } catch {
      setAiError('Ollama接続を確認してください。モデルが重くて応答に時間がかかっている可能性があります。軽量・推奨の qwen2.5:1.5b を試してください。');
    } finally {
      setAiLoading(false);
    }
  }

  // 自由質問・拡張クイックアクション：選択メモを文脈に既存 ollamaChat を再利用して回答を生成
  async function askAssistant(question: string) {
    if (!selected) return;
    const q = question.trim();
    if (q.length === 0) return;
    setAiKind(null);
    setAiResult('');
    setAiError(null);
    const settings = loadOllamaSettings();
    if (!settings.enabled) {
      setAiError('Ollamaを有効にしてください（設定 → AI設定）。');
      return;
    }
    setAiLoading(true);
    try {
      const ctx = `【メモのタイトル】\n${selected.title || '無題のメモ'}\n\n【メモの本文】\n${selected.body || '（本文なし）'}`;
      const answer = await ollamaChat(
        [
          { role: 'system', content: 'あなたは日本語で答える有能なアシスタントです。提示されたメモの内容だけを根拠に、簡潔で実用的に回答してください。' },
          { role: 'user', content: `${ctx}\n\n【依頼】\n${q}` },
        ],
        settings,
      );
      setAiResult(answer);
      setAiQuestion('');
    } catch {
      setAiError('Ollama接続を確認してください。モデルが重い可能性があります。軽量・推奨の qwen2.5:1.5b をお試しください。');
    } finally {
      setAiLoading(false);
    }
  }

  async function appendAi() {
    if (!selected || aiResult.trim().length === 0) return;
    setAiSaving(true);
    const newBody = `${selected.body}\n\n--- ${aiLabel} ---\n${aiResult.trim()}`;
    // seam 経由で更新（現状は全 target が Supabase に解決＝挙動は不変）。
    const { error } = await getMemoStore().updateMemo(selected.id, {
      title: selected.title,
      body: newBody,
      tags: Array.from(new Set([...selected.tags, aiTag])),
      images: selected.images,
    });
    setAiSaving(false);
    if (error) { showToast(error); return; }
    setAiResult(''); setAiKind(null);
    await refresh();
    showToast('元メモに追記しました');
  }

  async function saveAiSeparate() {
    if (!selected || aiResult.trim().length === 0) return;
    setAiSaving(true);
    const keep = selected.tags.filter((t) => TRANSCRIPTION_TAGS.includes(t));
    // 保存アダプタ seam 経由で作成（現状は全 target が Supabase に解決＝挙動は不変）。
    const { memo, error } = await getMemoStore().createMemo({
      title: `${aiTag}：${selected.title || '無題のメモ'}`,
      body: aiResult.trim(),
      tags: Array.from(new Set([aiTag, ...keep])),
      images: [],
    });
    setAiSaving(false);
    if (error || !memo) { showToast(error || '保存に失敗しました。'); return; }
    setAiResult(''); setAiKind(null);
    await refresh();
    setSelectedId(memo.id);
    showToast('別メモとして保存しました');
  }

  // AI回答のコピー（既存のクリップボードロジックを共有）
  async function copyAiResult() {
    if (aiResult.trim().length === 0) { showToast('コピーする回答がありません。'); return; }
    try { await navigator.clipboard.writeText(aiResult); showToast('回答をコピーしました'); }
    catch { showToast('コピーできませんでした'); }
  }

  // AIアシスタントのクイックアクション定義（要約/整理は既存 runMemoAi を再利用）
  const QUICK_ACTIONS: { label: string; run: () => void }[] = [
    { label: 'このメモを要約', run: () => runAi('summary') },
    { label: '内容を整理', run: () => runAi('organize') },
    { label: '次のアクションを提案', run: () => askAssistant('このメモを踏まえて、次に取るべき具体的なアクションを箇条書きで提案してください。') },
    { label: '関連アイデアを出す', run: () => askAssistant('このメモに関連する新しいアイデアをいくつか提案してください。') },
    { label: '仕事・営業への活用案', run: () => askAssistant('このメモの内容を、仕事や営業にどう活かせるか具体的に提案してください。') },
  ];

  function FilterChip({ k, label, count }: { k: Filter; label: string; count: number }) {
    const active = filter === k && !tagFilter;
    return (
      <button
        type="button"
        onClick={() => { setFilter(k); setTagFilter(null); }}
        className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition"
        style={active ? { background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)`, color: '#fff' } : { backgroundColor: '#fff', color: '#54607A', border: '1px solid #E8EAF3' }}>
        {label}
        <span className="rounded-full px-1.5 text-[11px]" style={active ? { backgroundColor: 'rgba(255,255,255,0.25)' } : { backgroundColor: LAVENDER, color: PURPLE }}>{count}</span>
      </button>
    );
  }

  const aiSummary = selected ? extractAiSummary(selected.body) : null;

  // AIアシスタント参照情報：同じフォルダ / 同じタグのメモ（選択メモ自身は除く）
  const sameFolderMemos = useMemo(() => {
    if (!selected) return [];
    const fid = folderMap[selected.id];
    if (!fid || !folders.some((f) => f.id === fid)) return [];
    return memos.filter((m) => m.id !== selected.id && folderMap[m.id] === fid);
  }, [selected, memos, folderMap, folders]);
  const sameTagMemos = useMemo(() => {
    if (!selected || selected.tags.length === 0) return [];
    return memos.filter((m) => m.id !== selected.id && m.tags.some((t) => selected.tags.includes(t)));
  }, [selected, memos]);
  const recentMemos = useMemo(
    () => [...memos].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6),
    [memos],
  );

  return (
    <div className="fixed inset-0 z-40 hidden bg-[#F7F8FC] lg:flex">
      {/* ── 左サイドバー（共通） ── */}
      <DesktopSidebar active="memos" bottom={
        <>
          <div className="rounded-2xl border border-[#E8EAF3] bg-[#FBFBFE] p-3">
            <p className="mb-2 text-[11px] font-bold" style={{ color: MUTED }}>AIステータス</p>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: local && ollamaOk ? '#22C55E' : '#C9CEDB' }} /><span className="text-[12px] font-bold" style={{ color: '#1F2937' }}>Ollama</span></span>
              <span className="text-[11px] font-bold" style={{ color: local && ollamaOk ? '#1B8A4B' : '#A6AEC0' }}>{local && ollamaOk ? '接続OK' : ollamaOk === null ? '確認中…' : '未接続'}</span>
            </div>
            <p className="ml-3.5 mt-0.5 text-[10px]" style={{ color: MUTED }}>モデル: {ollamaModel}</p>
            <div className="my-2 h-px bg-[#EEF0F5]" />
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: local ? '#22C55E' : '#C9CEDB' }} /><span className="text-[12px] font-bold" style={{ color: '#1F2937' }}>Whisper</span></span>
              <span className="text-[11px] font-bold" style={{ color: local ? '#1B8A4B' : '#A6AEC0' }}>{local ? '使用可能' : 'ローカル専用'}</span>
            </div>
          </div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: LAVENDER }}>
            <p className="text-[12px] font-bold" style={{ color: NAVY }}>今日もいい一日を！</p>
            <p className="text-[10px]" style={{ color: '#54607A' }}>あなたの思考を整理して素敵な一日をサポートします 😊</p>
          </div>
        </>
      } />

      {/* ── フォルダカラム ── */}
      <div className="flex w-52 shrink-0 flex-col border-r border-[#E8EAF3] bg-[#FBFBFE]">
        <div className="flex items-center justify-between px-4 pb-2 pt-5">
          <p className="text-[14px] font-extrabold" style={{ color: NAVY }}>フォルダ</p>
          <button
            type="button"
            onClick={() => { setNewFolderName(''); setFolderErr(null); setNewFolderOpen(true); }}
            className="rounded-lg px-2 py-1 text-[11px] font-bold"
            style={{ backgroundColor: LAVENDER, color: PURPLE }}>
            ＋ 新規
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {/* 固定項目 */}
          <FolderItem label="📁 すべてのメモ" active={folderSel === 'all'} count={folderCounts.all} onClick={() => setFolderSel('all')} />
          <FolderItem label="🗂️ 未分類" active={folderSel === 'unfiled'} count={folderCounts.unfiled} onClick={() => setFolderSel('unfiled')} />
          <div className="my-2 h-px bg-[#EEF0F5]" />
          {folders.length === 0 && (
            <p className="px-3 py-2 text-[11px]" style={{ color: MUTED }}>フォルダがありません。「＋新規」で作成できます。</p>
          )}
          {folders.map((f) => {
            const active = folderSel === f.id;
            return (
              <div key={f.id} className="group relative">
                {renameId === f.id ? (
                  <div className="flex items-center gap-1 px-2 py-1">
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(f.id); if (e.key === 'Escape') setRenameId(null); }}
                      className="w-full rounded-lg border border-[#E8EAF3] px-2 py-1 text-[12px] outline-none focus:border-[#7B61FF]"
                      style={{ color: '#1F2937' }}
                    />
                    <button type="button" onClick={() => handleRenameFolder(f.id)} className="shrink-0 text-[12px] font-bold" style={{ color: PURPLE }}>OK</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setFolderSel(f.id)}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition"
                    style={active
                      ? { background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)`, color: '#fff', boxShadow: '0 4px 12px rgba(123,97,255,0.30)' }
                      : { color: '#54607A' }}>
                    <span className="shrink-0">📂</span>
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 rounded-full px-1.5 text-[10px]" style={active ? { backgroundColor: 'rgba(255,255,255,0.25)' } : { backgroundColor: LAVENDER, color: PURPLE }}>{folderCounts.counts[f.id] ?? 0}</span>
                  </button>
                )}
                {renameId !== f.id && (
                  <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex">
                    <button type="button" aria-label="名前を変更" onClick={(e) => { e.stopPropagation(); setRenameId(f.id); setRenameVal(f.name); }} className="rounded-md px-1 py-0.5 text-[11px]" style={{ color: active ? '#fff' : '#A6AEC0' }}>✎</button>
                    <button type="button" aria-label="削除" onClick={(e) => { e.stopPropagation(); setConfirmDelFolder(f); }} className="rounded-md px-1 py-0.5 text-[11px]" style={{ color: active ? '#fff' : '#C0392B' }}>🗑</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 右側：ヘッダー＋メモエリア ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ヘッダー */}
        <header className="flex items-center gap-4 px-8 pt-6">
          <div className="flex-1">
            <h1 className="text-[22px] font-extrabold" style={{ color: NAVY }}>メモ管理</h1>
            <p className="text-[12px]" style={{ color: MUTED }}>あなたのアイデアや思考を整理・保存</p>
          </div>
          <div className="relative w-[40%]">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#A6AEC0' }}><SearchIcon size={16} /></span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="メモを検索..."
              className="w-full rounded-full border border-[#E8EAF3] bg-white py-2.5 pl-9 pr-4 text-[13px] outline-none focus:border-[#7B61FF]"
              style={{ color: '#1F2937' }}
            />
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-[14px] font-bold text-white"
            style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>
            ＋ 新しいメモ
          </button>
          <div className="flex overflow-hidden rounded-xl border border-[#E8EAF3]">
            <button type="button" onClick={() => setView('card')} className="px-3 py-2" style={{ backgroundColor: view === 'card' ? LAVENDER : '#fff', color: view === 'card' ? PURPLE : '#A6AEC0' }}>▦</button>
            <button type="button" onClick={() => setView('list')} className="px-3 py-2" style={{ backgroundColor: view === 'list' ? LAVENDER : '#fff', color: view === 'list' ? PURPLE : '#A6AEC0' }}>≣</button>
          </div>
        </header>

        {/* フィルター行 */}
        <div className="flex items-center gap-2 px-8 pt-4">
          <FilterChip k="all" label="すべて" count={counts.all} />
          <FilterChip k="fav" label="お気に入り" count={counts.fav} />
          <div className="relative">
            <button
              type="button"
              onClick={() => setTagOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-full border border-[#E8EAF3] bg-white px-3.5 py-2 text-[13px] font-semibold"
              style={{ color: tagFilter ? PURPLE : '#54607A' }}>
              タグ {tagFilter ? `：${tagFilter}` : ''} ▾
            </button>
            {tagOpen && (
              <div className="absolute z-10 mt-1 max-h-64 w-48 overflow-y-auto rounded-2xl border border-[#E8EAF3] bg-white p-2 shadow-lg">
                <button type="button" onClick={() => { setTagFilter(null); setTagOpen(false); }} className="block w-full rounded-lg px-3 py-1.5 text-left text-[12px] font-semibold" style={{ color: '#54607A' }}>すべてのタグ</button>
                {allTags.map((t) => (
                  <button key={t} type="button" onClick={() => { setTagFilter(t); setFilter('all'); setTagOpen(false); }} className="block w-full rounded-lg px-3 py-1.5 text-left text-[12px] font-semibold" style={{ color: tagFilter === t ? PURPLE : '#54607A' }}>#{t}</button>
                ))}
                {allTags.length === 0 && <p className="px-3 py-1.5 text-[12px]" style={{ color: MUTED }}>タグなし</p>}
              </div>
            )}
          </div>
          <FilterChip k="summary" label="AI要約" count={counts.summary} />
          <FilterChip k="organize" label="AI整理" count={counts.organize} />
          <div className="ml-auto flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-full border border-[#E8EAF3] bg-white px-3 py-2 text-[13px] font-semibold outline-none"
              style={{ color: '#54607A' }}>
              <option value="updated">更新日順</option>
              <option value="created">作成日順</option>
            </select>
          </div>
        </div>

        {/* 第3カラム（リスト/詳細）＋ 右：AIアシスタント */}
        <div className="flex flex-1 gap-6 overflow-hidden px-8 py-5">
          {/* 第3カラム：list / detail 切替 */}
          <div className="flex-1 overflow-y-auto pr-1">
            {/* 一括エクスポートの案内（一覧表示のみ・準備中・表示のみ。ボタンや操作は無い） */}
            {mode === 'list' && (
              <div className="mb-3 rounded-2xl border border-[#E8EAF3] bg-white px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold" style={{ color: NAVY }}>一括エクスポート</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ backgroundColor: 'rgba(242,213,138,0.18)', color: '#9a7b1f', border: '1px solid rgba(242,213,138,0.5)' }}>
                    準備中
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed" style={{ color: MUTED }}>
                  複数のメモをまとめてObsidian用Markdownとして保存する機能を準備中です。
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: '#A6AEC0' }}>
                  ※ 今はメモ詳細から1件ずつダウンロードできます。
                </p>
                <button
                  type="button"
                  onClick={() => setSelectMode((o) => !o)}
                  aria-pressed={selectMode}
                  className="mt-2.5 rounded-full border border-[#E8EAF3] bg-white px-3.5 py-1.5 text-[12px] font-semibold transition active:scale-95"
                  style={{ color: '#54607A' }}>
                  {selectMode ? '選択モードを終了' : '選択してまとめる'}
                </button>
                {selectMode && (
                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-[12px] font-semibold leading-relaxed" style={{ color: MUTED }}>
                      {selectedIds.size}件 選択中
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      disabled={selectedIds.size === 0}
                      className="rounded-full border border-[#E8EAF3] bg-white px-3 py-1 text-[11px] font-semibold transition active:scale-95 disabled:opacity-40"
                      style={{ color: '#54607A' }}>
                      選択解除
                    </button>
                    <button
                      type="button"
                      onClick={exportSelectedMemos}
                      disabled={selectedIds.size === 0}
                      className="rounded-full px-3 py-1 text-[11px] font-semibold text-white transition active:scale-95 disabled:opacity-40"
                      style={{ backgroundColor: PURPLE }}>
                      選択メモを書き出し
                    </button>
                    {dirPickerSupported && (
                      <button
                        type="button"
                        onClick={exportSelectedMemosToFolder}
                        disabled={selectedIds.size === 0}
                        className="rounded-full border border-[#E8EAF3] bg-white px-3 py-1 text-[11px] font-semibold transition active:scale-95 disabled:opacity-40"
                        style={{ color: '#54607A' }}>
                        フォルダへ書き出し
                      </button>
                    )}
                    {googleDriveConfigured && (
                      <button
                        type="button"
                        onClick={exportSelectedMemosToGoogleDrive}
                        disabled={selectedIds.size === 0}
                        className="rounded-full border border-[#E8EAF3] bg-white px-3 py-1 text-[11px] font-semibold transition active:scale-95 disabled:opacity-40"
                        style={{ color: '#54607A' }}>
                        Google Driveへ書き出し
                      </button>
                    )}
                  </div>
                )}
                {selectMode && vaultHandleName && (
                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-[11px] leading-relaxed" style={{ color: MUTED }}>
                      接続中：{vaultHandleName}
                    </p>
                    <button
                      type="button"
                      onClick={disconnectVault}
                      className="rounded-full border border-[#E8EAF3] bg-white px-3 py-1 text-[11px] font-semibold transition active:scale-95"
                      style={{ color: '#54607A' }}>
                      接続解除
                    </button>
                  </div>
                )}
              </div>
            )}
            {mode === 'list' ? (
              visible.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <span className="text-4xl">🗒️</span>
                  <p className="text-[14px] font-bold" style={{ color: NAVY }}>メモがありません</p>
                  <p className="text-[12px]" style={{ color: MUTED }}>最初のメモを作成して、思考を整理しましょう。</p>
                  <button type="button" onClick={openCreate} className="rounded-2xl px-5 py-2.5 text-[13px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>＋ 新しいメモ</button>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-[11px]" style={{ color: '#A6AEC0' }}>シングルクリックで選択、ダブルクリックで詳細を開きます。</p>
                  <div className={view === 'card' ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-3'}>
                    {visible.map((m) => {
                      const sel = m.id === selectedId;
                      const isFav = favs.includes(m.id);
                      const isSelected = selectedIds.has(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedId(m.id)}
                          onDoubleClick={() => { setSelectedId(m.id); setMode('detail'); }}
                          className="rounded-2xl border bg-white p-4 text-left transition"
                          style={{ borderColor: sel ? PURPLE : '#E8EAF3', backgroundColor: sel ? '#F6F4FF' : '#fff', boxShadow: sel ? '0 6px 18px rgba(123,97,255,0.12)' : '0 4px 14px rgba(31,53,104,0.04)' }}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {/* 選択モードのチェック（クリック可能・span。親クリック/詳細遷移は stopPropagation で抑止） */}
                              {selectMode && (
                                <span
                                  role="checkbox"
                                  aria-checked={isSelected}
                                  tabIndex={0}
                                  aria-label="このメモを選択"
                                  onClick={(e) => { e.stopPropagation(); toggleSelected(m.id); }}
                                  onDoubleClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      toggleSelected(m.id);
                                    }
                                  }}
                                  className="shrink-0 cursor-pointer text-[14px] leading-none"
                                  style={{ color: isSelected ? PURPLE : '#C7CCDA' }}>
                                  {isSelected ? '☑' : '☐'}
                                </span>
                              )}
                              <p className="truncate text-[15px] font-bold" style={{ color: NAVY }}>{m.title || '無題のメモ'}</p>
                            </div>
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); toggleFav(m.id); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleFav(m.id); } }}
                              className="shrink-0 cursor-pointer text-[16px]"
                              style={{ color: isFav ? '#F5B301' : '#D7DBE6' }}>
                              {isFav ? '★' : '☆'}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[12px]" style={{ color: '#54607A' }}>{m.body || '（本文なし）'}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="truncate text-[11px]" style={{ color: PURPLE }}>{m.tags.map((t) => `#${t}`).join(' ')}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )
            ) : selected ? (
              /* ── 詳細モード（同じ第3カラム内に表示） ── */
              <div className="flex flex-col gap-4 rounded-3xl border border-[#E8EAF3] bg-white p-6 shadow-[0_10px_28px_rgba(31,53,104,0.05)]">
                <button type="button" onClick={() => setMode('list')} className="self-start text-[13px] font-bold" style={{ color: PURPLE }}>← メモ一覧へ戻る</button>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[20px] font-extrabold" style={{ color: NAVY }}>
                    {selected.title || '無題のメモ'} {favs.includes(selected.id) && <span style={{ color: '#F5B301' }}>★</span>}
                  </h2>
                </div>
                {selected.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.tags.map((t) => (
                      <span key={t} className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: LAVENDER, color: PURPLE }}>#{t}</span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: MUTED }}>
                  <span>📅 作成: {ymdHm(selected.createdAt)}</span>
                  <span>✏️ 更新: {ymdHm(selected.updatedAt)}</span>
                  <span>📄 {selected.body.length.toLocaleString()}文字</span>
                </div>
                {/* フォルダ表示・変更 */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold" style={{ color: MUTED }}>📂 フォルダ</span>
                  <select
                    value={folderMap[selected.id] && folders.some((f) => f.id === folderMap[selected.id]) ? folderMap[selected.id] : ''}
                    onChange={(e) => assignFolder(selected.id, e.target.value)}
                    className="rounded-lg border border-[#E8EAF3] bg-white px-2 py-1 text-[12px] font-semibold outline-none focus:border-[#7B61FF]"
                    style={{ color: '#54607A' }}>
                    <option value="">未分類</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div className="h-px bg-[#EEF0F5]" />
                <div className="flex flex-col">{renderBody(selected.body || '（本文なし）')}</div>

                {aiSummary && (
                  <div className="rounded-2xl border border-[#E5DDFB] p-4" style={{ backgroundColor: '#F6F4FF' }}>
                    <p className="mb-1 text-[12px] font-bold" style={{ color: PURPLE }}>✨ AI要約</p>
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: '#54607A' }}>{aiSummary}</p>
                  </div>
                )}

                {/* アクション */}
                <div className="flex flex-wrap gap-2 border-t border-[#EEF0F5] pt-4">
                  <ActionBtn label="編集" onClick={() => router.push(`/memos/${selected.id}`)} />
                  {local && <ActionBtn label="要約する" onClick={() => runAi('summary')} />}
                  {local && <ActionBtn label="整理する" onClick={() => runAi('organize')} />}
                  <ActionBtn label="共有" onClick={shareMemo} />
                  <ActionBtn label="削除" danger onClick={() => setConfirmDel(selected)} />
                </div>

                {/* ── Obsidian形式（Markdown）プレビュー・コピー（表示のみ・保存しない） ── */}
                <div className="rounded-2xl border border-[#E8EAF3] p-4" style={{ backgroundColor: '#FBFBFE' }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-extrabold" style={{ color: NAVY }}>Obsidian用Markdown</p>
                    <button
                      type="button"
                      onClick={() => setMdOpen((v) => !v)}
                      className="rounded-lg border border-[#E8EAF3] bg-white px-3 py-1.5 text-[12px] font-bold"
                      style={{ color: '#54607A' }}>
                      {mdOpen ? '閉じる' : 'Obsidian形式で表示'}
                    </button>
                  </div>
                  {/* 常時表示の案内：MyBrainに保存済み／Obsidianに入れたい時はコピー・ダウンロード */}
                  <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: '#54607A' }}>
                    このメモはMyBrainに保存されています。Obsidianに入れたい場合は、下のMarkdownをコピーまたはダウンロードしてください。
                  </p>
                  {mdOpen && (
                    <div className="mt-3 flex flex-col gap-3">
                      <p className="text-[11px]" style={{ color: MUTED }}>
                        このメモを Obsidian 互換の Markdown で表示します（プレビューのみ・保存はされません）。
                      </p>
                      <textarea
                        readOnly
                        value={createMemoMarkdownFile(selected).content}
                        rows={12}
                        onFocus={(e) => e.currentTarget.select()}
                        className="resize-y rounded-xl border border-[#E8EAF3] bg-white px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-[#7B61FF]"
                        style={{ color: '#1F2937', fontFamily: 'Consolas, Meiryo, monospace' }}
                      />
                      {(() => {
                        const f = createMemoMarkdownFile(selected);
                        return <ObsidianMemoFileInfo fileName={f.fileName} path={f.path} variant="light" />;
                      })()}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={copyMemoMarkdown}
                          className="rounded-xl px-4 py-2 text-[13px] font-bold text-white"
                          style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>
                          {mdCopied ? '✓ コピーしました' : 'Obsidian用Markdownをコピー'}
                        </button>
                        <button
                          type="button"
                          onClick={downloadMemoMarkdown}
                          className="rounded-xl border border-[#E8EAF3] bg-white px-4 py-2 text-[13px] font-bold"
                          style={{ color: '#54607A' }}>
                          Obsidian用Markdownをダウンロード
                        </button>
                      </div>
                      <p className="text-[11px] leading-relaxed" style={{ color: MUTED }}>今は自動保存ではありません。コピーまたはダウンロードしたMarkdownをObsidianに入れて使います。</p>
                    </div>
                  )}
                </div>

                {/* ── AIアシスタント（メモ本文・操作の下に自然に続くセクション） ── */}
                <div className="mt-1 flex flex-col gap-4 rounded-2xl border border-[#E5DDFB] p-5" style={{ backgroundColor: '#FAF9FF' }}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl text-white" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>🤖</span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-extrabold" style={{ color: NAVY }}>AIアシスタント</p>
                      <p className="truncate text-[11px]" style={{ color: MUTED }}>このメモについてAIに質問 ・ 対象: {selected.title || '無題のメモ'}</p>
                    </div>
                  </div>

                  {/* 入力 */}
                  <div className="flex items-end gap-2 rounded-2xl border border-[#E8EAF3] bg-white px-2.5 py-2">
                    <textarea
                      value={aiQuestion}
                      onChange={(e) => setAiQuestion(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAssistant(aiQuestion); } }}
                      rows={1}
                      placeholder="このメモについてAIに質問..."
                      className="max-h-28 min-h-[38px] flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none placeholder:text-[#A6AEC0]"
                      style={{ color: '#1F2937' }}
                    />
                    <VoiceInput iconOnly onResult={(t) => setAiQuestion(t)} getInitial={() => { aiBaseRef.current = aiQuestion; return aiQuestion; }} />
                    <button type="button" onClick={() => askAssistant(aiQuestion)} disabled={aiLoading} className="shrink-0 rounded-xl px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>送信</button>
                  </div>

                  {/* クイックアクション */}
                  <div className="flex flex-wrap gap-2">
                    {QUICK_ACTIONS.map((a) => (
                      <button key={a.label} type="button" onClick={a.run} disabled={aiLoading} className="rounded-full border border-[#E8EAF3] bg-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ color: '#54607A' }}>{a.label}</button>
                    ))}
                  </div>

                  {/* AI回答エリア */}
                  {(aiLoading || aiError || aiResult) && (
                    <div className="rounded-2xl border border-[#E8EAF3] bg-white p-4">
                      <p className="mb-2 text-[12px] font-bold" style={{ color: NAVY }}>{aiLabel}結果</p>
                      {aiLoading && <p className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: LAVENDER, color: NAVY }}>Ollama で考えています…</p>}
                      {aiError && <p className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#FDECEC', color: '#C0392B' }}>⚠️ {aiError}</p>}
                      {!aiLoading && aiResult && (
                        <>
                          <textarea value={aiResult} onChange={(e) => setAiResult(e.target.value)} rows={8} className="w-full resize-y rounded-xl border border-[#E8EAF3] px-3 py-2 text-[13px] outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button type="button" onClick={copyAiResult} className="min-h-[40px] flex-1 rounded-xl border text-[13px] font-bold" style={{ borderColor: '#E8EAF3', color: '#54607A' }}>⧉ 回答をコピー</button>
                            <button type="button" onClick={appendAi} disabled={aiSaving} className="min-h-[40px] flex-1 rounded-xl text-[13px] font-bold text-white disabled:opacity-50" style={{ backgroundColor: NAVY }}>{aiSaving ? '保存中…' : 'メモに追記'}</button>
                            <button type="button" onClick={saveAiSeparate} disabled={aiSaving} className="min-h-[40px] flex-1 rounded-xl border text-[13px] font-bold disabled:opacity-50" style={{ borderColor: NAVY, color: NAVY }}>{aiSaving ? '保存中…' : '別メモで保存'}</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <span className="text-3xl">🗒️</span>
                <p className="text-[13px]" style={{ color: MUTED }}>メモが選択されていません。</p>
                <button type="button" onClick={() => setMode('list')} className="text-[13px] font-bold" style={{ color: PURPLE }}>← メモ一覧へ戻る</button>
              </div>
            )}
          </div>

          {/* ── 右：参照・関連情報 ── */}
          <div className="w-[320px] shrink-0 overflow-y-auto">
            {!selected ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 rounded-3xl border border-[#E8EAF3] bg-white px-5 text-center">
                <span className="text-3xl">🔎</span>
                <p className="text-[14px] font-bold" style={{ color: NAVY }}>関連情報</p>
                <p className="text-[12px]" style={{ color: MUTED }}>メモを選択すると、関連する情報が表示されます。</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 rounded-3xl border border-[#E8EAF3] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.05)]">
                <p className="text-[14px] font-extrabold" style={{ color: NAVY }}>参照情報</p>

                <div>
                  <p className="mb-1 text-[11px] font-semibold" style={{ color: MUTED }}>選択中のメモ</p>
                  <p className="truncate text-[12px]" style={{ color: '#54607A' }}>📝 {selected.title || '無題のメモ'}</p>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-semibold" style={{ color: MUTED }}>同じフォルダのメモ（{sameFolderMemos.length}）</p>
                  {sameFolderMemos.length === 0 ? (
                    <p className="text-[11px]" style={{ color: '#A6AEC0' }}>なし</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {sameFolderMemos.slice(0, 6).map((m) => (
                        <button key={m.id} type="button" onClick={() => { setSelectedId(m.id); setMode('detail'); }} className="truncate text-left text-[12px]" style={{ color: PURPLE }}>・{m.title || '無題のメモ'}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-semibold" style={{ color: MUTED }}>同じタグのメモ（{sameTagMemos.length}）</p>
                  {sameTagMemos.length === 0 ? (
                    <p className="text-[11px]" style={{ color: '#A6AEC0' }}>なし</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {sameTagMemos.slice(0, 6).map((m) => (
                        <button key={m.id} type="button" onClick={() => { setSelectedId(m.id); setMode('detail'); }} className="truncate text-left text-[12px]" style={{ color: PURPLE }}>・{m.title || '無題のメモ'}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-[#EEF0F5] pt-3">
                  <p className="mb-1 text-[11px] font-semibold" style={{ color: MUTED }}>最近のメモ</p>
                  <div className="flex flex-col gap-1">
                    {recentMemos.length === 0 ? (
                      <p className="text-[11px]" style={{ color: '#A6AEC0' }}>なし</p>
                    ) : recentMemos.map((m) => (
                      <button key={m.id} type="button" onClick={() => { setSelectedId(m.id); setMode('detail'); }} className="truncate text-left text-[12px]" style={{ color: m.id === selected.id ? NAVY : PURPLE }}>・{m.title || '無題のメモ'}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 新規作成モーダル */}
      {creating && (
        <Modal onClose={() => !nSaving && setCreating(false)}>
          <p className="text-[16px] font-bold" style={{ color: NAVY }}>新しいメモ</p>
          <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="タイトル" className="rounded-2xl border border-[#E8EAF3] px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
          <textarea value={nBody} onChange={(e) => setNBody(e.target.value)} rows={6} placeholder="本文" className="resize-y rounded-2xl border border-[#E8EAF3] px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
          {/* 音声入力（既存 VoiceInput + parseMemoSpeechText を再利用）。
              「🎤 音声入力」=本文を録音前の状態から書き起こし、「＋ 追加音声入力」=既存本文の末尾に追記。
              いずれも「タイトルは」「内容は」を解析してタイトル・本文へ振り分けます。 */}
          <div className="flex flex-wrap items-center gap-2">
            <VoiceInput
              label="🎤 音声入力"
              onResult={nVoiceResult}
              onStop={nVoiceStop}
              getInitial={() => { baseBodyRef.current = ''; return ''; }}
            />
            <VoiceInput
              label="＋ 追加音声入力"
              onResult={nVoiceResult}
              onStop={nVoiceStop}
              getInitial={() => { baseBodyRef.current = nBody; return ''; }}
            />
            <span className="text-[11px]" style={{ color: '#A6AEC0' }}>例：「タイトルは買い物 内容は牛乳と卵」</span>
          </div>
          <input value={nTags} onChange={(e) => setNTags(e.target.value)} placeholder="タグ（カンマ区切り）" className="rounded-2xl border border-[#E8EAF3] px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }} />
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold" style={{ color: MUTED }}>保存先フォルダ</span>
            <select value={nFolder} onChange={(e) => setNFolder(e.target.value)} className="rounded-2xl border border-[#E8EAF3] bg-white px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]" style={{ color: '#1F2937' }}>
              <option value="">未分類</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="rounded-2xl bg-gray-100 px-5 py-2.5 text-[14px] font-bold" style={{ color: '#54607A' }}>キャンセル</button>
            <button type="button" onClick={handleCreate} disabled={nSaving} className="rounded-2xl px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>{nSaving ? '保存中…' : '保存'}</button>
          </div>
        </Modal>
      )}

      {/* 削除確認 */}
      {confirmDel && (
        <Modal onClose={() => !deleting && setConfirmDel(null)}>
          <p className="text-center text-[15px] font-bold" style={{ color: NAVY }}>このメモを削除しますか？</p>
          <p className="text-center text-[12px]" style={{ color: MUTED }}>この操作は元に戻せません。</p>
          <div className="mt-2 flex gap-3">
            <button type="button" onClick={() => setConfirmDel(null)} disabled={deleting} className="flex-1 rounded-full border border-[#E8EAF3] py-3 text-[14px] font-semibold" style={{ color: MUTED }}>キャンセル</button>
            <button type="button" onClick={handleDelete} disabled={deleting} className="flex-1 rounded-full py-3 text-[14px] font-semibold text-white" style={{ backgroundColor: '#E05555' }}>{deleting ? '削除中…' : '削除'}</button>
          </div>
        </Modal>
      )}

      {/* フォルダ作成モーダル */}
      {newFolderOpen && (
        <Modal onClose={() => setNewFolderOpen(false)}>
          <p className="text-[16px] font-bold" style={{ color: NAVY }}>新規フォルダ</p>
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => { setNewFolderName(e.target.value); setFolderErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); }}
            placeholder="フォルダ名"
            className="rounded-2xl border border-[#E8EAF3] px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]"
            style={{ color: '#1F2937' }}
          />
          {folderErr && <p className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#FDECEC', color: '#C0392B' }}>{folderErr}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNewFolderOpen(false)} className="rounded-2xl bg-gray-100 px-5 py-2.5 text-[14px] font-bold" style={{ color: '#54607A' }}>キャンセル</button>
            <button type="button" onClick={handleCreateFolder} className="rounded-2xl px-5 py-2.5 text-[14px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)` }}>作成</button>
          </div>
        </Modal>
      )}

      {/* フォルダ削除確認 */}
      {confirmDelFolder && (
        <Modal onClose={() => setConfirmDelFolder(null)}>
          <p className="text-center text-[15px] font-bold" style={{ color: NAVY }}>このフォルダを削除しますか？</p>
          <p className="text-center text-[12px] leading-relaxed" style={{ color: MUTED }}>フォルダ内のメモは削除されず、未分類に移動します。</p>
          <div className="mt-2 flex gap-3">
            <button type="button" onClick={() => setConfirmDelFolder(null)} className="flex-1 rounded-full border border-[#E8EAF3] py-3 text-[14px] font-semibold" style={{ color: MUTED }}>キャンセル</button>
            <button type="button" onClick={handleDeleteFolder} className="flex-1 rounded-full py-3 text-[14px] font-semibold text-white" style={{ backgroundColor: '#E05555' }}>削除</button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-8 left-1/2 z-[60] -translate-x-1/2">
          <span className="rounded-full bg-black/80 px-4 py-2 text-[13px] font-semibold text-white shadow-lg">{toast}</span>
        </div>
      )}
    </div>
  );
}

function FolderItem({ label, active, count, onClick }: { label: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition"
      style={active
        ? { background: `linear-gradient(135deg, ${PURPLE}, #6D8BF5)`, color: '#fff', boxShadow: '0 4px 12px rgba(123,97,255,0.30)' }
        : { color: '#54607A' }}>
      <span className="flex-1 truncate">{label}</span>
      <span className="shrink-0 rounded-full px-1.5 text-[10px]" style={active ? { backgroundColor: 'rgba(255,255,255,0.25)' } : { backgroundColor: LAVENDER, color: PURPLE }}>{count}</span>
    </button>
  );
}

function ActionBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-2xl border px-4 py-2.5 text-[13px] font-bold active:opacity-70"
      style={danger ? { borderColor: '#F3D2D2', color: '#C0392B', backgroundColor: '#fff' } : { borderColor: '#E8EAF3', color: '#54607A', backgroundColor: '#fff' }}>
      {label}
    </button>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex w-full max-w-md flex-col gap-3 rounded-3xl border border-[#E8EAF3] bg-white p-6 shadow-[0_20px_60px_rgba(31,53,104,0.18)]">
        {children}
      </div>
    </div>
  );
}
