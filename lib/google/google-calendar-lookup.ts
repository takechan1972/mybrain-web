/**
 * 予定IDから Google カレンダーの既存イベントを検索するヘルパー（UI 非接続）。
 *
 * - 重複防止の設計メモ Option C：events.list を privateExtendedProperty で絞り込む。
 *   createCalendarEvent が作成時に extendedProperties.private.mybrainReservationId を刻んでいるため、
 *   それをキーに「この予定が既にカレンダーに登録済みか」を判定できる。
 * - 実際に Calendar REST API（events.list）を呼ぶが、UI からはまだ呼ばない・書き出しフローにも繋がない。
 *   呼び出し側が短命アクセストークンを渡したときだけ動く。
 * - トークンは引数で受け取るだけ・保存しない。ここではトークンを取得しない。
 * - Supabase には何も保存しない（Google 側の event ID も DB に溜めない）。
 * - 設計方針：docs/google-calendar-duplicate-prevention-design.md
 */

const CALENDAR_EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/**
 * 指定の MyBrain 予定IDに対応する Google カレンダーイベントが primary に存在すれば、その event ID を返す。
 *
 * - 見つかれば event ID（文字列）、無ければ null。
 * - 検索は extendedProperties.private.mybrainReservationId で絞り込む（Option C）。
 *
 * @param accessToken 短命アクセストークン（保存しない・この関数内では取得もしない）
 * @param reservationId 検索キーとなる MyBrain の予定ID
 * @returns 既存イベントの ID、または null
 */
export async function findCalendarEventByReservation(
  accessToken: string,
  reservationId: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    privateExtendedProperty: `mybrainReservationId=${reservationId}`,
    maxResults: '1',
    singleEvents: 'true',
    fields: 'items(id,summary,htmlLink)',
  });
  const res = await fetch(`${CALENDAR_EVENTS_ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Calendar event lookup failed (${res.status})`);
  }
  const data = (await res.json()) as { items?: { id: string }[] };
  return data.items && data.items.length > 0 ? data.items[0].id : null;
}
