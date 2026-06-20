'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
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
import {
  DEFAULT_ACCOUNT_SETTINGS,
  loadAccountSettings,
  planLabel as planLabelOf,
  saveAccountSettings,
  type AccountSettings,
} from '@/lib/account-store';
import DesktopSettings from '@/components/DesktopSettings';

// サンプルログイン（デモ用アカウント）の判定。
// 専用の課金/アカウント基盤が未実装のため、メールアドレスで暫定判定する。
// 実データ接続時はここを差し替えるだけでよい（戻り値が true のとき編集系UIを無効化する）。
const SAMPLE_EMAILS = new Set([
  'sample@mybrain.app',
  'demo@mybrain.app',
  'guest@mybrain.app',
  'sample@example.com',
  'demo@example.com',
  'test@example.com',
]);
function isSampleUser(email: string | null): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (SAMPLE_EMAILS.has(e)) return true;
  // example.com ドメイン、または sample / demo で始まるローカル部はサンプル扱い
  return e.endsWith('@example.com') || e.startsWith('sample') || e.startsWith('demo');
}

// ホーム／ログインと統一したガラスカード（ダーク・ネオン・グラス）
const GLASS_CARD: React.CSSProperties = {
  background: 'rgba(10,14,35,0.6)',
  border: '1px solid rgba(120,160,255,0.25)',
  boxShadow: '0 0 18px rgba(99,102,241,0.12), 0 10px 28px rgba(0,0,0,0.35)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
};

function LogoutIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

type SheetKey =
  | 'billing'
  | 'plugin'
  | 'contact'
  | 'privacy'
  | 'company'
  | 'logout';

