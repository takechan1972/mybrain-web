/**
 * 1件の予定（Reservation）を Google カレンダーへ書き出すオーケストレーション（UI 非接続）。
 *
 * - トークン取得（requestGoogleCalendarAccessToken）とイベント作成（createCalendarEvent）を組み合わせるだけ。
 * - アクセストークンは取得して即 createCalendarEvent に渡すのみ・保存しない。リフレッシュトークンは扱わない。
 * - 一方向（MyBrain → カレンダー）。更新・削除・双方向同期はこの段階では実装しない。
 * - まだどの画面からも呼ばない（UI 非接続）。
 * - 設計方針：docs/google-calendar-integration-design.md
 */

import type { Reservation } from '@/lib/types';
import { requestGoogleCalendarAccessToken } from './google-calendar-oauth';
import { createCalendarEvent } from './google-calendar-events';

/** 予定のカレンダー書き出し結果状態。 */
export type GoogleCalendarReservationExportState = 'success' | 'unconfigured' | 'cancelled' | 'error';

/** 予定のカレンダー書き出し結果。state==='success' のときだけイベント情報を持つ。 */
export interface GoogleCalendarReservationExportResult {
  state: GoogleCalendarReservationExportState;
  /** 作成された Google カレンダーイベントの ID（成功時）。 */
  eventId?: string;
  /** イベントのタイトル（成功時）。 */
  summary?: string;
  /** イベントへのリンク（取得できた場合）。 */
  htmlLink?: string;
  /** 失敗・キャンセル・未設定時の理由。 */
  error?: string;
}

/**
 * 1件の予定を Google カレンダー（primary）にイベントとして書き出す。
 *
 * - カレンダー用の短命アクセストークンを取得し、granted なら createCalendarEvent を呼ぶ。
 * - トークン状態に応じて安全に早期リターンする：
 *   - unconfigured → { state:'unconfigured' }
 *   - cancelled    → { state:'cancelled' }
 *   - error / 想定外 → { state:'error', error }
 * - イベント作成の例外も { state:'error', error } として返す。
 *
 * トークンは保存しない（取得して createCalendarEvent に渡すのみ）。
 */
export async function exportReservationToGoogleCalendar(
  reservation: Reservation,
): Promise<GoogleCalendarReservationExportResult> {
  const token = await requestGoogleCalendarAccessToken();
  if (token.state === 'unconfigured') {
    return { state: 'unconfigured', error: 'Google Calendar is not configured' };
  }
  if (token.state === 'cancelled') {
    return { state: 'cancelled', error: 'Google Calendar authorization was cancelled' };
  }
  if (token.state === 'error') {
    return { state: 'error', error: token.error || 'Failed to get Google Calendar access token' };
  }
  if (token.state !== 'granted' || !token.accessToken) {
    return { state: 'error', error: token.error || 'Failed to get Google Calendar access token' };
  }

  try {
    const event = await createCalendarEvent(token.accessToken, reservation);
    return {
      state: 'success',
      eventId: event.id,
      summary: event.summary,
      htmlLink: event.htmlLink,
    };
  } catch (e) {
    return { state: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
