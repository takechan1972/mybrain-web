import { getSupabaseBrowserClient } from './supabase/client';
import type { Reservation, ReservationInput } from './types';

/**
 * 予定CRUD（Supabase版）。
 * - ブラウザクライアント経由。RLSにより「自分の行」だけ読み書き可能。
 * - insert時は user_id を明示（auth.getUser() の user.id）。
 * - エラーは握りつぶさず画面表示用の文字列にして返す（console.error にも出力）。
 */

interface ReservationRow {
  id: string;
  title: string | null;
  content: string | null;
  schedule_at: string | null;
  // 新カラム（マイグレーション適用後に存在。古い行では undefined/null になり得る）
  start_at?: string | null;
  end_at?: string | null;
  all_day?: boolean | null;
  notification_enabled: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

type SupaError = { message?: string; code?: string; details?: string; hint?: string } | null;

function formatError(error: SupaError, fallback: string): string {
  if (!error) return fallback;
  console.error('[reservations] Supabase error:', error);
  const parts = [error.message, error.code ? `code=${error.code}` : '', error.details ?? '', error.hint ?? '']
    .filter((s) => s && s.length > 0);
  return parts.length > 0 ? parts.join(' / ') : fallback;
}

function toMs(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function mapRow(r: ReservationRow): Reservation {
  // 開始日時：新カラム start_at を優先し、無ければ旧 schedule_at にフォールバック（後方互換）
  const startAt = r.start_at ? toMs(r.start_at) : r.schedule_at ? toMs(r.schedule_at) : null;
  const endAt = r.end_at ? toMs(r.end_at) : null;
  return {
    id: r.id,
    title: r.title ?? '',
    content: r.content ?? '',
    startAt,
    endAt,
    allDay: r.all_day ?? false,
    // 互換：scheduleAt は開始日時と同値にしておく（既存の表示・相談ロジックがそのまま動く）
    scheduleAt: startAt,
    notificationEnabled: r.notification_enabled ?? false,
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
  };
}

/** ReservationInput から保存用の開始日時(ms)を求める（startAt 優先、無ければ scheduleAt 互換） */
function resolveStartMs(input: ReservationInput): number | null {
  if (input.startAt !== undefined) return input.startAt;
  return input.scheduleAt ?? null;
}

/** 予定日時(ms) → ISO文字列（null可） */
function scheduleToIso(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

export interface ListResult {
  reservations: Reservation[];
  error: string | null;
}
export interface ReservationResult {
  reservation: Reservation | null;
  error: string | null;
}
export interface DeleteResult {
  ok: boolean;
  error: string | null;
}

/** 一覧（予定日時の昇順。null は末尾） */
export async function listReservations(): Promise<ListResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { reservations: [], error: 'Supabaseが未設定です（.env.local を確認してください）。' };
  const { data, error } = await sb
    .from('reservations')
    .select('*')
    .order('schedule_at', { ascending: true, nullsFirst: false });
  if (error) return { reservations: [], error: formatError(error, '一覧の取得に失敗しました。') };
  return { reservations: (data as ReservationRow[]).map(mapRow), error: null };
}

export async function getReservation(id: string): Promise<ReservationResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { reservation: null, error: 'Supabaseが未設定です。' };
  const { data, error } = await sb.from('reservations').select('*').eq('id', id).maybeSingle();
  if (error) return { reservation: null, error: formatError(error, '予定の取得に失敗しました。') };
  return { reservation: data ? mapRow(data as ReservationRow) : null, error: null };
}

export async function createReservation(input: ReservationInput): Promise<ReservationResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { reservation: null, error: 'Supabaseが未設定です。' };

  const { data: userData, error: userErr } = await sb.auth.getUser();
  const isDev = process.env.NODE_ENV !== 'production';
  if (userErr) {
    if (isDev) console.error('[reservations] getUser error:', userErr);
    return { reservation: null, error: '予定を保存するにはログインが必要です。' };
  }
  const uid = userData.user?.id;
  if (isDev) console.log('[reservations] createReservation: current user id exists =', Boolean(uid));
  if (!uid) return { reservation: null, error: '予定を保存するにはログインが必要です。' };

