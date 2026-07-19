'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DesktopSidebar from './DesktopSidebar';
import {
  DEFAULT_OLLAMA_SETTINGS,
  OLLAMA_MODELS,
  loadOllamaSettings,
  saveOllamaSettings,
  testOllama,
  type OllamaSettings,
} from '@/lib/ai/ollama';
import { listMemos } from '@/lib/memos';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isLocalHost } from '@/lib/env';
import {
  DEFAULT_MEMO_STORAGE_TARGET,
  loadMemoStorageTarget,
  saveMemoStorageTarget,
} from '@/lib/storage/memo-storage-target';
import type { MemoStorageTarget } from '@/lib/storage/memo-store';
import { OBSIDIAN_MEMO_FOLDER } from '@/lib/markdown';
import {
  isDirectoryPickerSupported,
  pickDirectory,
  saveVaultHandle,
  loadVaultHandle,
  clearVaultHandle,
  resolveSavedVaultDirectory,
} from '@/lib/fs';
import MemoImportPanel, { MEMO_IMPORT_SECTION_ID } from './MemoImportPanel';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const PURPLE = '#7B61FF';
const LAVENDER = '#EEF0FF';

type TabKey = 'ai' | 'app' | 'notify' | 'data' | 'account';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'ai', label: 'AI設定', icon: '🤖' },
  { key: 'app', label: 'アプリ設定', icon: '⚙️' },
  { key: 'notify', label: '通知設定', icon: '🔔' },
  { key: 'data', label: 'データ管理', icon: '🗂️' },
  { key: 'account', label: 'アカウント', icon: '👤' },
];

/** アプリ設定（UIのみ・localStorage 保存。DBやAPIには影響しない） */
interface AppSettings {
  theme: 'light' | 'dark';
  fontSize: 'small' | 'medium' | 'large';
  dayStart: string;
  weekStart: 'sun' | 'mon';
  aiLength: 'short' | 'normal' | 'long';
  autoSave: boolean;
  autoSaveDraft: boolean;
  autoCompressImage: boolean;
  startScreen: 'home' | 'memos' | 'reservations';
  backupFreq: 'daily' | 'weekly' | 'monthly' | 'off';
  // Whisper
  whisperModel: 'small' | 'medium' | 'large';
  whisperLang: 'ja' | 'en' | 'auto';
  diarization: boolean;
  autoPunct: boolean;
  termOptimize: boolean;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'light',
  fontSize: 'medium',
  dayStart: '06:00',
  weekStart: 'mon',
  aiLength: 'normal',
  autoSave: true,
  autoSaveDraft: true,
  autoCompressImage: true,
  startScreen: 'home',
  backupFreq: 'daily',
  whisperModel: 'large',
  whisperLang: 'ja',
  diarization: true,
  autoPunct: true,
  termOptimize: true,
};

const APP_KEY = 'mybrain.app.settings';

