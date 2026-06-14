/**
 * 日時選択UIの共通ロジック（Web / Native 共通）。
 * 年/月/日/時/分を parts として扱い、月末日補正・各種変換を提供する。
 */

export interface DateTimeValue {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0,5,...,55
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}

export function yearOptions(): number[] {
  const y = new Date().getFullYear();
  return range(y - 5, y + 5);
}
export const MONTH_OPTIONS = range(1, 12);
export const HOUR_OPTIONS = range(0, 23);
export const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

// 指定年月の日数（うるう年対応）。month は 1-12。
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function dayOptions(year: number, month: number): number[] {
  return range(1, daysInMonth(year, month));
}

// 月末日補正（例: 1/31 → 2月へ変更時は 2/28 or 29 に補正）
export function clampParts(v: DateTimeValue): DateTimeValue {
  const dim = daysInMonth(v.year, v.month);
  const day = Math.min(Math.max(1, v.day), dim);
  const minute = Math.round(v.minute / 5) * 5 % 60;
  return { ...v, day, minute };
}

export function nowParts(): DateTimeValue {
  const n = new Date();
  return clampParts({
    year: n.getFullYear(),
    month: n.getMonth() + 1,
    day: n.getDate(),
    hour: n.getHours(),
    minute: n.getMinutes(),
  });
}

export function partsFromMs(ms: number): DateTimeValue {
  const n = new Date(ms);
  if (Number.isNaN(n.getTime())) return nowParts();
  return clampParts({
    year: n.getFullYear(),
    month: n.getMonth() + 1,
    day: n.getDate(),
    hour: n.getHours(),
    minute: n.getMinutes(),
  });
}

export function partsToMs(v: DateTimeValue): number {
  return new Date(v.year, v.month - 1, v.day, v.hour, v.minute, 0, 0).getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

// 予定の保存形式 "YYYY-MM-DD HH:mm"
export function partsToDateTimeString(v: DateTimeValue): string {
  return `${v.year}-${pad(v.month)}-${pad(v.day)} ${pad(v.hour)}:${pad(v.minute)}`;
}

// "YYYY-MM-DD HH:mm"（末尾 -HH:mm は無視）→ parts。不正なら null。
export function partsFromDateTimeString(s: string): DateTimeValue | null {
  const str = (s ?? '').trim();
  if (str.length === 0) return null;
  const [datePart, timePart] = str.split(/[ T]/);
  const dm = (datePart ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!dm) return null;
  const tm = (timePart ?? '').split('-')[0]?.match(/^(\d{1,2}):(\d{2})$/);
  return clampParts({
    year: Number(dm[1]),
    month: Number(dm[2]),
    day: Number(dm[3]),
    hour: tm ? Number(tm[1]) : 0,
    minute: tm ? Number(tm[2]) : 0,
  });
}

// 表示用 "YYYY/MM/DD HH:mm"
export function formatDisplay(v: DateTimeValue): string {
  return `${v.year}/${pad(v.month)}/${pad(v.day)} ${pad(v.hour)}:${pad(v.minute)}`;
}