export default function SettingsPage() {
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState<string | null>(null);

  // アカウント情報（氏名・電話番号・利用プラン）の端末ローカル保存
  const [account, setAccount] = useState<AccountSettings>(DEFAULT_ACCOUNT_SETTINGS);

  // パスワード変更（入力UIのみ。認証ストアの実際の現在パスワードは取得・表示しない）
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Ollama（ローカルAI）設定
  const [ollama, setOllama] = useState<OllamaSettings>(DEFAULT_OLLAMA_SETTINGS);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [local, setLocal] = useState(false);
  // カテゴリ設定トップ：開いているボトムシート／AI設定・アカウント情報の展開状態
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  // アカウント情報は既定で折りたたみ
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    sb?.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
    setAccount(loadAccountSettings());
    setOllama(loadOllamaSettings());
    setLocal(isLocalHost());
  }, []);

  // アカウント情報（氏名・電話番号・プラン）をローカル保存（既存の設定保存パターンと同一）
  function updateAccount(patch: Partial<AccountSettings>) {
    setAccount((prev) => {
      const next = { ...prev, ...patch };
      saveAccountSettings(next);
      return next;
    });
  }

  // パスワード変更（Supabase Auth）。サンプルユーザー・未ログイン時は実行しない。
  // 入力された新パスワードのみを更新に使う（既存の現在パスワードは読み取らない）。
  async function handleChangePassword() {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    if (isSample) {
      setPwMsg({ ok: false, text: 'サンプルログインのため変更できません。' });
      return;
    }
    if (newPassword.length < 6) {
      setPwMsg({ ok: false, text: 'パスワードは6文字以上で入力してください。' });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    const { error } = await sb.auth.updateUser({ password: newPassword });
    setPwBusy(false);
    if (error) {
      setPwMsg({ ok: false, text: `変更に失敗しました：${error.message}` });
      return;
    }
    setNewPassword('');
    setShowPassword(false);
    setPwMsg({ ok: true, text: 'パスワードを変更しました。' });
  }

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

  // プラン状態（ユーザーは設定画面から変更不可。将来はシステム/決済側で管理する想定の暫定ローカル値）
  const plan = account.plan;
  const planLabel = planLabelOf(plan);
  // 有料プラン（Standard / Premium）のときだけ「AI設定」を表示する
  const isPaid = plan === 'standard' || plan === 'premium';
  const isSample = isSampleUser(email);
  const editDisabled = isSample || !loggedIn;

  // ストレージ使用量（表示専用・暫定モック。実計測は未実装）
  // プラン別の上限：無料 1GB / スタンダード 10GB / プレミアム 50GB
  const storageLimitGb = plan === 'premium' ? 50 : plan === 'standard' ? 10 : 1;
  const storageUsedGb = 0.2; // 仮の使用量（実データ接続前のモック値）
  const storagePct = Math.min(100, Math.round((storageUsedGb / storageLimitGb) * 100));
  // しきい値：〜69%=通常 / 70〜89%=注意 / 90%〜=警告
  const storageLevel: 'normal' | 'caution' | 'warning' =
    storagePct >= 90 ? 'warning' : storagePct >= 70 ? 'caution' : 'normal';
  const storageColor =
    storageLevel === 'warning' ? '#ff6b6b' : storageLevel === 'caution' ? '#F2C14E' : '#22E5A8';
  const storageNote =
    storageLevel === 'warning'
      ? '空き容量がわずかです。プランの見直しをご検討ください。'
      : storageLevel === 'caution'
      ? '使用量が増えています。'
      : '十分な空き容量があります。';

  return (
    <>
    <DesktopSettings />
    {/* ── スマホ（lg未満）：宇宙背景・ネオン／グラスUI（ホーム・ログインと統一） ── */}
    <div className="relative lg:hidden">
      {/* 宇宙背景（haikei.png）＋暗オーバーレイ */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen lg:hidden"
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
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen lg:hidden"
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,7,22,0.30) 0%, rgba(5,7,22,0.55) 45%, rgba(5,7,22,0.92) 100%)',
        }}
      />

      {/* 下部余白は MainShell（設定は safe-area + 控えめ）が付与するため重複させない */}
      <div className="relative z-10 flex flex-col gap-4">
        {/* ヘッダー */}
        <header className="flex items-center justify-between pt-1">
          <Link
            href="/"
            aria-label="ホームへ戻る"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full active:scale-95"
            style={{ color: '#9cc4ff' }}>
            <ChevronLeftIcon size={22} />
          </Link>
          <h1 className="text-[18px] font-bold" style={{ color: '#ffffff', textShadow: '0 0 12px rgba(99,102,241,0.4)' }}>
            設定
          </h1>
          <span className="h-9 w-9" />
        </header>

        {/* アカウントサマリーカード */}
        <section className="flex items-center gap-4 rounded-3xl p-5" style={GLASS_CARD}>
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[22px] font-extrabold"
            style={{
              background: 'rgba(99,102,241,0.22)',
              color: '#c7d2fe',
              border: '1px solid rgba(129,140,248,0.45)',
              boxShadow: '0 0 16px rgba(129,140,248,0.3)',
            }}>
            {initial}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#9fb0e0' }}>
              {loggedIn ? `ログイン中・${planLabel}` : '未ログイン'}
              {isSample && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: 'rgba(242,213,138,0.18)', color: '#f2d58a', border: '1px solid rgba(242,213,138,0.4)' }}>
                  サンプル
                </span>
              )}
            </span>
            <span className="truncate text-[15px] font-bold" style={{ color: loggedIn ? '#ffffff' : '#9fb0e0' }}>
              {email ?? '未ログイン'}
            </span>
          </div>
        </section>

        {/* アカウント情報（重複セクションは廃止し、ここに一本化・既定で折りたたみ） */}
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            aria-expanded={accountOpen}
            className="flex w-full min-h-[56px] items-center gap-3 px-5 py-4 text-left active:opacity-70">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px]" style={{ backgroundColor: 'rgba(99,102,241,0.16)' }}>
              👤
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-[15px] font-semibold" style={{ color: '#e6edff' }}>アカウント情報</span>
              <span className="text-[12px]" style={{ color: '#9fb0e0' }}>
                メール（ID）・氏名・電話番号・パスワード{isSample ? '（編集不可）' : ''}
              </span>
            </span>
            <span className="shrink-0 transition-transform" style={{ color: '#9aa6e0', transform: accountOpen ? 'rotate(90deg)' : 'none' }}>
              <ChevronRightIcon size={18} />
            </span>
          </button>

          {accountOpen && (
          <div className="flex flex-col gap-3.5 px-5 pb-5 pt-1" style={{ borderTop: '1px solid rgba(120,160,255,0.12)' }}>
            {/* メールアドレス（ログインID・表示のみ） */}
            <InfoRow label="メールアドレス（ID）">
              <span
                className="block truncate text-right text-[13px] font-semibold"
                style={{ color: loggedIn ? '#e6edff' : '#7a86b8' }}>
                {email ?? '未ログイン'}
              </span>
            </InfoRow>

            {/* 氏名（編集系：サンプル/未ログインは無効・灰色） */}
            <AccountField label="氏名">
              <input
                type="text"
                value={account.name}
                disabled={editDisabled}
                onChange={(e) => updateAccount({ name: e.target.value })}
                placeholder={editDisabled ? '—' : '例）山田 太郎'}
                className="min-h-[44px] w-full rounded-2xl px-4 py-2.5 text-[14px] outline-none placeholder:text-[#7d89bd] disabled:cursor-not-allowed"
                style={{
                  background: editDisabled ? 'rgba(40,44,60,0.5)' : 'rgba(10,14,32,0.5)',
                  border: '1px solid rgba(130,165,255,0.4)',
                  color: editDisabled ? '#7a86b8' : '#ffffff',
                  caretColor: '#818cf8',
                }}
              />
            </AccountField>

            {/* 電話番号（編集系） */}
            <AccountField label="電話番号">
              <input
                type="tel"
                inputMode="tel"
                value={account.phone}
                disabled={editDisabled}
                onChange={(e) => updateAccount({ phone: e.target.value })}
                placeholder={editDisabled ? '—' : '例）090-1234-5678'}
                className="min-h-[44px] w-full rounded-2xl px-4 py-2.5 text-[14px] outline-none placeholder:text-[#7d89bd] disabled:cursor-not-allowed"
                style={{
                  background: editDisabled ? 'rgba(40,44,60,0.5)' : 'rgba(10,14,32,0.5)',
                  border: '1px solid rgba(130,165,255,0.4)',
                  color: editDisabled ? '#7a86b8' : '#ffffff',
                  caretColor: '#818cf8',
                }}
              />
            </AccountField>

            {/* パスワード（入力UIのみ・既定は ******** マスク。表示/非表示で入力値を切替表示） */}
            <AccountField label="パスワード" last>
              <div className="flex items-center gap-2">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  disabled={editDisabled}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="********"
                  autoComplete="new-password"
                  className="min-h-[44px] w-full flex-1 rounded-2xl px-4 py-2.5 text-[14px] outline-none placeholder:text-[#7d89bd] disabled:cursor-not-allowed"
                  style={{
                    background: editDisabled ? 'rgba(40,44,60,0.5)' : 'rgba(10,14,32,0.5)',
                    border: '1px solid rgba(130,165,255,0.4)',
                    color: editDisabled ? '#7a86b8' : '#ffffff',
                    caretColor: '#818cf8',
                    letterSpacing: showPassword ? 'normal' : '0.12em',
                  }}
                />
                <button
                  type="button"
                  disabled={editDisabled}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  className="min-h-[44px] shrink-0 rounded-2xl px-3 text-[12px] font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    background: 'rgba(99,102,241,0.16)',
                    border: '1px solid rgba(130,165,255,0.4)',
                    color: '#c7d2fe',
                  }}>
                  {showPassword ? '非表示' : '表示'}
                </button>
              </div>

              {pwMsg && (
                <p
                  className="mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold"
                  style={
                    pwMsg.ok
                      ? { background: 'rgba(34,229,168,0.15)', color: '#86efac', border: '1px solid rgba(34,229,168,0.35)' }
                      : { background: 'rgba(224,85,85,0.15)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.35)' }
                  }>
                  {pwMsg.ok ? '✅ ' : '⚠️ '}{pwMsg.text}
                </p>
              )}

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px]" style={{ color: '#7a86b8' }}>
                  {editDisabled ? 'サンプルログインのため変更できません' : '新しいパスワード（6文字以上）'}
                </span>
                <button
                  type="button"
                  onClick={handleChangePassword}
                  disabled={editDisabled || pwBusy || newPassword.length === 0}
                  className="min-h-[40px] shrink-0 rounded-full px-4 text-[13px] font-bold text-white transition active:scale-95 disabled:opacity-45"
                  style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 18px rgba(60,120,255,0.35)' }}>
                  {pwBusy ? '変更中…' : '変更する'}
                </button>
              </div>
            </AccountField>
          </div>
          )}
        </section>

        {/* 契約・お支払い（プラン状態はシステム/決済側で管理。ここでは選択UIを持たない） */}
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          <SettingRow emoji="💳" title="契約・お支払い" desc="基本料金・支払い方法" onClick={() => setSheet('billing')} />
        </section>

        {/* AI設定（有料プラン＝Standard / Premium のときのみ表示。無料プランでは非表示） */}
        {isPaid && (
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          {/* AI設定（展開式・既存の Ollama 設定をそのまま内包） */}
          <button
            type="button"
            onClick={() => setAiOpen((v) => !v)}
            aria-expanded={aiOpen}
            className="flex w-full min-h-[56px] items-center gap-3 px-5 py-4 text-left active:opacity-70">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px]" style={{ backgroundColor: 'rgba(166,107,255,0.18)' }}>
              🤖
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-[15px] font-semibold" style={{ color: '#e6edff' }}>AI設定</span>
              <span className="text-[12px]" style={{ color: '#9fb0e0' }}>AIアシスト・Ollama（ローカルAI）</span>
            </span>
            <span className="shrink-0 transition-transform" style={{ color: '#c4b5fd', transform: aiOpen ? 'rotate(90deg)' : 'none' }}>
              <ChevronRightIcon size={18} />
            </span>
          </button>

          {aiOpen && (
            <div className="flex flex-col gap-4 px-5 pb-5 pt-1" style={{ borderTop: '1px solid rgba(120,160,255,0.12)' }}>
              {/* AIアシスト管理 → /ai-assist（既存ページ・導線を維持） */}
              <Link
                href="/ai-assist"
                className="flex min-h-[48px] items-center gap-3 rounded-2xl px-4 active:opacity-70"
                style={{ background: 'rgba(166,107,255,0.10)', border: '1px solid rgba(166,107,255,0.30)' }}>
                <span className="text-[16px]">🛠️</span>
                <span className="flex flex-1 flex-col py-2">
                  <span className="text-[14px] font-semibold" style={{ color: '#e6edff' }}>AIアシスト管理</span>
                  <span className="text-[11px]" style={{ color: '#9fb0e0' }}>参照する情報・応答スタイル・テンプレート</span>
                </span>
                <span className="shrink-0" style={{ color: '#c4b5fd' }}>
                  <ChevronRightIcon size={16} />
                </span>
              </Link>

              {/* Ollama 有効化トグル（ネオン） */}
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold" style={{ color: '#ffffff' }}>Ollama（ローカルAI）</span>
                <button
                  type="button"
                  onClick={() => updateOllama({ enabled: !ollama.enabled })}
                  aria-pressed={ollama.enabled}
                  className="relative h-7 w-12 rounded-full transition-colors"
                  style={{
                    backgroundColor: ollama.enabled ? '#7B61FF' : 'rgba(255,255,255,0.18)',
                    boxShadow: ollama.enabled ? '0 0 12px rgba(123,97,255,0.6)' : 'none',
                  }}>
                  <span
                    className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all"
                    style={{ left: ollama.enabled ? '22px' : '2px' }}
                  />
                </button>
              </div>
              <p className="text-[12px]" style={{ color: '#9fb0e0' }}>
                このPC上の Ollama を使って AIアシスト・要約・メモ整理を行います。APIキーは不要です。ローカル利用のみ（外部公開なし）。
              </p>

              {!local ? (
                <p
                  className="rounded-2xl p-4 text-[13px]"
                  style={{ border: '1px solid rgba(242,213,138,0.4)', background: 'rgba(242,213,138,0.10)', color: '#f2d58a' }}>
                  この機能は <strong>PCローカル版専用</strong>です。公開（Vercel）環境では Ollama に接続できないため利用できません。お使いのPCでローカル起動するとここで設定できます。
                </p>
              ) : (
                <>
                  {/* エンドポイント */}
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold" style={{ color: '#9fb0e0' }}>エンドポイント</span>
                    <input
                      type="text"
                      value={ollama.endpoint}
                      onChange={(e) => updateOllama({ endpoint: e.target.value })}
                      placeholder="http://localhost:11434"
                      className="rounded-2xl px-4 py-3 text-[14px] text-white outline-none placeholder:text-[#7d89bd]"
                      style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(130,165,255,0.4)', caretColor: '#818cf8' }}
                    />
                  </label>

                  {/* モデル選択 */}
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold" style={{ color: '#9fb0e0' }}>モデル</span>
                    <select
                      value={ollama.model}
                      onChange={(e) => updateOllama({ model: e.target.value })}
                      className="rounded-2xl px-4 py-3 text-[14px] text-white outline-none [color-scheme:dark]"
                      style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(130,165,255,0.4)' }}>
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
                    className="flex min-h-[48px] items-center justify-center rounded-2xl text-[14px] font-bold text-white transition active:opacity-80 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 8px 24px rgba(60,120,255,0.4)' }}>
                    {testing ? '接続テスト中…' : '接続テスト'}
                  </button>

                  {testResult && (
                    <p
                      className="rounded-2xl px-4 py-3 text-[13px] font-semibold"
                      style={
                        testResult.ok
                          ? { background: 'rgba(34,229,168,0.15)', color: '#86efac', border: '1px solid rgba(34,229,168,0.35)' }
                          : { background: 'rgba(224,85,85,0.15)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.35)' }
                      }>
                      {testResult.ok ? '✅ ' : '⚠️ '}{testResult.message}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

        </section>
        )}

        {/* プラグイン（プランに関わらず常時表示） */}
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          <SettingRow emoji="🧩" title="プラグイン" desc="準備中" onClick={() => setSheet('plugin')} />
        </section>

        {/* グループ3：お問い合わせ／プライバシーポリシー／会社情報 */}
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          <SettingRow emoji="✉️" title="お問い合わせ" desc="準備中" onClick={() => setSheet('contact')} />
          <Divider />
          <SettingRow emoji="🔒" title="プライバシーポリシー" desc="準備中" onClick={() => setSheet('privacy')} />
          <Divider />
          <SettingRow emoji="🏢" title="会社情報" desc="準備中" onClick={() => setSheet('company')} />
        </section>

        {/* グループ4：ログアウト（確認モーダルを開く） */}
        {configured && loggedIn && (
          <section className="overflow-hidden rounded-3xl" style={{ ...GLASS_CARD, border: '1px solid rgba(224,85,85,0.4)' }}>
            <button
              type="button"
              onClick={() => setSheet('logout')}
              className="flex w-full min-h-[56px] items-center gap-3 px-5 py-4 text-left active:opacity-70">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(224,85,85,0.16)', color: '#ff9b9b' }}>
                <LogoutIcon size={18} />
              </span>
              <span className="flex-1 text-[15px] font-bold" style={{ color: '#ff9b9b' }}>ログアウト</span>
              <span className="shrink-0" style={{ color: '#ff9b9b' }}>
                <ChevronRightIcon size={18} />
              </span>
            </button>
          </section>
        )}

        {!configured && (
          <p
            className="rounded-2xl p-4 text-[13px]"
            style={{ border: '1px solid rgba(242,213,138,0.4)', background: 'rgba(242,213,138,0.10)', color: '#f2d58a' }}>
            Supabase が未設定のため、アカウント情報は表示されません。
          </p>
        )}
      </div>

      {/* ── ボトムシート群（fixed・モバイルのみ） ── */}
      {sheet === 'billing' && (
        <BottomSheet title="契約・お支払い" onClose={() => setSheet(null)}>
          <FieldGroup>
            <Field label="基本料金" value="0円" />
            <Field label="プラグイン料金" value="0円" />
            <Field label="契約合計金額" value="0円" />
            <Field label="支払い方法" value="未登録（準備中）" muted />
          </FieldGroup>

          {/* ストレージ使用量（表示専用・暫定モック） */}
          <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>ストレージ使用量</p>
          <div
            className="rounded-2xl px-4 py-3.5"
            style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)' }}>
            <div className="flex items-end justify-between gap-3">
              <span className="text-[15px] font-bold text-white">
                {storageUsedGb}GB
                <span className="ml-1 text-[13px] font-semibold" style={{ color: '#9fb0e0' }}>/ {storageLimitGb}GB</span>
              </span>
              <span className="text-[14px] font-extrabold" style={{ color: storageColor }}>{storagePct}%</span>
            </div>

            {/* プログレスバー（使用率を視覚化・しきい値で配色変化） */}
            <div
              className="mt-2.5 h-3 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={storagePct}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max(storagePct, 2)}%`,
                  background: `linear-gradient(90deg, ${storageColor}cc, ${storageColor})`,
                  boxShadow: `0 0 10px ${storageColor}`,
                }}
              />
            </div>

            <p className="mt-2 text-[11px] font-semibold" style={{ color: storageColor }}>{storageNote}</p>
            <p className="mt-1 text-[11px]" style={{ color: '#7a86b8' }}>
              {planLabel} の上限 {storageLimitGb}GB ／ ※ 表示は暫定値（実計測は未実装）
            </p>
          </div>

          <p className="mt-3 text-[11px]" style={{ color: '#7a86b8' }}>
            ※ クレジットカード番号などの決済情報は保存されません。
          </p>
        </BottomSheet>
      )}

      {sheet === 'plugin' && <SoonSheet title="プラグイン" onClose={() => setSheet(null)} />}
      {sheet === 'contact' && <SoonSheet title="お問い合わせ" onClose={() => setSheet(null)} />}
      {sheet === 'privacy' && <SoonSheet title="プライバシーポリシー" onClose={() => setSheet(null)} />}
      {sheet === 'company' && <SoonSheet title="会社情報" onClose={() => setSheet(null)} />}

      {sheet === 'logout' && (
        <BottomSheet title="ログアウト" onClose={() => setSheet(null)}>
          <p className="text-[14px]" style={{ color: '#dbe4ff' }}>ログアウトしますか？</p>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => setSheet(null)}
              className="min-h-[48px] flex-1 rounded-full text-[14px] font-semibold"
              style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="min-h-[48px] flex-1 rounded-full text-[14px] font-bold text-white"
              style={{ backgroundColor: '#E05555' }}>
              ログアウト
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
    </>
  );
}

// ── カテゴリ行（タップで各シートを開く） ──────────────────────────
function SettingRow({
  emoji,
  title,
  desc,
  onClick,
}: {
  emoji: string;
  title: string;
  desc?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-h-[56px] items-center gap-3 px-5 py-4 text-left active:opacity-70">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px]" style={{ backgroundColor: 'rgba(99,102,241,0.16)' }}>
        {emoji}
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-[15px] font-semibold" style={{ color: '#e6edff' }}>{title}</span>
        {desc && <span className="text-[12px]" style={{ color: '#9fb0e0' }}>{desc}</span>}
      </span>
      <span className="shrink-0" style={{ color: '#9aa6e0' }}>
        <ChevronRightIcon size={18} />
      </span>
    </button>
  );
}

// グループ内の区切り線
function Divider() {
  return <div className="mx-5 h-px" style={{ background: 'rgba(120,160,255,0.12)' }} />;
}

// ── ボトムシート（下からスライドアップするダーク・グラスのモーダル） ──
function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-md overflow-y-auto rounded-t-3xl px-5 pt-3 sm:rounded-3xl"
        style={{
          maxHeight: '85vh',
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
          background: 'rgba(16,20,42,0.96)',
          border: '1px solid rgba(120,160,255,0.28)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.5), 0 0 24px rgba(99,102,241,0.14)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}>
        {/* グラバー */}
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-bold" style={{ color: '#ffffff' }}>{title}</h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            style={{ color: '#c7d2fe' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ユーザー情報セクションの行（ラベル＋任意の値ノード・横並び表示用）
function InfoRow({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 pb-3.5"
      style={last ? undefined : { borderBottom: '1px solid rgba(120,160,255,0.14)' }}>
      <span className="shrink-0 text-[13px]" style={{ color: '#9fb0e0' }}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// アカウント情報セクションの編集フィールド（ラベルを上・入力を下に置く縦並び）
function AccountField({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div
      className="flex flex-col gap-1.5 pb-3.5"
      style={last ? undefined : { borderBottom: '1px solid rgba(120,160,255,0.14)' }}>
      <span className="text-[12px] font-semibold" style={{ color: '#9fb0e0' }}>{label}</span>
      {children}
    </div>
  );
}

// シート内のラベル/値の行
function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0"
      style={{ borderColor: 'rgba(120,160,255,0.14)' }}>
      <span className="shrink-0 text-[13px]" style={{ color: '#9fb0e0' }}>{label}</span>
      <span className="truncate text-right text-[13px] font-semibold" style={{ color: muted ? '#7a86b8' : '#e6edff' }}>
        {value}
      </span>
    </div>
  );
}

// シート内のフィールドをまとめる枠
function FieldGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl px-4" style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)' }}>
      {children}
    </div>
  );
}

// 「準備中」プレースホルダーのボトムシート
function SoonSheet({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <BottomSheet title={title} onClose={onClose}>
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(99,102,241,0.16)' }}>
          🚧
        </span>
        <p className="text-[15px] font-bold" style={{ color: '#e6edff' }}>準備中</p>
        <p className="text-[12px]" style={{ color: '#9fb0e0' }}>
          この機能は現在準備中です。今後のアップデートで利用できるようになります。
        </p>
      </div>
    </BottomSheet>
  );
}
