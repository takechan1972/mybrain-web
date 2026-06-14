/**
 * API接続先の一元管理。
 *
 * 問い合わせ・解約申請・AIチャット・/health など、バックエンドへ接続する
 * すべての処理はこのファイルの resolveApiBase() / 各URLビルダーを参照する。
 *
 * 解決の優先順位:
 *   1. 呼び出し元が渡す override（設定画面の「上級者向け」接続先）
 *   2. ビルド時の環境変数 EXPO_PUBLIC_API_BASE_URL
 *   3. development のときのみ localhost:8787（開発用フォールバック）
 *   4. production で未設定 → null（localhostへは接続しない・ユーザー向けエラー）
 *
 * 秘密情報（APIキー・token・password・Bearer）はここでは一切扱わない。
 */

const RAW_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim();
const APP_ENV = (process.env.EXPO_PUBLIC_APP_ENV ?? 'development').trim().toLowerCase();

/** production ビルドかどうか */
export const IS_PRODUCTION = APP_ENV === 'production';

/** 開発用フォールバックURL（development のみ使用） */
const DEV_DEFAULT_BASE = 'http://localhost:8787';

// ── ユーザー向け定型文言 ──────────────────────────────────────────────────────

export const MSG_NOT_CONFIGURED =
  'アプリの接続設定が完了していません。販売元へお問い合わせください。';
export const MSG_NETWORK_FAIL =
  '通信できませんでした。インターネット接続を確認して、もう一度お試しください。';
export const MSG_SERVER_DOWN =
  'サーバーに接続できませんでした。時間をおいて再度お試しください。';

// 末尾スラッシュを除去（origin + path の二重スラッシュ防止）
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// 入力がAIエンドポイント（.../api/ai）等でも origin に正規化する
function toOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return stripTrailingSlash(url);
  }
}

export interface ApiBaseResult {
  /** 接続先 origin（例 https://api.example.com）。未設定なら null */
  baseUrl: string | null;
  /** baseUrl が null のときのユーザー向けエラー文言 */
  error?: string;
}

/**
 * 接続先 origin を解決する。
 * @param override 設定画面で入力された接続先（任意）。空なら環境変数/開発用を使う。
 */
export function resolveApiBase(override?: string): ApiBaseResult {
  const ov = (override ?? '').trim();
  if (ov.length > 0) return { baseUrl: toOrigin(ov) };
  if (RAW_BASE.length > 0) return { baseUrl: toOrigin(RAW_BASE) };
  if (!IS_PRODUCTION) return { baseUrl: DEV_DEFAULT_BASE };
  // production かつ未設定：localhost へはフォールバックしない
  return { baseUrl: null, error: MSG_NOT_CONFIGURED };
}

// ── 各種URLビルダー ───────────────────────────────────────────────────────────

export function aiUrl(override?: string): ApiBaseResult & { url?: string } {
  const r = resolveApiBase(override);
  return r.baseUrl ? { ...r, url: `${r.baseUrl}/api/ai` } : r;
}

export function healthUrl(override?: string): ApiBaseResult & { url?: string } {
  const r = resolveApiBase(override);
  return r.baseUrl ? { ...r, url: `${r.baseUrl}/health` } : r;
}

export function supportUrl(path: string, override?: string): ApiBaseResult & { url?: string } {
  const r = resolveApiBase(override);
  const p = path.startsWith('/') ? path : `/${path}`;
  return r.baseUrl ? { ...r, url: `${r.baseUrl}${p}` } : r;
}

// ── 接続状態チェック（/health） ───────────────────────────────────────────────

export type ConnectionState = 'ok' | 'fail' | 'unset';

/**
 * /health を叩いて接続状態を返す。失敗してもアプリを落とさない。
 * 内部情報・秘密情報は返さない（状態のみ）。
 */
export async function checkConnection(override?: string, timeoutMs = 8000): Promise<ConnectionState> {
  const r = healthUrl(override);
  if (!r.url) return 'unset';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(r.url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok ? 'ok' : 'fail';
  } catch {
    clearTimeout(timer);
    return 'fail';
  }
}
