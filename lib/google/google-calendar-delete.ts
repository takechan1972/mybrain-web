/**
 * 1件の予定（Reservation）に対応する Google カレンダーのイベントを削除するオーケストレーション（UI 非接続）。
 *
 * - MyBrain/Supabase が source of truth。カレンダーから消しても MyBrain の予定は消さない
 *   （このヘルパーは Google 側のイベントだけを対象にする）。
 * - 予定IDで既存イベントを検索し（findCalendarEventByReservation）、見つかった1件だけを events.delete で消す。
 * - Google のイベント ID は Supabase に保存しない（検索は extendedProperties.private.mybrainReservationId 経由）。
 * - アクセストークンは取得して即使うのみ・保存しない。リフレッシュトークンは扱わない。
 * - 一方向（MyBrain → カレンダー）。自動・定期削除はしない（ユーザー操作起点の想定）。
 * - まだどの画面からも呼ばない（UI 非接続）。
 * - 設計方針：docs/google-calendar-integration-design.md
 */

import type { Reservation } from '@/lib/types';
import { isGoogleCalendarConfigured } from './google-calendar-config';
import { requestGoogleCalendarAccessToken } from './google-calendar-oauth';
import { findCalendarEventByReservation } from './google-calendar-lookup';

const CALENDAR_EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/**
 * 1件の Google カレンダーイベントを削除する（events.delete）。
 *
 * - res.ok なら解決。
 * - 404 / 410（既に無い）は「望む最終状態に到達済み」として成功扱いで解決する。
 * - それ以外のステータスは例外を投げる。
 * - アクセストークンは引数で受け取るだけ・保存しない。ここではトークンを取得しない。
 *
 * @param accessToken 短命アクセストークン（保存しない）
 * @param eventId 削除対象の Google カレンダーイベント ID
 */
export async function deleteCalendarEvent(accessToken: string, eventId: string): Promise<void> {
  const res = await fetch(`${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404/410 は既に削除済み → 望む最終状態に到達しているので成功扱い。
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw new Error(`Calendar event delete failed (${res.status})`);
}

/** 予定のカレンダー削除結果状態。 */
export type GoogleCalendarReservationDeleteState =
  | 'success'
  | 'not-found' // カレンダーに未登録（消すものが無い）
  | 'unconfigured'
  | 'cancelled'
  | 'error';

/** 予定のカレンダー削除結果。state==='success' のときだけ eventId を持つ。 */
export interface GoogleCalendarReservationDeleteResult {
  state: GoogleCalendarReservationDeleteState;
  /** 削除した Google カレンダーイベントの ID（成功時）。 */
  eventId?: string;
  /** 失敗・キャンセル・未設定の理由。 */
  error?: string;
}

/**
 * 1件の予定に対応する既存の Google カレンダーイベントを削除する（events.delete）。
 *
 * - 設定・トークン状態に応じて安全に早期リターン：unconfigured / cancelled / error。
 * - 予定IDで既存イベントを検索し、
 *   - 見つかれば deleteCalendarEvent で削除 → success。
 *   - 見つからなければ { state:'not-found' }（消すものが無い）。
 * - トークンは保存しない。MyBrain/Supabase の予定はこの関数では触らない（Google 側のみ）。
 * - 一方向（MyBrain → カレンダー）。自動・双方向同期はここでは実装しない。
 */
export async function deleteReservationEventFromGoogleCalendar(
  reservation: Reservation,
): Promise<GoogleCalendarReservationDeleteResult> {
  if (!isGoogleCalendarConfigured()) {
    return { state: 'unconfigured', error: 'Google Calendar is not configured' };
  }

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
  const accessToken = token.accessToken;

  // 既存イベントを予定IDで検索（extendedProperties.private.mybrainReservationId）。
  let existingEventId: string | null;
  try {
    existingEventId = await findCalendarEventByReservation(accessToken, reservation.id);
  } catch {
    return { state: 'error', error: 'Googleカレンダーの登録済み確認に失敗しました' };
  }
  if (!existingEventId) {
    // 未登録 → 消すものが無い。
    return { state: 'not-found' };
  }

  try {
    await deleteCalendarEvent(accessToken, existingEventId);
    return { state: 'success', eventId: existingEventId };
  } catch {
    return { state: 'error', error: 'Googleカレンダーからの削除に失敗しました' };
  }
}
