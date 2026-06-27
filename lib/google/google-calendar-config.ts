/**
 * Google カレンダー連携の公開設定チェック（最小ユーティリティ・能力検出のみ）。
 *
 * - 将来の「予定を Google カレンダーへ書き出し」の土台。ここでは OAuth を始めない・API も呼ばない。
 * - クライアント ID は Drive と共有する（同じ OAuth クライアントで後から calendar.events スコープを要求できる）。
 *   そのため getGoogleDriveClientId() を再利用する。
 * - 有効/無効はカレンダー専用フラグ NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED で切り替える。
 * - 読むのは公開前提の NEXT_PUBLIC_ 値のみ。サーバ専用の秘密は読まない。
 * - 設計方針：docs/google-calendar-integration-design.md
 */

import { getGoogleDriveClientId } from './google-drive-config';

/** Google カレンダー連携設定の状態。 */
export type GoogleCalendarConfigStatus = 'configured' | 'missing-client-id' | 'disabled';

/**
 * Google カレンダー連携を明示的に無効化しているか。
 * - NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED='false' のときだけ無効とみなす（既定は有効扱い）。
 */
function isExplicitlyDisabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_ENABLED === 'false';
}

/**
 * Google カレンダー連携の設定状態を返す。
 * - 'disabled'：明示的に無効化されている。
 * - 'missing-client-id'：クライアント ID が無い（連携不可）。
 * - 'configured'：必要な公開設定が揃っている。
 */
export function getGoogleCalendarConfigStatus(): GoogleCalendarConfigStatus {
  if (isExplicitlyDisabled()) return 'disabled';
  // クライアント ID は Drive と共有（同一 OAuth クライアントで Calendar スコープを後から要求できる）。
  if (!getGoogleDriveClientId()) return 'missing-client-id';
  return 'configured';
}

/**
 * Google カレンダー連携に必要な公開設定が揃っているか。
 * - クライアント ID が無い／無効化されている場合は false。
 * - OAuth 開始・API 呼び出しはしない（設定の有無を返すだけ）。
 */
export function isGoogleCalendarConfigured(): boolean {
  return getGoogleCalendarConfigStatus() === 'configured';
}
