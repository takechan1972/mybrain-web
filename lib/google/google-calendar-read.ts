/**
 * Google カレンダーの予定を「読み取り専用」で取得するヘルパー。
 *
 * - 用途：モバイル予約画面・デスクトップ予定画面で「Googleカレンダーの予定（今日/明日/今週）」を
 *   表示するために使う。読み取り専用・ユーザー操作起点・表示のみ（取り込み/書き込みはしない）。
 * - 取得結果は Supabase / localStorage に保存しない（React state で表示するだけ）。
 * - Calendar REST API（events.list）を primary カレンダーに対して呼ぶ。
 *   既存スコープ calendar.events で読み取り可能（新しいスコープは追加しない）。
 * - アクセストークンは取得して使うのみ・保存しない。リフレッシュトークンは扱わない。
 * - 取得結果はどこにも保存しない（Supabase にも入れない）。呼び出し側へ返すだけ。
 * - 一方向の読み取りのみ。取り込み・双方向同期・書き込みはしない。
 * - 設計方針：docs/google-calendar-integration-design.md
 */

import { isGoogleCalendarConfigured } from './google-calendar-config';
import { requestGoogleCalendarAccessToken } from './google-calendar-oauth';

const CALENDAR_EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
/** 取得件数の安全上限（today/tomorrow/thisweek の範囲なら十分）。 */
const MAX_RESULTS = 50;

/** 正規化した Google カレンダーイベント（読み取り専用・内部表現）。 */
export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  /** 開始 epoch ms（allDay は当日ローカル 0:00、時間指定は dateTime）。取得不可なら null。 */
  start: number | null;
  /** 終了 epoch ms（取得不可なら null。allDay の end.date は排他的な点に注意）。 */
  end: number | null;
  /** 終日イベントかどうか（start.date のみで dateTime が無い場合 true）。 */
  allDay: boolean;
  /** イベントへのリンク（取得できた場合）。 */
  htmlLink?: string;
  /** MyBrain 由来イベントの元予定ID（将来UIで重複除外するため保持）。無ければ undefined。 */
  mybrainReservationId?: string;
}

/** Google Calendar events.list の生イベント（必要フィールドのみ）。 */
interface RawCalendarEvent {
  id?: string;
  summary?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/** "YYYY-MM-DD"（終日イベント）を端末ローカルの 0:00 epoch ms にする。 */
function parseLocalDate(dateStr: string): number | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** RFC3339（オフセット付き）の dateTime を epoch ms にする。 */
function parseDateTime(dateTime: string): number | null {
  const t = new Date(dateTime).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 生イベントを内部表現へ正規化する。 */
function normalizeEvent(e: RawCalendarEvent): GoogleCalendarEvent {
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  const start = e.start?.dateTime
    ? parseDateTime(e.start.dateTime)
    : e.start?.date
      ? parseLocalDate(e.start.date)
      : null;
  const end = e.end?.dateTime
    ? parseDateTime(e.end.dateTime)
    : e.end?.date
      ? parseLocalDate(e.end.date)
      : null;
  const mybrainReservationId = e.extendedProperties?.private?.mybrainReservationId;
  return {
    id: e.id ?? '',
    summary: e.summary ?? '無題の予定',
    start,
    end,
    allDay,
    htmlLink: e.htmlLink,
    ...(mybrainReservationId ? { mybrainReservationId } : {}),
  };
}

/**
 * primary カレンダーの [timeMin, timeMax] のイベントを取得して正規化して返す（低レベル）。
 *
 * - singleEvents=true で繰り返し予定を展開、orderBy=startTime で開始順、maxResults で上限。
 * - トークンは引数で受け取るだけ・保存しない。ここではトークンを取得しない。
 * - 取得結果は保存しない（呼び出し側へ返すのみ）。
 *
 * @param accessToken 短命アクセストークン（保存しない）
 * @param timeMin 範囲開始 epoch ms
 * @param timeMax 範囲終了 epoch ms
 * @returns 正規化イベントの配列
 */
export async function listCalendarEvents(
  accessToken: string,
  timeMin: number,
  timeMax: number,
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(MAX_RESULTS),
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    fields: 'items(id,summary,htmlLink,start,end,extendedProperties)',
  });
  const res = await fetch(`${CALENDAR_EVENTS_ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Calendar events list failed (${res.status})`);
  }
  const data = (await res.json()) as { items?: RawCalendarEvent[] };
  return (data.items ?? []).map(normalizeEvent);
}

/** 読み取り範囲。 */
export type GoogleCalendarReadRange = 'today' | 'tomorrow' | 'thisweek';

/** 読み取り結果状態。 */
export type GoogleCalendarReadState = 'success' | 'unconfigured' | 'cancelled' | 'error';

/** 読み取り結果。state==='success' のときだけ events を持つ。 */
export interface GoogleCalendarReadResult {
  state: GoogleCalendarReadState;
  events?: GoogleCalendarEvent[];
  error?: string;
}

/** 範囲（today/tomorrow/thisweek）を端末ローカルの [timeMin, timeMax] epoch ms に変換する。 */
function rangeFor(range: GoogleCalendarReadRange): { timeMin: number; timeMax: number } {
  const n = new Date();
  const startOfDay = (offset: number) =>
    new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset).getTime();
  const endOfDay = (offset: number) =>
    new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset + 1).getTime() - 1;
  if (range === 'tomorrow') {
    return { timeMin: startOfDay(1), timeMax: endOfDay(1) };
  }
  if (range === 'thisweek') {
    // 今日〜今週日曜まで（今日が日曜なら今日の終わりまで）。consult-engine の weekRange と同定義。
    const daysUntilSunday = (7 - n.getDay()) % 7;
    return { timeMin: startOfDay(0), timeMax: endOfDay(daysUntilSunday) };
  }
  // today
  return { timeMin: startOfDay(0), timeMax: endOfDay(0) };
}

/**
 * 指定範囲（today/tomorrow/thisweek）の Google カレンダー予定を読み取って返す（高レベル）。
 *
 * - isGoogleCalendarConfigured() を確認 → 未設定なら { state:'unconfigured' }。
 * - アクセストークンを取得（ユーザー操作起点の想定）。cancelled/error は素直に返す。
 * - ローカル日付で範囲を計算し listCalendarEvents を呼ぶ。
 * - 取得結果はどこにも保存しない（呼び出し側へ返すのみ・Supabase / localStorage に入れない）。
 * - モバイル予約画面・デスクトップ予定画面から呼ぶ（ユーザー操作起点・表示のみ）。自動取得はしない。
 */
export async function readGoogleCalendarEventsInRange(
  range: GoogleCalendarReadRange,
): Promise<GoogleCalendarReadResult> {
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

  const { timeMin, timeMax } = rangeFor(range);
  try {
    const events = await listCalendarEvents(token.accessToken, timeMin, timeMax);
    return { state: 'success', events };
  } catch (e) {
    return { state: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