function loadAppSettings(): AppSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_APP_SETTINGS };
  try {
    const raw = localStorage.getItem(APP_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    return { ...DEFAULT_APP_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

function nowHm(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function DesktopSettings() {
  const [tab, setTab] = useState<TabKey>('ai');
  const [email, setEmail] = useState<string | null>(null);
  const [local, setLocal] = useState(false);

  // Ollama 設定（既存を再利用）
  const [ollama, setOllama] = useState<OllamaSettings>(DEFAULT_OLLAMA_SETTINGS);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  // アプリ設定（UIのみ）
  const [app, setApp] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  // ストレージ表示用
  const [memoCount, setMemoCount] = useState<number | null>(null);

  // メモの保存先（選択の保存・表示のみ。保存挙動はヘルパー側で判定＝ここでは変更しない）
  const [memoStorageTarget, setMemoStorageTarget] = useState<MemoStorageTarget>(DEFAULT_MEMO_STORAGE_TARGET);
  function selectMemoStorageTarget(target: MemoStorageTarget) {
    setMemoStorageTarget(target);
    saveMemoStorageTarget(target);
  }

  // ローカル Obsidian Vault フォルダの接続（表示・選択・解除のみ。ここではメモを書き込まない）。
  const [vaultDirSupported, setVaultDirSupported] = useState(true);
  const [vaultHandleName, setVaultHandleName] = useState<string | null>(null);
  const [vaultStatus, setVaultStatus] = useState<string | null>(null);

  // Vaultフォルダを選択（ユーザークリック時のみ。ページ読み込み時に自動で権限要求はしない）。
  async function connectVaultFolder() {
    if (!isDirectoryPickerSupported()) {
      setVaultStatus('このブラウザではVaultフォルダ保存に対応していません');
      return;
    }
    const handle = await pickDirectory();
    if (!handle) return; // 非対応 or フォルダ選択キャンセル
    await saveVaultHandle(handle);
    setVaultHandleName(handle.name || 'ローカルVault');
    setVaultStatus('Vaultフォルダが接続されています');
  }

  // 保存済みVaultフォルダの状態を確認して再接続（ユーザークリック時のみ）。
  async function reconnectVaultFolder() {
    const resolved = await resolveSavedVaultDirectory();
    switch (resolved.state) {
      case 'ready':
        if (resolved.handle) setVaultHandleName(resolved.handle.name || 'ローカルVault');
        setVaultStatus('Vaultフォルダが接続されています');
        break;
      case 'missing':
        setVaultStatus('Vaultフォルダが未設定です');
        break;
      case 'permission-denied':
        setVaultStatus('Vaultフォルダの許可が必要です。再接続してください');
        break;
      case 'unsupported':
        setVaultStatus('このブラウザではVaultフォルダ保存に対応していません');
        break;
      default:
        setVaultStatus('Vaultフォルダの確認に失敗しました');
        break;
    }
  }

  // 接続を解除（保存ハンドルを削除するだけ・Vault内のファイルには触れない）。
  async function disconnectVaultFolder() {
    await clearVaultHandle();
    setVaultHandleName(null);
    setVaultStatus('Vaultフォルダが未設定です');
  }

  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  }

  useEffect(() => {
    setLocal(isLocalHost());
    setOllama(loadOllamaSettings());
    setApp(loadAppSettings());
    setMemoStorageTarget(loadMemoStorageTarget());
    // Vaultフォルダは対応可否と保存済みフォルダ名の表示のみ（権限の自動要求はしない）。
    setVaultDirSupported(isDirectoryPickerSupported());
    void loadVaultHandle().then((handle) => {
      if (handle) setVaultHandleName(handle.name || 'ローカルVault');
    });
    const sb = getSupabaseBrowserClient();
    sb?.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    listMemos().then(({ memos }) => setMemoCount(memos.length)).catch(() => setMemoCount(null));
    // 起動時にローカルなら接続チェック
    const s = loadOllamaSettings();
    if (isLocalHost() && s.enabled) void runTest(s.endpoint, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateOllama(patch: Partial<OllamaSettings>) {
    setOllama((prev) => {
      const next = { ...prev, ...patch };
      saveOllamaSettings(next);
      return next;
    });
    setTestResult(null);
  }

  function updateApp(patch: Partial<AppSettings>) {
    setApp((prev) => {
      const next = { ...prev, ...patch };
      if (typeof window !== 'undefined') localStorage.setItem(APP_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function runTest(endpoint: string, silent = false) {
    setTesting(true);
    if (!silent) setTestResult(null);
    const t0 = performance.now();
    const r = await testOllama(endpoint);
    const ms = Math.round(performance.now() - t0);
    setTesting(false);
    setLatency(r.ok ? ms : null);
    setLastCheck(nowHm());
    setTestResult({ ok: r.ok, message: r.message });
  }

  // 「⬇ インポート（データ取込）」→ データ管理タブへ切り替えて取り込みセクションを表示する（IMP2a）
  function openMemoImportSection() {
    setTab('data');
    // タブ切替の描画後にセクションへスクロールする
    window.setTimeout(() => {
      document.getElementById(MEMO_IMPORT_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  async function handleSignOut() {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    await sb.auth.signOut();
    window.location.href = '/welcome';
  }

  const ollamaOk = testResult?.ok ?? false;
  const modelLabel = useMemo(
    () => OLLAMA_MODELS.find((m) => m.value === ollama.model)?.value ?? ollama.model,
    [ollama.model],
  );

  return (
    <div className="fixed inset-0 z-40 hidden overflow-hidden bg-[#F7F8FC] lg:flex">
      {/* ── 左サイドバー（共通） ── */}
      <DesktopSidebar active="settings" bottom={
        <>
          <div className="rounded-2xl border border-[#E8EAF3] bg-[#FBFBFE] p-3">
            <p className="mb-2 text-[11px] font-bold" style={{ color: MUTED }}>AI・音声ステータス</p>
            <StatusLine label="Ollama接続" ok={local && ollamaOk} okText="接続OK" ngText={local ? '未接続' : 'ローカル専用'} />
            <p className="ml-3.5 mt-0.5 text-[10px]" style={{ color: MUTED }}>モデル: {modelLabel}</p>
            <div className="my-2 h-px bg-[#EEF0F5]" />
            <StatusLine label="Whisper" ok={local} okText="使用可能" ngText="ローカル専用" />
          </div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: LAVENDER }}>
            <p className="text-[12px] font-bold" style={{ color: NAVY }}>今日も素晴らしい一日になりますように！</p>
            <p className="mt-1 text-[10px]" style={{ color: '#54607A' }}>小さな一歩が、大きな未来をつくります。</p>
          </div>
        </>
      } />

      {/* ── メイン ── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {/* タイトル */}
          <div className="mb-5">
            <h1 className="text-[22px] font-extrabold" style={{ color: NAVY }}>設定</h1>
            <p className="text-[12px]" style={{ color: MUTED }}>MyBrainをあなた好みにカスタマイズしましょう</p>
          </div>

          {/* タブ */}
          <div className="mb-5 flex items-center gap-1 rounded-2xl border border-[#E8EAF3] bg-white p-1.5">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-bold transition"
                  style={active ? { backgroundColor: LAVENDER, color: PURPLE } : { color: '#54607A' }}>
                  <span>{t.icon}</span>{t.label}
                </button>
              );
            })}
          </div>

          {/* ───── AI設定タブ ───── */}
          {tab === 'ai' && (
            <Card>
              <CardTitle title="AI・音声認識設定" sub="AIモデルと音声認識の設定を行います" />
              <div className="grid grid-cols-2 gap-6">
                {/* Ollama */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[14px] font-bold" style={{ color: NAVY }}>Ollama設定（ローカルAI）</h3>
                    <StatusBadge ok={local && ollamaOk} okText="接続OK" ngText={local ? '未接続' : 'ローカル専用'} />
                  </div>

                  {!local && (
                    <p className="rounded-xl border border-[#E8EAF3] bg-yellow-50 px-3 py-2 text-[11px] text-yellow-800">
                      この機能は <strong>PCローカル版専用</strong>です。公開環境では Ollama に接続できません。
                    </p>
                  )}

                  {/* 有効化トグル（enabled は AIアシスト・/consult の利用可否判定に使われる） */}
                  <ToggleRow
                    label="Ollama（ローカルAI）"
                    sub={ollama.enabled ? 'ローカルAIを使用する' : 'ローカルAIを使用しない'}
                    on={ollama.enabled}
                    onChange={(v) => updateOllama({ enabled: v })}
                  />

                  <Field label="Ollamaホスト">
                    <input
                      type="text"
                      value={ollama.endpoint}
                      onChange={(e) => updateOllama({ endpoint: e.target.value })}
                      placeholder="http://localhost:11434"
                      className="w-full rounded-xl border border-[#E8EAF3] px-3 py-2.5 text-[13px] outline-none focus:border-[#7B61FF]"
                      style={{ color: '#1F2937' }}
                    />
                  </Field>

                  <Field label="使用モデル">
                    <div className="flex gap-2">
                      <select
                        value={ollama.model}
                        onChange={(e) => updateOllama({ model: e.target.value })}
                        className="flex-1 rounded-xl border border-[#E8EAF3] bg-white px-3 py-2.5 text-[13px] outline-none focus:border-[#7B61FF]"
                        style={{ color: '#1F2937' }}>
                        {OLLAMA_MODELS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => { setOllama(loadOllamaSettings()); showToast('モデル一覧を更新しました'); }}
                        className="shrink-0 rounded-xl border border-[#D9CEFF] px-3 text-[12px] font-bold"
                        style={{ color: PURPLE }}>
                        ↻ 更新
                      </button>
                    </div>
                  </Field>

                  <button
                    type="button"
                    onClick={() => runTest(ollama.endpoint)}
                    disabled={testing}
                    className="self-start rounded-xl border border-[#D9CEFF] px-4 py-2 text-[12px] font-bold disabled:opacity-50"
                    style={{ color: PURPLE }}>
                    {testing ? '接続テスト中…' : '✓ 接続テスト'}
                  </button>

                  {/* 接続情報 */}
                  <div className="rounded-xl border border-[#EEF0F5] bg-[#FBFBFE] p-3">
                    <p className="mb-2 text-[11px] font-bold" style={{ color: MUTED }}>接続情報</p>
                    <InfoRow label="ステータス" value={
                      <span style={{ color: ollamaOk ? '#1B8A4B' : '#A6AEC0' }}>● {ollamaOk ? '接続OK' : '未接続'}</span>
                    } />
                    <InfoRow label="応答速度" value={latency != null ? `${(latency / 1000).toFixed(1)} 秒` : '—'} />
                    <InfoRow label="最終確認" value={lastCheck ?? '—'} />
                  </div>

                  {testResult && (
                    <p className="rounded-xl px-3 py-2 text-[12px] font-semibold"
                      style={{ backgroundColor: testResult.ok ? '#E8F8EE' : '#FDECEC', color: testResult.ok ? '#1B8A4B' : '#C0392B' }}>
                      {testResult.ok ? '✅ ' : '⚠️ '}{testResult.message}
                    </p>
                  )}
                </div>

                {/* Whisper */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[14px] font-bold" style={{ color: NAVY }}>音声認識設定（Whisper）</h3>
                    <StatusBadge ok={local} okText="利用可能" ngText="ローカル専用" />
                  </div>

                  <Field label="Whisperモデル">
                    <select
                      value={app.whisperModel}
                      onChange={(e) => updateApp({ whisperModel: e.target.value as AppSettings['whisperModel'] })}
                      className="w-full rounded-xl border border-[#E8EAF3] bg-white px-3 py-2.5 text-[13px] outline-none focus:border-[#7B61FF]"
                      style={{ color: '#1F2937' }}>
                      <option value="small">Whisper Small（軽量）</option>
                      <option value="medium">Whisper Medium（標準）</option>
                      <option value="large">Whisper Large（高精度）</option>
                    </select>
                  </Field>

                  <Field label="言語">
                    <select
                      value={app.whisperLang}
                      onChange={(e) => updateApp({ whisperLang: e.target.value as AppSettings['whisperLang'] })}
                      className="w-full rounded-xl border border-[#E8EAF3] bg-white px-3 py-2.5 text-[13px] outline-none focus:border-[#7B61FF]"
                      style={{ color: '#1F2937' }}>
                      <option value="ja">日本語</option>
                      <option value="en">English</option>
                      <option value="auto">自動判定</option>
                    </select>
                  </Field>

                  <ToggleRow label="話者分離" on={app.diarization} onChange={(v) => updateApp({ diarization: v })} />
                  <ToggleRow label="句読点の自動付与" on={app.autoPunct} onChange={(v) => updateApp({ autoPunct: v })} />
                  <ToggleRow label="専門用語の最適化" on={app.termOptimize} onChange={(v) => updateApp({ termOptimize: v })} />

                  <div className="rounded-xl p-3" style={{ backgroundColor: LAVENDER }}>
                    <p className="text-[11px]" style={{ color: '#54607A' }}>
                      ⓘ Whisperはローカルで動作するため、インターネット接続は不要です。
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ───── アプリ設定タブ ───── */}
          {tab === 'app' && (
            <Card>
              <CardTitle title="アプリケーション設定" sub="表示・動作をお好みに合わせて調整します" />
              <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                {/* テーマ切替は未実装（設定値が画面に反映されない）ため、実装まで操作不可にする */}
                <SettingRow label="テーマ" sub="テーマ切替は現在準備中です。">
                  <Segmented
                    value={app.theme}
                    options={[{ v: 'light', t: 'ライト' }, { v: 'dark', t: 'ダーク' }]}
                    onChange={(v) => updateApp({ theme: v as AppSettings['theme'] })}
                    disabled
                  />
                </SettingRow>
                <ToggleRow label="自動保存" sub="メモや文字起こしを自動で保存します" on={app.autoSave} onChange={(v) => updateApp({ autoSave: v })} />

                <SettingRow label="表示フォントサイズ" sub="アプリ全体の文字サイズを調整します">
                  <SelectBox value={app.fontSize} onChange={(v) => updateApp({ fontSize: v as AppSettings['fontSize'] })}
                    options={[{ v: 'small', t: '小' }, { v: 'medium', t: '中（標準）' }, { v: 'large', t: '大' }]} />
                </SettingRow>
                <ToggleRow label="入力中の自動保存" sub="入力中の内容を定期的に保存します" on={app.autoSaveDraft} onChange={(v) => updateApp({ autoSaveDraft: v })} />

                <SettingRow label="1日の開始時間" sub="予定の表示を開始する時間を設定します">
                  <SelectBox value={app.dayStart} onChange={(v) => updateApp({ dayStart: v })}
                    options={['00:00', '05:00', '06:00', '07:00', '08:00', '09:00'].map((t) => ({ v: t, t }))} />
                </SettingRow>
                <ToggleRow label="画像の自動圧縮" sub="アップロードする画像を自動で圧縮します" on={app.autoCompressImage} onChange={(v) => updateApp({ autoCompressImage: v })} />

                <SettingRow label="週の開始曜日" sub="カレンダーの週の開始曜日を設定します">
                  <SelectBox value={app.weekStart} onChange={(v) => updateApp({ weekStart: v as AppSettings['weekStart'] })}
                    options={[{ v: 'mon', t: '月曜日' }, { v: 'sun', t: '日曜日' }]} />
                </SettingRow>
                <SettingRow label="起動時のホーム画面" sub="アプリ起動時に表示する画面を設定します">
                  <SelectBox value={app.startScreen} onChange={(v) => updateApp({ startScreen: v as AppSettings['startScreen'] })}
                    options={[{ v: 'home', t: 'ホーム' }, { v: 'memos', t: 'メモ' }, { v: 'reservations', t: '予定' }]} />
                </SettingRow>

                <SettingRow label="AIの回答の長さ" sub="AIの回答の詳細さを設定します">
                  <SelectBox value={app.aiLength} onChange={(v) => updateApp({ aiLength: v as AppSettings['aiLength'] })}
                    options={[{ v: 'short', t: '簡潔' }, { v: 'normal', t: '標準' }, { v: 'long', t: '詳細' }]} />
                </SettingRow>
                <SettingRow label="データのバックアップ頻度" sub="自動バックアップの頻度を設定します">
                  <SelectBox value={app.backupFreq} onChange={(v) => updateApp({ backupFreq: v as AppSettings['backupFreq'] })}
                    options={[{ v: 'daily', t: '毎日' }, { v: 'weekly', t: '毎週' }, { v: 'monthly', t: '毎月' }, { v: 'off', t: 'オフ' }]} />
                </SettingRow>
              </div>
            </Card>
          )}

          {/* ───── 通知設定タブ ───── */}
          {tab === 'notify' && (
            <Card>
              <CardTitle title="通知設定" sub="通知の受け取り方を設定します" />
              <div className="flex flex-col gap-4">
                <ToggleRow label="予定のリマインダー" sub="予定の前に通知します" on={app.autoPunct} onChange={(v) => updateApp({ autoPunct: v })} />
                <ToggleRow label="AI処理の完了通知" sub="要約・整理が完了したら通知します" on={app.termOptimize} onChange={(v) => updateApp({ termOptimize: v })} />
                <p className="text-[12px]" style={{ color: MUTED }}>※ 通知設定はこの端末のみに保存されます。</p>
              </div>
            </Card>
          )}

          {/* ───── データ管理タブ ───── */}
          {tab === 'data' && (
            <Card>
              <CardTitle title="データ管理" sub="保存データの確認・エクスポート・取り込み" />
              <div className="flex flex-col gap-3">
                <InfoRow label="保存済みメモ数" value={memoCount != null ? `${memoCount} 件` : '—'} />
                <p className="text-[12px]" style={{ color: MUTED }}>
                  メモはすべてMyBrain（あなたのアカウント）に保存されます。Obsidian保存は付加的で、MyBrainが主です。エクスポート機能は右側パネルから利用できます。
                </p>
              </div>

              {/* メモの保存先（選択の保存・表示。MyBrainには常に保存され、Obsidian保存は付加的） */}
              <div className="mt-6">
                <h3 className="text-[14px] font-extrabold" style={{ color: NAVY }}>メモの保存先</h3>
                <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
                  MyBrainを主として、Obsidian用Markdownの保存先を選べます。
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {([
                    { value: 'mybrain', label: 'MyBrain保存', desc: '通常はこちら。MyBrainにメモを保存します。' },
                    { value: 'obsidian-local', label: 'Obsidian local', desc: 'MyBrainに保存しながら、対応ブラウザでVaultフォルダにMarkdownを保存します。' },
                    { value: 'obsidian-gdrive', label: 'Google Drive連携', desc: 'MyBrainに保存しながら、保存後に表示されるボタンからGoogle DriveへMarkdownを書き出せます。' },
                  ] as const).map((opt) => {
                    const selected = memoStorageTarget === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => selectMemoStorageTarget(opt.value)}
                        aria-pressed={selected}
                        className="flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition"
                        style={
                          selected
                            ? { borderColor: PURPLE, background: LAVENDER }
                            : { borderColor: '#E8EAF3', background: '#FBFBFE' }
                        }>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-[13px] font-bold" style={{ color: NAVY }}>{opt.label}</span>
                          <span className="text-[11px] leading-snug" style={{ color: MUTED }}>{opt.desc}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                          {selected && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: PURPLE, color: '#ffffff' }}>選択中</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-[11px] font-semibold" style={{ color: NAVY }}>
                  現在は安全のため、すべてMyBrainにも保存されます。
                </p>
                <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
                  Obsidian localを選ぶと、対応ブラウザでVaultフォルダへMarkdown保存できます。
                </p>
                <ul className="mt-1.5 flex flex-col gap-1 text-[11px] leading-relaxed" style={{ color: MUTED }}>
                  <li>・メモの本体（正本）はいつもMyBrainにあります。Google DriveのMarkdownは、書き出したコピー・参考用です。</li>
                  <li>・Google Driveのファイルは、MyBrainに取り込まれません（インポート・双方向同期はありません）。書き出しはMyBrain→Google Driveの一方向だけです。</li>
                  <li>・書き出したMarkdownは一覧・プレビューで読み返せます。「参照に追加」すると検索やAI相談の参考にできます（この画面を開いている間だけ・再読み込みで消え、保存されません）。</li>
                  <li>・AI相談で参考にするのは、あなたがその場で読み込んだ参照メモだけです。</li>
                </ul>
                <div className="mt-2">
                  <p className="text-[11px] font-bold" style={{ color: NAVY }}>Obsidian内の保存場所</p>
                  <p className="mt-0.5 text-[11px] break-all" style={{ color: MUTED, fontFamily: 'Consolas, Meiryo, monospace' }}>{OBSIDIAN_MEMO_FOLDER}</p>
                </div>

                {/* Obsidian Vaultフォルダの接続（obsidian-local 選択時のみ表示。選択・再接続・解除だけを行う） */}
                {memoStorageTarget === 'obsidian-local' && (
                  <div className="mt-4 rounded-2xl border px-4 py-3" style={{ borderColor: '#E8EAF3', background: '#FBFBFE' }}>
                    <p className="text-[12px] font-bold" style={{ color: NAVY }}>Obsidian Vaultフォルダ</p>
                    <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                      {vaultHandleName ? `接続中：${vaultHandleName}` : 'Vaultフォルダが未設定です'}
                    </p>
                    {!vaultDirSupported && (
                      <p className="mt-1 text-[11px]" style={{ color: '#9A7B27' }}>
                        このブラウザではVaultフォルダ保存に対応していません
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={connectVaultFolder}
                        disabled={!vaultDirSupported}
                        className="rounded-xl px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50"
                        style={{ background: PURPLE }}>
                        Obsidianフォルダを接続
                      </button>
                      <button
                        type="button"
                        onClick={reconnectVaultFolder}
                        disabled={!vaultDirSupported}
                        className="rounded-xl border px-3 py-2 text-[12px] font-bold disabled:opacity-50"
                        style={{ borderColor: '#E8EAF3', color: NAVY }}>
                        再接続
                      </button>
                      {vaultHandleName && (
                        <button
                          type="button"
                          onClick={disconnectVaultFolder}
                          className="rounded-xl border px-3 py-2 text-[12px] font-bold"
                          style={{ borderColor: '#F3D2D2', color: '#C0392B' }}>
                          接続を解除
                        </button>
                      )}
                    </div>
                    {vaultStatus && (
                      <p className="mt-2 text-[11px] font-semibold" style={{ color: NAVY }}>{vaultStatus}</p>
                    )}
                    <p className="mt-2 text-[11px]" style={{ color: MUTED }}>
                      「Vaultフォルダを選択」を押したときだけフォルダにアクセスします。
                    </p>
                  </div>
                )}
              </div>

              {/* メモの取り込み（インポート）プレビュー（IMP2a・確認のみ・保存は次ステップ） */}
              <MemoImportPanel />
            </Card>
          )}

          {/* ───── アカウントタブ ───── */}
          {tab === 'account' && (
            <Card>
              <CardTitle title="アカウント" sub="ログイン情報の確認" />
              <div className="flex flex-col gap-3">
                <InfoRow label="ログイン中" value={email ?? '未ログイン'} />
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="self-start rounded-xl border border-[#F3D2D2] px-4 py-2.5 text-[13px] font-bold text-red-600">
                  ログアウト
                </button>
              </div>
            </Card>
          )}
        </div>

        {/* ── 右カラム ── */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-[#E8EAF3] bg-[#FBFBFE] px-5 py-6">
          {/* AI・音声ステータス */}
          <SideCard title="AI・音声ステータス">
            <div className="rounded-xl border p-3"
              style={{ backgroundColor: local && ollamaOk ? '#E8F8EE' : '#FBFBFE', borderColor: local && ollamaOk ? '#BCEBCD' : '#E8EAF3' }}>
              <p className="text-[12px] font-bold" style={{ color: local && ollamaOk ? '#1B8A4B' : '#54607A' }}>
                {local && ollamaOk ? '✅ すべて正常に動作しています' : 'ℹ️ 接続を確認してください'}
              </p>
              {lastCheck && <p className="mt-0.5 text-[10px]" style={{ color: MUTED }}>最終確認: {lastCheck}</p>}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <SideStat label="Ollama接続" ok={local && ollamaOk} okText="接続OK" ngText={local ? '未接続' : 'ローカル専用'} />
              <SideStat label="使用モデル" value={modelLabel} />
              <SideStat label="Whisper" ok={local} okText="利用可能" ngText="ローカル専用" />
              <SideStat label="音声認識" ok={local} okText="正常" ngText="ローカル専用" />
            </div>
            <button
              type="button"
              onClick={() => runTest(ollama.endpoint)}
              disabled={testing}
              className="mt-3 w-full rounded-xl border border-[#E8EAF3] bg-white py-2 text-[12px] font-bold disabled:opacity-50"
              style={{ color: '#54607A' }}>
              {testing ? '確認中…' : '↻ 再チェック'}
            </button>
          </SideCard>

          {/* データ使用量 */}
          <SideCard title="データ使用量">
            <p className="-mt-1 mb-3 text-[11px]" style={{ color: MUTED }}>メモ・文字起こし・画像ファイルの保存容量</p>
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 shrink-0 rounded-full" style={{ background: '#EEF0F5' }}>
                <span className="absolute inset-[6px] flex items-center justify-center rounded-full bg-white text-[10px] font-bold" style={{ color: MUTED }}>準備中</span>
              </div>
              <div>
                <p className="text-[13px] font-extrabold" style={{ color: NAVY }}>容量管理は今後対応</p>
                <p className="text-[11px]" style={{ color: MUTED }}>実使用量の計算は準備中です</p>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              <SideStat label="メモ" value="準備中" />
              <SideStat label="文字起こし" value="準備中" />
              <SideStat label="画像・ファイル" value="準備中" />
              <SideStat label="その他" value="準備中" />
            </div>
            <button
              type="button"
              onClick={() => setTab('data')}
              className="mt-3 w-full rounded-xl border border-[#E8EAF3] bg-white py-2 text-[12px] font-bold"
              style={{ color: '#54607A' }}>
              🗄 データ管理に進む
            </button>
          </SideCard>

          {/* アカウント・その他 */}
          <SideCard title="アカウント・その他">
            <div className="flex flex-col">
              <AccountRow label="🔒 パスワードを変更" onClick={() => showToast('この端末では未対応です')} />
              <AccountRow label="⬆ エクスポート（データ出力）" onClick={() => showToast('準備中です')} />
              <AccountRow label="⬇ インポート（データ取込）" onClick={openMemoImportSection} />
              <button
                type="button"
                onClick={handleSignOut}
                className="flex items-center justify-between py-2.5 text-[13px] font-bold text-red-600">
                <span>⏻ ログアウト</span><span>→</span>
              </button>
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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-[#E8EAF3] bg-white p-6 shadow-[0_10px_28px_rgba(31,53,104,0.05)]">
      {children}
    </section>
  );
}

function CardTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[16px] font-extrabold" style={{ color: NAVY }}>{title}</h2>
      <p className="text-[12px]" style={{ color: MUTED }}>{sub}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold" style={{ color: MUTED }}>{label}</span>
      {children}
    </label>
  );
}

function SettingRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-bold" style={{ color: '#1F2937' }}>{label}</p>
        {sub && <p className="text-[11px]" style={{ color: MUTED }}>{sub}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleRow({ label, sub, on, onChange }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-bold" style={{ color: '#1F2937' }}>{label}</p>
        {sub && <p className="text-[11px]" style={{ color: MUTED }}>{sub}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        aria-pressed={on}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: on ? PURPLE : '#D7DBE6' }}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? '22px' : '2px' }} />
      </button>
    </div>
  );
}

function Segmented({ value, options, onChange, disabled = false }: { value: string; options: { v: string; t: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="flex overflow-hidden rounded-xl border border-[#E8EAF3]" style={disabled ? { opacity: 0.5 } : undefined}>
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button key={o.v} type="button" disabled={disabled} onClick={() => onChange(o.v)} className="px-4 py-1.5 text-[12px] font-bold transition disabled:cursor-not-allowed"
            style={active ? { backgroundColor: LAVENDER, color: PURPLE } : { backgroundColor: '#fff', color: '#A6AEC0' }}>
            {o.t}
          </button>
        );
      })}
    </div>
  );
}

function SelectBox({ value, options, onChange }: { value: string; options: { v: string; t: string }[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-[#E8EAF3] bg-white px-3 py-2 text-[12px] font-semibold outline-none focus:border-[#7B61FF]"
      style={{ color: '#1F2937' }}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
    </select>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px]" style={{ color: MUTED }}>{label}</span>
      <span className="text-[11px] font-bold" style={{ color: '#1F2937' }}>{value}</span>
    </div>
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

function StatusBadge({ ok, okText, ngText }: { ok: boolean; okText: string; ngText: string }) {
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
      style={{ backgroundColor: ok ? '#E8F8EE' : '#F1F2F7', color: ok ? '#1B8A4B' : '#A6AEC0' }}>
      {ok ? okText : ngText}
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

function SideStat({ label, value, ok, okText, ngText }: { label: string; value?: string; ok?: boolean; okText?: string; ngText?: string }) {
  const right = value != null
    ? <span className="text-[11px] font-bold" style={{ color: '#1F2937' }}>{value}</span>
    : <span className="text-[11px] font-bold" style={{ color: ok ? '#1B8A4B' : '#A6AEC0' }}>{ok ? okText : ngText}</span>;
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px]" style={{ color: '#54607A' }}>{label}</span>
      {right}
    </div>
  );
}

function AccountRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center justify-between border-b border-[#F1F2F7] py-2.5 text-[13px] font-semibold last:border-0"
      style={{ color: '#54607A' }}>
      <span>{label}</span><span style={{ color: '#A6AEC0' }}>→</span>
    </button>
  );
}
