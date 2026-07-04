/**
 * Google Drive OAuth（GIS トークンフロー）ヘルパー。
 *
 * - 設計メモ（docs/google-drive-markdown-export-design.md の「OAuth 同意フロー設計」）に沿う：
 *   GIS トークンフロー採用 / scope は drive.file / アクセストークンは短命・メモリのみ。
 * - ここでは「アクセストークンを取得して呼び出し側へ返す」ところまで。保存はしない・Drive API も呼ばない。
 * - リフレッシュトークンは要求も保存もしない。
 * - トークンを localStorage / sessionStorage / IndexedDB / Cookie / Supabase に保存しない（メモリのみ）。
 * - 手動エクスポート（google-drive-export.ts の exportMemosToGoogleDrive）から、
 *   ユーザー操作起点で呼ばれる。保存時の自動書き出しはまだこのトークン取得に接続していない。
 */

import { getGoogleDriveClientId, isGoogleDriveConfigured } from './google-drive-config';

/** Drive 書き出しに必要な最小スコープ（アプリが作成/オープンしたファイルのみ）。 */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** GIS スクリプトの URL。 */
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

// --- GIS（google.accounts.oauth2）の最小型宣言（公式 lib に型が無いため自前で持つ）。 ---
interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}
interface GisErrorResponse {
  type?: string;
  message?: string;
}
interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}
interface GisTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GisTokenResponse) => void;
  error_callback?: (error: GisErrorResponse) => void;
}
declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: GisTokenClientConfig) => GisTokenClient;
        };
      };
    };
  }
}

// スクリプトは一度だけ読み込む（読み込み Promise をキャッシュ）。
let gisLoadPromise: Promise<void> | null = null;

/**
 * Google Identity Services のスクリプトを動的に読み込む（一度だけ）。
 *
 * - すでに読み込み済みなら即解決。
 * - ブラウザ専用：window / document が無ければ reject。
 * - 読み込み失敗時はキャッシュを破棄して reject（次回再試行できる）。
 */
export function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google Identity Services is browser-only'));
  }
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const onError = () => {
      gisLoadPromise = null; // 失敗はキャッシュしない
      reject(new Error('Failed to load Google Identity Services'));
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_URL}"]`);
    if (existing) {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', onError);
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = onError;
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

/** アクセストークン取得の結果状態。 */
export type GoogleDriveAccessTokenState = 'granted' | 'unconfigured' | 'cancelled' | 'error';

/**
 * アクセストークン取得の結果。
 * - accessToken は短命・メモリのみ。呼び出し側へ返すだけで、どこにも保存しない。
 */
export interface GoogleDriveAccessTokenResult {
  state: GoogleDriveAccessTokenState;
  accessToken?: string;
  expiresIn?: number;
  error?: string;
}

/**
 * GIS トークンフローで Google Drive 用の短命アクセストークンを要求する。
 *
 * - 公開設定が無い → { state: 'unconfigured' }。
 * - ユーザーが同意ポップアップを閉じた → { state: 'cancelled' }。
 * - スクリプト読み込み失敗・トークン応答エラー等 → { state: 'error', error }。
 * - 成功 → { state: 'granted', accessToken, expiresIn }。
 *
 * トークンは呼び出し側へ返すのみ（保存しない）。リフレッシュトークンは要求しない。
 */
export async function requestGoogleDriveAccessToken(): Promise<GoogleDriveAccessTokenResult> {
  const clientId = getGoogleDriveClientId();
  if (!isGoogleDriveConfigured() || !clientId) return { state: 'unconfigured' };
  if (typeof window === 'undefined') return { state: 'error', error: 'Not in a browser environment' };

  try {
    await loadGoogleIdentityServices();
  } catch (e) {
    return { state: 'error', error: e instanceof Error ? e.message : String(e) };
  }

  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) return { state: 'error', error: 'Google Identity Services unavailable' };

  return new Promise<GoogleDriveAccessTokenResult>((resolve) => {
    let settled = false;
    const done = (r: GoogleDriveAccessTokenResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    try {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_DRIVE_SCOPE,
        callback: (response) => {
          if (response.error) {
            done({ state: 'error', error: response.error_description || response.error });
            return;
          }
          if (response.access_token) {
            done({ state: 'granted', accessToken: response.access_token, expiresIn: response.expires_in });
            return;
          }
          done({ state: 'error', error: 'No access token returned' });
        },
        error_callback: (err) => {
          // ユーザーがポップアップを閉じた／開けなかった場合はキャンセル扱い。
          if (err?.type === 'popup_closed' || err?.type === 'popup_failed_to_open') {
            done({ state: 'cancelled', error: err?.message });
          } else {
            done({ state: 'error', error: err?.message || 'Token request failed' });
          }
        },
      });
      client.requestAccessToken();
    } catch (e) {
      done({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** OAuth 開始の結果状態。 */
export type GoogleDriveOAuthStartState =
  | 'unconfigured' // 連携に必要な公開設定が無い（クライアント ID 未設定 / 無効化）
  | 'ready'; // 設定が揃っており、トークン取得（requestGoogleDriveAccessToken）を呼べる

/** OAuth 開始の結果。 */
export interface GoogleDriveOAuthStartResult {
  state: GoogleDriveOAuthStartState;
}

/**
 * Google Drive 連携の前提が整っているかを返す入口（副作用なし・ポップアップを開かない）。
 *
 * - 公開設定が無い → { state: 'unconfigured' }。
 * - 設定あり → { state: 'ready' }。実際のトークン取得は requestGoogleDriveAccessToken() を使う。
 */
export async function startGoogleDriveOAuth(): Promise<GoogleDriveOAuthStartResult> {
  if (!isGoogleDriveConfigured()) return { state: 'unconfigured' };
  return { state: 'ready' };
}
