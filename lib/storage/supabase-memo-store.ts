import { getSupabaseBrowserClient } from '../supabase/client';
import type { Memo, MemoInput } from '../types';

/**
 * メモCRUD の Supabase 実装（保存アダプタの実体）。
 * - lib/memos.ts から verbatim 移設（振る舞いは不変）。
 * - 本ファイルは facade（lib/memos.ts）や memo-store.ts を import しない（循環回避）。
 * - ブラウザクライアント経由。RLSにより「自分の行」だけ読み書き可能。
 * - insert時は user_id を明示（auth.getUser() の user.id）。
 * - エラーは握りつぶさず、画面表示用の文字列にして返す（console.error にも出力）。
 */

interface MemoRow {
  id: string;
  title: string | null;
  body: string | null;
  tags: string[] | null;
  images: string[] | null;
  created_at: string | null;
  updated_at: string | null;
}

type SupaError = { message?: string; code?: string; details?: string; hint?: string } | null;

/** Supabaseエラーを画面表示用の文字列に整形（messageだけで終わらせない） */
function formatError(error: SupaError, fallback: string): string {
  if (!error) return fallback;
  // 詳細は console にフル出力（デバッグ用。秘密情報は含めない）
  console.error('[memos] Supabase error:', error);
  const parts = [error.message, error.code ? `code=${error.code}` : '', error.details ?? '', error.hint ?? '']
    .filter((s) => s && s.length > 0);
  return parts.length > 0 ? parts.join(' / ') : fallback;
}

function toMs(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function mapRow(r: MemoRow): Memo {
  return {
    id: r.id,
    title: r.title ?? '',
    body: r.body ?? '',
    tags: Array.isArray(r.tags) ? r.tags : [],
    images: Array.isArray(r.images) ? r.images.filter((s): s is string => typeof s === 'string') : [],
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
  };
}

export interface ListResult {
  memos: Memo[];
  error: string | null;
}
export interface MemoResult {
  memo: Memo | null;
  error: string | null;
}
export interface DeleteResult {
  ok: boolean;
  error: string | null;
}

/** 一覧（更新日時の新しい順。RLSで自分の分のみ） */
export async function listMemos(): Promise<ListResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { memos: [], error: 'Supabaseが未設定です（.env.local を確認してください）。' };
  const { data, error } = await sb.from('memos').select('*').order('updated_at', { ascending: false });
  if (error) return { memos: [], error: formatError(error, '一覧の取得に失敗しました。') };
  return { memos: (data as MemoRow[]).map(mapRow), error: null };
}

export async function getMemo(id: string): Promise<MemoResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { memo: null, error: 'Supabaseが未設定です。' };
  const { data, error } = await sb.from('memos').select('*').eq('id', id).maybeSingle();
  if (error) return { memo: null, error: formatError(error, 'メモの取得に失敗しました。') };
  return { memo: data ? mapRow(data as MemoRow) : null, error: null };
}

export async function createMemo(input: MemoInput): Promise<MemoResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { memo: null, error: 'Supabaseが未設定です。' };

  // ログイン中ユーザーを取得して user_id を明示（RLS insert チェックに一致させる）
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr) return { memo: null, error: formatError(userErr as SupaError, '認証情報を取得できませんでした。') };
  const uid = userData.user?.id;
  if (!uid) return { memo: null, error: 'ログインが必要です（セッションを取得できませんでした）。再ログインしてください。' };

  const { data, error } = await sb
    .from('memos')
    .insert({
      user_id: uid,
      title: input.title.trim() || '無題',
      body: input.body.trim(),
      tags: input.tags,
      images: input.images ?? [],
    })
    .select('*')
    .single();
  if (error) return { memo: null, error: formatError(error, '保存に失敗しました。') };
  return { memo: mapRow(data as MemoRow), error: null };
}

/** メモ取り込み（インポート）で保持するタイムスタンプ（epoch ms。正規化済みを渡す） */
export interface MemoImportTimestamps {
  createdAtMs: number;
  updatedAtMs: number;
}

/** epoch ms → ISO 文字列。無効値は挿入時刻へフォールバック（防御的。呼び出し側で正規化済みが前提） */
function importMsToIso(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date().toISOString();
}

/**
 * メモ取り込み（インポート）専用の insert（設計：docs/memo-import-design.md §8・§15）。
 *
 * - createMemo と同じ認証・user_id 明示・RLS・trim・空タイトル→「無題」の挙動。
 *   既存の createMemo は変更しない（取り込み専用の別関数として追加）。
 * - 追加で created_at / updated_at を ISO 文字列で明示する（既存カラムを使う・スキーマ変更なし）。
 * - id は渡さない＝Supabase が新しいメモIDを採番する。frontmatter の元 id は決して insert に使わない。
 * - insert のみ（更新・上書き・削除の経路は持たない）。
 * - 取り込みの保存先は保存先設定に関わらず Supabase のみのため、MemoStore アダプタ
 *   （getMemoStore()）には載せず、この関数を直接使う（設計 §14）。
 */
export async function createMemoWithTimestamps(
  input: MemoInput,
  timestamps: MemoImportTimestamps,
): Promise<MemoResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { memo: null, error: 'Supabaseが未設定です。' };

  // ログイン中ユーザーを取得して user_id を明示（RLS insert チェックに一致させる。createMemo と同じ）
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr) return { memo: null, error: formatError(userErr as SupaError, '認証情報を取得できませんでした。') };
  const uid = userData.user?.id;
  if (!uid) return { memo: null, error: 'ログインが必要です（セッションを取得できませんでした）。再ログインしてください。' };

  const { data, error } = await sb
    .from('memos')
    .insert({
      user_id: uid,
      title: input.title.trim() || '無題',
      body: input.body.trim(),
      tags: input.tags,
      images: input.images ?? [],
      created_at: importMsToIso(timestamps.createdAtMs),
      updated_at: importMsToIso(timestamps.updatedAtMs),
    })
    .select('*')
    .single();
  if (error) return { memo: null, error: formatError(error, '取り込みの保存に失敗しました。') };
  return { memo: mapRow(data as MemoRow), error: null };
}

export async function updateMemo(id: string, input: MemoInput): Promise<MemoResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { memo: null, error: 'Supabaseが未設定です。' };
  const { data, error } = await sb
    .from('memos')
    .update({
      title: input.title.trim() || '無題',
      body: input.body.trim(),
      tags: input.tags,
      images: input.images ?? [],
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return { memo: null, error: formatError(error, '更新に失敗しました。') };
  return { memo: mapRow(data as MemoRow), error: null };
}

export async function deleteMemo(id: string): Promise<DeleteResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: 'Supabaseが未設定です。' };
  const { error } = await sb.from('memos').delete().eq('id', id);
  if (error) return { ok: false, error: formatError(error, '削除に失敗しました。') };
  return { ok: true, error: null };
}
