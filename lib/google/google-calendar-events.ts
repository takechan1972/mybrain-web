/**
 * MyBrain の予定（Reservation）から Google カレンダーのイベントを1件作成するヘルパー（UI 非接続）。
 *
 * - Calendar REST API（events.insert）を primary カレンダーに対して呼ぶ。
 * - アクセストークンは引数で受け取るだけ・保存しない。ここではトークンを取得しない
 *   （requestGoogleCalendarAccessToken はここから呼ばない）。
 * - 一方向（MyBrain → カレンダー）のみ。更新・削除・双方向同期はこの段階では実装しない。
 * - タイムゾーンは端末ローカルを基準にする（dateTime に端末のオフセットを付与し、IANA 名も併記）。
 * - 設計方針：docs/google-calendar-integration-design.md
 */

import type { Reservation } from '@/lib/types';

const CALENDAR_EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const DEFAULT_DURATION_MS = 60 * 60 * 1000; // 終了未設定の時間指定予定の既定（1時間）

/** 作成された Google カレンダーイベントの結果。 */
export interface GoogleCalendarCreatedEvent {
  id: string;
  summary: string;
  htmlLink?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** epoch ms を端末ローカルの暦日 "YYYY-MM-DD" にする（終日イベント用）。 */
function toLocalDateString(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** epoch ms の端末ローカル暦日に days を加えた "YYYY-MM-DD"（終日の排他的終了日に使う）。 */
function localDateStringPlusDays(ms: number, days: number): string {
  const d = new Date(ms);
  const shifted = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}-${pad2(shifted.getDate())}`;
}

/** epoch ms を端末ローカルのオフセット付き RFC3339（例: 2026-06-28T09:00:00+09:00）にする。 */
function toRfc3339Local(ms: number): string {
  const d = new Date(ms);
  const offsetMin = -d.getTimezoneOffset(); // 東が正
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${offset}`
  );
}

/** 端末の IANA タイムゾーン名（取得できなければ undefined）。 */
function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 1件の予定を Google カレンダー（primary）にイベントとして作成する。
 *
 * - 開始は startAt（無ければ scheduleAt）を使う。どちらも無ければエラー。
 * - allDay のときは start.date / end.date（end.date は排他的なので +1 日）。
 * - 時間指定のときは start.dateTime / end.dateTime（端末ローカルのオフセット付き RFC3339）。
 *   終了未設定なら開始から1時間後を既定にする。
 * - extendedProperties.private.mybrainReservationId に MyBrain の予定 ID を控える。
 *
 * @param accessToken 短命アクセストークン（保存しない・この関数内では取得もしない）
 * @param reservation 変換元の予定
 * @returns 作成イベントの { id, summary, htmlLink }
 */
export async function createCalendarEvent(
  accessToken: string,
  reservation: Reservation,
): Promise<GoogleCalendarCreatedEvent> {
  const start = reservation.startAt ?? reservation.scheduleAt;
  if (start == null) {
    throw new Error('Reservation has no start time');
  }

  let startField: Record<string, string>;
  let endField: Record<string, string>;
  if (reservation.allDay) {
    const endBase = reservation.endAt ?? start;
    startField = { date: toLocalDateString(start) };
    // Google の終日 end.date は排他的なので、終了日の翌日を渡す（1日予定なら開始日+1日）。
    endField = { date: localDateStringPlusDays(endBase, 1) };
  } else {
    const end = reservation.endAt ?? start + DEFAULT_DURATION_MS;
    const timeZone = localTimeZone();
    startField = { dateTime: toRfc3339Local(start), ...(timeZone ? { timeZone } : {}) };
    endField = { dateTime: toRfc3339Local(end), ...(timeZone ? { timeZone } : {}) };
  }

  const summary = reservation.title || '無題の予定';
  const body: Record<string, unknown> = {
    summary,
    start: startField,
    end: endField,
    extendedProperties: { private: { mybrainReservationId: reservation.id } },
  };
  if (reservation.content) body.description = reservation.content;

  const params = new URLSearchParams({ fields: 'id,summary,htmlLink' });
  const res = await fetch(`${CALENDAR_EVENTS_ENDPOINT}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Calendar event create failed (${res.status})`);
  }
  const data = (await res.json()) as { id?: string; summary?: string; htmlLink?: string };
  if (!data.id) throw new Error('Calendar event create returned no id');
  return { id: data.id, summary: data.summary || summary, htmlLink: data.htmlLink };
}
