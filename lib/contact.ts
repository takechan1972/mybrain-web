import { getSupabaseBrowserClient } from './supabase/client';

/**
 * お問い合わせ保存（Supabase版）。
 * - ブラウザクライアント経由。RLS により「自分の行」だけ insert / select 可能。
 * - insert 時は user_id を明示（auth.getUser() の user.id）。
 * - 画像本体のアップロードは未対応（ファイル名のみ保存）。
 * - エラーは握りつぶさず画面表示用の文字列にして返す（console.error にも出力）。
 */

export interface ContactInquiryInput {
  /** 登録者氏名（account-store） */
  userName: string;
  /** 登録メールアドレス */
  userEmail: string;
  /** お問い合わせ項目 */
  category: string;
  /** お問い合わせ内容 */
  message: string;
  /** 添付画像のファイル名（任意・本体は未保存） */
  imageFilename: string | null;
}

export interface ContactSaveResult {
  ok: boolean;
  error: string | null;
}

type SupaError = { message?: string; code?: string; details?: string; hint?: string } | null;

function formatError(error: SupaError, fallback: string): string {
  if (!error) return fallback;
  console.error('[contact] Supabase error:', error);
  const parts = [error.message, error.code ? `code=${error.code}` : '', error.details ?? '', error.hint ?? '']
    .filter((s) => s && s.length > 0);
  return parts.length > 0 ? parts.join(' / ') : fallback;
}

/**
 * お問い合わせを contact_inquiries テーブルへ保存する。
 * status / reply_status は '未対応'、各返信系は null、フラグは false で初期化する。
 */
export async function createContactInquiry(input: ContactInquiryInput): Promise<ContactSaveResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: 'Supabaseが未設定です（.env.local を確認してください）。' };

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr) {
    console.error('[contact] getUser error:', userErr);
    return { ok: false, error: 'お問い合わせの送信にはログインが必要です。' };
  }
  const uid = userData.user?.id;
  if (!uid) return { ok: false, error: 'お問い合わせの送信にはログインが必要です。' };

  const { error } = await sb.from('contact_inquiries').insert({
    user_id: uid,
    user_name: input.userName,
    user_email: input.userEmail,
    inquiry_category: input.category,
    inquiry_message: input.message,
    attached_image_filename: input.imageFilename,
    status: '未対応',
    created_at: new Date().toISOString(),
    ai_draft_reply: null,
    admin_reply: null,
    reply_status: '未対応',
    replied_at: null,
    replied_by: null,
    is_sent: false,
    is_knowledge_candidate: false,
  });

  if (error) {
    return { ok: false, error: formatError(error, 'お問い合わせの送信に失敗しました。時間をおいて再度お試しください。') };
  }
  return { ok: true, error: null };
}

// ── お問い合わせ履歴（本人分のみ取得） ──────────────────────────

/** 画面表示用に整形したお問い合わせ1件 */
export interface ContactInquiry {
  id: string;
  category: string;
  message: string;
  imageFilename: string | null;
  status: string;
  replyStatus: string;
  adminReply: string | null;
  /** 作成日時（epoch ms） */
  createdAt: number;
}

export interface ListInquiriesResult {
  inquiries: ContactInquiry[];
  error: string | null;
}

interface InquiryRow {
  id: string;
  inquiry_category: string | null;
  inquiry_message: string | null;
  attached_image_filename: string | null;
  status: string | null;
  reply_status: string | null;
  admin_reply: string | null;
  created_at: string | null;
}

function toMs(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function mapInquiry(r: InquiryRow): ContactInquiry {
  return {
    id: r.id,
    category: r.inquiry_category ?? '',
    message: r.inquiry_message ?? '',
    imageFilename: r.attached_image_filename,
    status: r.status ?? '未対応',
    replyStatus: r.reply_status ?? '未対応',
    adminReply: r.admin_reply,
    createdAt: toMs(r.created_at),
  };
}

/**
 * ログイン中ユーザー本人のお問い合わせ履歴を取得する（新しい順）。
 * - RLS により本人の行のみ select 可能。加えて user_id でも明示的に絞り込む（多重防御）。
 * - 他ユーザーのお問い合わせは取得しない。
 */
export async function listMyInquiries(): Promise<ListInquiriesResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { inquiries: [], error: 'Supabaseが未設定です（.env.local を確認してください）。' };

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr) {
    console.error('[contact] getUser error:', userErr);
    return { inquiries: [], error: 'お問い合わせ履歴の表示にはログインが必要です。' };
  }
  const uid = userData.user?.id;
  if (!uid) return { inquiries: [], error: 'お問い合わせ履歴の表示にはログインが必要です。' };

  const { data, error } = await sb
    .from('contact_inquiries')
    .select('id, inquiry_category, inquiry_message, attached_image_filename, status, reply_status, admin_reply, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false });

  if (error) return { inquiries: [], error: formatError(error, 'お問い合わせ履歴の取得に失敗しました。') };
  return { inquiries: (data as InquiryRow[]).map(mapInquiry), error: null };
}

// ── 管理者用：全件取得（ユーザー名・メール含む） ──────────────────

/** 管理画面表示用のお問い合わせ1件（ユーザー名・メールを含む） */
export interface AdminInquiry extends ContactInquiry {
  userName: string;
  userEmail: string;
}

export interface ListAdminInquiriesResult {
  inquiries: AdminInquiry[];
  error: string | null;
}

interface AdminInquiryRow extends InquiryRow {
  user_name: string | null;
  user_email: string | null;
}

function mapAdminInquiry(r: AdminInquiryRow): AdminInquiry {
  return {
    ...mapInquiry(r),
    userName: r.user_name ?? '',
    userEmail: r.user_email ?? '',
  };
}

/**
 * 管理者用：お問い合わせを全件取得する（新しい順）。
 * - 取得可否は Supabase の RLS（管理者＝許可メールの select ポリシー）で制御される。
 * - 非管理者が呼んでも、RLS により自分の行しか返らない（画面側でも管理者判定で出し分ける）。
 */
export async function listAllInquiriesForAdmin(): Promise<ListAdminInquiriesResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { inquiries: [], error: 'Supabaseが未設定です（.env.local を確認してください）。' };

  const { data, error } = await sb
    .from('contact_inquiries')
    .select(
      'id, user_name, user_email, inquiry_category, inquiry_message, attached_image_filename, status, reply_status, admin_reply, created_at',
    )
    .order('created_at', { ascending: false });

  if (error) return { inquiries: [], error: formatError(error, 'お問い合わせの取得に失敗しました。') };
  return { inquiries: (data as AdminInquiryRow[]).map(mapAdminInquiry), error: null };
}
