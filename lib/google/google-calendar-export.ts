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
import { isGoogleCalendarConfigured } from './google-calendar-config';
import { requestGoogleCalendarAccessToken } from './google-calendar-oauth';
import { createCalendarEvent, updateCalendarEvent } from './google-calendar-events';
import { findCalendarEventByReservation } from './google-calendar-lookup';

/** 予定のカレンダー書き出し結果状態。 */
export type GoogleCalendarReservationExportState =
  | 'success'
  | 'already-exists' // 既に同じ予定がカレンダーに登録済み（重複作成しない）
  | 'unconfigured'
  | 'cancelled'
  | 'error';

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
  const accessToken = token.accessToken;

  // 重複防止（Option C）：作成前に、この予定IDのイベントが既に存在しないか確認する。
  let existingEventId: string | null;
  try {
    existingEventId = await findCalendarEventByReservation(accessToken, reservation.id);
  } catch {
    return { state: 'error', error: 'Googleカレンダーの登録済み確認に失敗しました' };
  }
  if (existingEventId) {
    // 既に登録済み。重複作成はしない。
    return {
      state: 'already-exists',
      eventId: existingEventId,
      error: 'This reservation is already exported to Google Calendar',
    };
  }

  try {
    const event = await createCalendarEvent(accessToken, reservation);
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

/** 予定のカレンダー更新結果状態。 */
export type GoogleCalendarReservationUpdateState =
  | 'success'
  | 'not-found' // カレンダーに未登録（自動作成はしない。先に「追加」が必要）
  | 'unconfigured'
  | 'cancelled'
  | 'error';

/** 予定のカレンダー更新結果。state==='success' のときだけイベント情報を持つ。 */
export interface GoogleCalendarReservationUpdateResult {
  state: GoogleCalendarReservationUpdateState;
  /** 更新された Google カレンダーイベントの ID（成功時）。 */
  eventId?: string;
  /** イベントのタイトル（成功時）。 */
  summary?: string;
  /** イベントへのリンク（取得できた場合）。 */
  htmlLink?: string;
  /** 失敗・キャンセル・未設定の理由。 */
  error?: string;
}

/**
 * 1件の予定に対応する既存の Google カレンダーイベントを部分更新する（events.patch）。
 *
 * - 設定・トークン状態に応じて安全に早期リターン：unconfigured / cancelled / error。
 * - 予定IDで既存イベントを検索し、
 *   - 見つかれば updateCalendarEvent で summary/description/start/end のみ patch → success。
 *   - 見つからなければ { state:'not-found' }（**自動作成はしない**。先に追加が必要）。
 * - トークンは保存しない。MyBrain/Supabase の更新はこの関数の外で完了している前提。
 * - 一方向（MyBrain → カレンダー）。削除・双方向同期はここでは実装しない。
 */
export async function updateReservationInGoogleCalendar(
  reservation: Reservation,
): Promise<GoogleCalendarReservationUpdateResult> {
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
    // 未登録 → 自動作成はしない。
    return { state: 'not-found' };
  }

  try {
    const event = await updateCalendarEvent(accessToken, existingEventId, reservation);
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
