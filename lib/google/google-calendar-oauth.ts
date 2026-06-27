/**
 * Google カレンダー OAuth（GIS トークンフロー）ヘルパー（UI 非接続）。
 *
 * - 設計メモ（docs/google-calendar-integration-design.md）に沿う：
 *   GIS トークンフロー採用 / scope は calendar.events / アクセストークンは短命・メモリのみ。
 * - GIS スクリプト読み込みは Drive 側の loadGoogleIdentityServices を再利用する。
 * - クライアント ID は Drive と共有（getGoogleDriveClientId）。同一 OAuth クライアントで Calendar スコープを要求する。
 * - ここでは「アクセストークンを取得して呼び出し側へ返す」ところまで。保存しない・Calendar API も呼ばない。
 * - リフレッシュトークンは要求も保存もしない。
 * - トークンを localStorage / sessionStorage / IndexedDB / Cookie / Supabase に保存しない（メモリのみ）。
 * - まだどの画面からも呼ばない（UI 非接続）。
 */

import { getGoogleDriveClientId } from './google-drive-config';
import { isGoogleCalendarConfigured } from './google-calendar-config';
import { loadGoogleIdentityServices } from './google-drive-oauth';

/** カレンダーのイベント読み書きに必要な最小スコープ。 */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** アクセストークン取得の結果状態。 */
export type GoogleCalendarAccessTokenState = 'granted' | 'unconfigured' | 'cancelled' | 'error';

/**
 * アクセストークン取得の結果。
 * - accessToken は短命・メモリのみ。呼び出し側へ返すだけで、どこにも保存しない。
 */
export interface GoogleCalendarAccessTokenResult {
  state: GoogleCalendarAccessTokenState;
  accessToken?: string;
  expiresIn?: number;
  error?: string;
}

/**
 * GIS トークンフローで Google カレンダー用の短命アクセストークンを要求する。
 *
 * - 公開設定が無い → { state: 'unconfigured' }。
 * - ユーザーが同意ポップアップを閉じた → { state: 'cancelled' }。
 * - スクリプト読み込み失敗・トークン応答エラー等 → { state: 'error', error }。
 * - 成功 → { state: 'granted', accessToken, expiresIn }。
 *
 * トークンは呼び出し側へ返すのみ（保存しない）。リフレッシュトークンは要求しない。
 */
export async function requestGoogleCalendarAccessToken(): Promise<GoogleCalendarAccessTokenResult> {
  const clientId = getGoogleDriveClientId();
  if (!isGoogleCalendarConfigured() || !clientId) return { state: 'unconfigured' };
  if (typeof window === 'undefined') return { state: 'error', error: 'Not in a browser environment' };

  try {
    await loadGoogleIdentityServices();
  } catch (e) {
    return { state: 'error', error: e instanceof Error ? e.message : String(e) };
  }

  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) return { state: 'error', error: 'Google Identity Services unavailable' };

  return new Promise<GoogleCalendarAccessTokenResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (r: GoogleCalendarAccessTokenResult) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(r);
      }
    };
    // 安全弁：GIS が callback / error_callback を呼ばずにポップアップが閉じる事例があるため、
    // 一定時間で必ず結果を返し、UI が無限待ちにならないようにする（検証しやすい短めの値）。
    timer = setTimeout(() => {
      done({ state: 'error', error: 'Google認証が完了しませんでした。もう一度お試しください。' });
    }, 20000);
    try {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_CALENDAR_SCOPE,
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
