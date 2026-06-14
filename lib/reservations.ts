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
  return {
    id: r.id,
    title: r.title ?? '',
    content: r.content ?? '',
    scheduleAt: r.schedule_at ? toMs(r.schedule_at) : null,
    notificationEnabled: r.notification_enabled ?? false,
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
  };
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

  const scheduleIso = scheduleToIso(input.scheduleAt);
  if (isDev) {
    console.log('[reservations] insert payload:', {
      titleLength: input.title.trim().length,
      scheduleIso,
      notify: input.notificationEnabled,
    });
  }

  const { data, error } = await sb
    .from('reservations')
    .insert({
      user_id: uid,
      title: input.title.trim() || '無題の予定',
      content: input.content.trim(),
      schedule_at: scheduleIso,
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
  const { data, error } = await sb
    .from('reservations')
    .update({
      title: input.title.trim() || '無題の予定',
      content: input.content.trim(),
      schedule_at: scheduleToIso(input.scheduleAt),
      notification_enabled: input.notificationEnabled,
      updated_at: new Date().toISOString(),
    })
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
