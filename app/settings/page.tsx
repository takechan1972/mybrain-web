'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, HomeIcon } from '@/components/icons';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import {
  DEFAULT_OLLAMA_SETTINGS,
  OLLAMA_MODELS,
  loadOllamaSettings,
  saveOllamaSettings,
  testOllama,
  type OllamaSettings,
} from '@/lib/ai/ollama';
import { isLocalHost } from '@/lib/env';
import DesktopSettings from '@/components/DesktopSettings';

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const LAVENDER = '#EEF0FF';

function LogoutIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function SettingsPage() {
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState<string | null>(null);

  // Ollama（ローカルAI）設定
  const [ollama, setOllama] = useState<OllamaSettings>(DEFAULT_OLLAMA_SETTINGS);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [local, setLocal] = useState(false);

  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    sb?.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    setOllama(loadOllamaSettings());
    setLocal(isLocalHost());
  }, []);

  function updateOllama(patch: Partial<OllamaSettings>) {
    setOllama((prev) => {
      const next = { ...prev, ...patch };
      saveOllamaSettings(next);
      return next;
    });
    setTestResult(null);
  }

  async function handleTestOllama() {
    setTesting(true);
    setTestResult(null);
    const r = await testOllama(ollama.endpoint);
    setTestResult({ ok: r.ok, message: r.message });
    setTesting(false);
  }

  async function handleSignOut() {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    await sb.auth.signOut();
    window.location.href = '/welcome';
  }

  const loggedIn = Boolean(email);
  const initial = email ? email.trim().charAt(0).toUpperCase() : 'G';

  return (
    <>
    <DesktopSettings />
    <div className="flex flex-col gap-5 lg:hidden" style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
      {/* ヘッダー */}
      <header className="flex items-center justify-between">
        <Link
          href="/"
          aria-label="戻る"
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full"
          style={{ color: NAVY }}>
          <ChevronLeftIcon size={22} />
        </Link>
        <h1 className="text-[18px] font-bold" style={{ color: NAVY }}>
          設定
        </h1>
        <span className="h-9 w-9" />
      </header>

      {/* アカウントカード */}
      <section className="flex items-center gap-4 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[22px] font-extrabold"
          style={{ backgroundColor: LAVENDER, color: NAVY }}>
          {initial}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[12px] font-semibold" style={{ color: MUTED }}>
            ログイン中
          </span>
          <span className="truncate text-[15px] font-bold" style={{ color: loggedIn ? '#1F2937' : MUTED }}>
            {email ?? '未ログイン'}
          </span>
        </div>
      </section>

      {/* メニュー */}
      <section className="overflow-hidden rounded-3xl border border-[#E5E8F0] bg-white shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <Link
          href="/"
          className="flex min-h-[56px] items-center gap-3 px-5 py-4 active:opacity-60">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: LAVENDER, color: NAVY }}>
            <HomeIcon size={18} />
          </span>
          <span className="flex-1 text-[15px] font-semibold" style={{ color: '#1F2937' }}>
            ホームへ戻る
          </span>
          <span className="shrink-0" style={{ color: '#A6AEC0' }}>
            <ChevronRightIcon size={18} />
          </span>
        </Link>
      </section>

      {/* AI設定（Ollama・ローカル） */}
      <section className="flex flex-col gap-4 rounded-3xl border border-[#E5E8F0] bg-white p-5 shadow-[0_10px_28px_rgba(31,53,104,0.07)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold" style={{ color: NAVY }}>
            AI設定（Ollama）
          </h2>
          {/* 有効化トグル */}
          <button
            type="button"
            onClick={() => updateOllama({ enabled: !ollama.enabled })}
            aria-pressed={ollama.enabled}
            className="relative h-7 w-12 rounded-full transition-colors"
            style={{ backgroundColor: ollama.enabled ? '#7B61FF' : '#D7DBE6' }}>
            <span
              className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all"
              style={{ left: ollama.enabled ? '22px' : '2px' }}
            />
          </button>
        </div>
        <p className="text-[12px]" style={{ color: MUTED }}>
          このPC上の Ollama を使って AI相談・要約・メモ整理を行います。APIキーは不要です。ローカル利用のみ（外部公開なし）。
        </p>

        {!local ? (
          <p className="rounded-2xl border border-[#E5E8F0] bg-yellow-50 p-4 text-[13px] text-yellow-800">
            この機能は <strong>PCローカル版専用</strong>です。公開（Vercel）環境では Ollama に接続できないため利用できません。お使いのPCでローカル起動するとここで設定できます。
          </p>
        ) : (
          <>
        {/* エンドポイント */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold" style={{ color: MUTED }}>エンドポイント</span>
          <input
            type="text"
            value={ollama.endpoint}
            onChange={(e) => updateOllama({ endpoint: e.target.value })}
            placeholder="http://localhost:11434"
            className="rounded-2xl border border-[#E5E8F0] bg-white px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]"
            style={{ color: '#1F2937' }}
          />
        </label>

        {/* モデル選択 */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold" style={{ color: MUTED }}>モデル</span>
          <select
            value={ollama.model}
            onChange={(e) => updateOllama({ model: e.target.value })}
            className="rounded-2xl border border-[#E5E8F0] bg-white px-4 py-3 text-[14px] outline-none focus:border-[#7B61FF]"
            style={{ color: '#1F2937' }}>
            {OLLAMA_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>

        {/* 接続テスト */}
        <button
          type="button"
          onClick={handleTestOllama}
          disabled={testing}
          className="flex min-h-[48px] items-center justify-center rounded-2xl text-[14px] font-bold text-white transition active:opacity-70 disabled:opacity-50"
          style={{ backgroundColor: '#7B61FF' }}>
          {testing ? '接続テスト中…' : '接続テスト'}
        </button>

        {testResult && (
          <p
            className="rounded-2xl px-4 py-3 text-[13px] font-semibold"
            style={{
              backgroundColor: testResult.ok ? '#E8F8EE' : '#FDECEC',
              color: testResult.ok ? '#1B8A4B' : '#C0392B',
            }}>
            {testResult.ok ? '✅ ' : '⚠️ '}{testResult.message}
          </p>
        )}
          </>
        )}
      </section>

      {/* ログアウト */}
      {configured && loggedIn && (
        <button
          type="button"
          onClick={handleSignOut}
          className="flex min-h-[52px] items-center justify-center gap-2 rounded-3xl border border-[#F3D2D2] bg-white text-[15px] font-bold text-red-600 shadow-[0_10px_28px_rgba(31,53,104,0.07)] active:opacity-60">
          <LogoutIcon size={18} />
          ログアウト
        </button>
      )}

      {!configured && (
        <p className="rounded-2xl border border-[#E5E8F0] bg-yellow-50 p-4 text-[13px] text-yellow-800">
          Supabase が未設定のため、アカウント情報は表示されません。
        </p>
      )}
    </div>
    </>
  );
}