  const startMs = resolveStartMs(input);
  const startIso = scheduleToIso(startMs);
  const endIso = scheduleToIso(input.endAt ?? null);
  const allDay = input.allDay ?? false;
  if (isDev) {
    console.log('[reservations] insert payload:', {
      titleLength: input.title.trim().length,
      startIso,
      endIso,
      allDay,
      notify: input.notificationEnabled,
    });
  }

  const { data, error } = await sb
    .from('reservations')
    .insert({
      user_id: uid,
      title: input.title.trim() || '無題の予定',
      content: input.content.trim(),
      start_at: startIso,
      end_at: endIso,
      all_day: allDay,
      // 互換：旧カラム schedule_at にも開始日時を保存（旧コード/表示が参照しても整合する）
      schedule_at: startIso,
      notification_enabled: input.notificationEnabled,
    })
    .select('*')
    .single();
  if (error) {
    if (isDev) console.error('[reservations] insert failed:', error);
    return { reservation: null, error: formatError(error, '予定の保存に失敗しました。入力内容とログイン状態を確認してください。') };
  }
  if (isDev) console.log('[reservations] insert ok, id =', (data as ReservationRow)?.id);
  return { reservation: mapRow(data as ReservationRow), error: null };
}

export async function updateReservation(id: string, input: ReservationInput): Promise<ReservationResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { reservation: null, error: 'Supabaseが未設定です。' };
  const startIso = scheduleToIso(resolveStartMs(input));
  // 指定された項目だけ更新する（endAt/allDay 未指定の呼び出しで既存値を消さない）
  const payload: Record<string, unknown> = {
    title: input.title.trim() || '無題の予定',
    content: input.content.trim(),
    start_at: startIso,
    schedule_at: startIso, // 互換
    notification_enabled: input.notificationEnabled,
    updated_at: new Date().toISOString(),
  };
  if (input.endAt !== undefined) payload.end_at = scheduleToIso(input.endAt);
  if (input.allDay !== undefined) payload.all_day = input.allDay;

  const { data, error } = await sb
    .from('reservations')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return { reservation: null, error: formatError(error, '更新に失敗しました。') };
  return { reservation: mapRow(data as ReservationRow), error: null };
}

export async function deleteReservation(id: string): Promise<DeleteResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: 'Supabaseが未設定です。' };
  const { error } = await sb.from('reservations').delete().eq('id', id);
  if (error) return { ok: false, error: formatError(error, '削除に失敗しました。') };
  return { ok: true, error: null };
}

// ── 日時 <-> datetime-local 文字列の変換ヘルパー（フォーム用） ──────────────

/** epoch ms → "YYYY-MM-DDTHH:mm"（<input type="datetime-local"> 用・ローカル時刻） */
export function msToLocalInput(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" → epoch ms（空は null） */
export function localInputToMs(value: string): number | null {
  const v = value.trim();
  if (v.length === 0) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 予定日時の表示（未設定は「日時未設定」） */
export function formatSchedule(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '日時未設定';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 日付のみ（終日表示用） */
function formatDateOnly(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

/**
 * 予定の開始〜終了・終日を考慮した表示文字列。
 * - 終日：開始日（＋終了日が別日なら範囲）＋「終日」
 * - 通常：開始日時（＋終了日時があれば「〜」で連結）
 * - 後方互換：startAt が無ければ scheduleAt を使う
 */
export function formatReservationWhen(r: Reservation): string {
  const start = r.startAt ?? r.scheduleAt;
  if (start === null || !Number.isFinite(start)) return '日時未設定';
  if (r.allDay) {
    if (r.endAt && formatDateOnly(r.endAt) !== formatDateOnly(start)) {
      return `${formatDateOnly(start)} 〜 ${formatDateOnly(r.endAt)}（終日）`;
    }
    return `${formatDateOnly(start)}（終日）`;
  }
  if (r.endAt && Number.isFinite(r.endAt)) {
    return `${formatSchedule(start)} 〜 ${formatSchedule(r.endAt)}`;
  }
  return formatSchedule(start);
}
