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
import DesktopSettings from '@/components/DesktopSettings';

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
  | 'account'
  | 'plan'
  | 'billing'
  | 'plugin'
  | 'contact'
  | 'privacy'
  | 'company'
  | 'logout';

export default function SettingsPage() {
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState<string | null>(null);

  // Ollama（ローカルAI）設定
  const [ollama, setOllama] = useState<OllamaSettings>(DEFAULT_OLLAMA_SETTINGS);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [local, setLocal] = useState(false);
  // カテゴリ設定トップ：開いているボトムシート／AI設定の展開状態
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

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
            <span className="text-[12px] font-semibold" style={{ color: '#9fb0e0' }}>
              ログイン中・無料プラン
            </span>
            <span className="truncate text-[15px] font-bold" style={{ color: loggedIn ? '#ffffff' : '#9fb0e0' }}>
              {email ?? '未ログイン'}
            </span>
          </div>
        </section>

        {/* グループ1：登録者情報／ご利用プラン／契約・お支払い */}
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          <SettingRow emoji="👤" title="登録者情報" desc="プラン・ログインID・パスワード" onClick={() => setSheet('account')} />
          <Divider />
          <SettingRow emoji="🎫" title="ご利用プラン" desc="無料プラン" onClick={() => setSheet('plan')} />
          <Divider />
          <SettingRow emoji="💳" title="契約・お支払い" desc="基本料金・支払い方法" onClick={() => setSheet('billing')} />
        </section>

        {/* グループ2：AI設定（展開）／プラグイン */}
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

          <Divider />
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
      {sheet === 'account' && (
        <BottomSheet title="登録者情報" onClose={() => setSheet(null)}>
          <p className="mb-1.5 text-[12px] font-bold" style={{ color: '#86efac' }}>現在のプラン</p>
          <FieldGroup>
            <Field label="プラン" value="無料プラン" />
            <Field label="ログインID" value={email ?? '未ログイン'} />
            <Field label="パスワード" value="登録済み" />
            <Field label="パスワード変更" value="準備中" muted />
          </FieldGroup>
          <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>有料プラン登録情報（準備中）</p>
          <FieldGroup>
            <Field label="プラン" value="有料プラン" muted />
            <Field label="氏名" value="準備中" muted />
            <Field label="連絡先" value="準備中" muted />
            <Field label="メールアドレス" value={email ?? '準備中'} muted />
            <Field label="契約期間" value="準備中" muted />
            <Field label="登録決済会社" value="準備中" muted />
            <Field label="支払い方法" value="登録済み（準備中）" muted />
          </FieldGroup>
          <p className="mt-3 text-[11px]" style={{ color: '#7a86b8' }}>
            ※ 実際のパスワードやクレジットカード番号は表示・保存されません。
          </p>
        </BottomSheet>
      )}

      {sheet === 'plan' && (
        <BottomSheet title="ご利用プラン" onClose={() => setSheet(null)}>
          <FieldGroup>
            <Field label="現在のプラン" value="無料プラン" />
            <Field label="スタンダードプラン" value="準備中" muted />
            <Field label="有料プラン管理" value="準備中" muted />
          </FieldGroup>
        </BottomSheet>
      )}

      {sheet === 'billing' && (
        <BottomSheet title="契約・お支払い" onClose={() => setSheet(null)}>
          <FieldGroup>
            <Field label="基本料金" value="0円" />
            <Field label="プラグイン料金" value="0円" />
            <Field label="契約合計金額" value="0円" />
            <Field label="支払い方法" value="未登録（準備中）" muted />
          </FieldGroup>
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
