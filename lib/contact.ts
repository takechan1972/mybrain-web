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
