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
  /** 運営が返信した日時（epoch ms）。未返信なら null */
  repliedAt: number | null;
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
  replied_at?: string | null;
  created_at: string | null;
}

function toMs(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function mapInquiry(r: InquiryRow): ContactInquiry {
  const repliedMs = r.replied_at ? toMs(r.replied_at) : 0;
  return {
    id: r.id,
    category: r.inquiry_category ?? '',
    message: r.inquiry_message ?? '',
    imageFilename: r.attached_image_filename,
    status: r.status ?? '未対応',
    replyStatus: r.reply_status ?? '未対応',
    adminReply: r.admin_reply,
    repliedAt: repliedMs > 0 ? repliedMs : null,
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
    .select('id, inquiry_category, inquiry_message, attached_image_filename, status, reply_status, admin_reply, replied_at, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false });

  if (error) return { inquiries: [], error: formatError(error, 'お問い合わせ履歴の取得に失敗しました。') };
  return { inquiries: (data as InquiryRow[]).map(mapInquiry), error: null };
}

// ── 管理者用：全件取得（ユーザー名・メール含む） ──────────────────

/** 管理画面表示用のお問い合わせ1件（ユーザー名・メール・AI返信案を含む） */
export interface AdminInquiry extends ContactInquiry {
  userName: string;
  userEmail: string;
  /** AIが作成した返信案（管理者のみ参照・編集前の下書き） */
  aiDraftReply: string | null;
}

export interface ListAdminInquiriesResult {
  inquiries: AdminInquiry[];
  error: string | null;
}

interface AdminInquiryRow extends InquiryRow {
  user_name: string | null;
  user_email: string | null;
  ai_draft_reply: string | null;
}

// 管理者取得用の select 列（ai_draft_reply を含む・各所で共通利用）
const ADMIN_SELECT =
  'id, user_name, user_email, inquiry_category, inquiry_message, attached_image_filename, status, reply_status, admin_reply, ai_draft_reply, created_at';

function mapAdminInquiry(r: AdminInquiryRow): AdminInquiry {
  return {
    ...mapInquiry(r),
    userName: r.user_name ?? '',
    userEmail: r.user_email ?? '',
    aiDraftReply: r.ai_draft_reply ?? null,
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
    .select(ADMIN_SELECT)
    .order('created_at', { ascending: false });

  if (error) return { inquiries: [], error: formatError(error, 'お問い合わせの取得に失敗しました。') };
  return { inquiries: (data as AdminInquiryRow[]).map(mapAdminInquiry), error: null };
}

export interface SaveReplyResult {
  ok: boolean;
  error: string | null;
  inquiry: AdminInquiry | null;
}

/**
 * 管理者：お問い合わせに返信を保存する。
 * - admin_reply を更新し、reply_status='返信済み' / status='対応済み' / replied_at=現在時刻 / replied_by=管理者ユーザーID を設定。
 * - 実際に更新できるのは Supabase の RLS（管理者 update ポリシー）により許可メールのみ。
 * - メール送信・AI返信案生成は行わない（保存のみ）。
 */
export async function saveAdminReply(id: string, reply: string): Promise<SaveReplyResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: 'Supabaseが未設定です（.env.local を確認してください）。', inquiry: null };

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr) {
    console.error('[contact] getUser error:', userErr);
    return { ok: false, error: '返信の保存にはログインが必要です。', inquiry: null };
  }
  const uid = userData.user?.id;
  if (!uid) return { ok: false, error: '返信の保存にはログインが必要です。', inquiry: null };

  const { data, error } = await sb
    .from('contact_inquiries')
    .update({
      admin_reply: reply,
      reply_status: '返信済み',
      status: '対応済み',
      replied_at: new Date().toISOString(),
      replied_by: uid,
    })
    .eq('id', id)
    .select(ADMIN_SELECT)
    .single();

  if (error) return { ok: false, error: formatError(error, '返信の保存に失敗しました。'), inquiry: null };
  return { ok: true, error: null, inquiry: mapAdminInquiry(data as AdminInquiryRow) };
}

/**
 * 管理者：AI返信案（ai_draft_reply）を保存する。
 * - admin_reply / status / reply_status は変更しない（あくまで下書きの保存）。
 * - 実際に更新できるのは Supabase の RLS（管理者 update ポリシー）により許可メールのみ。
 */
export async function saveAiDraftReply(id: string, draft: string): Promise<SaveReplyResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: 'Supabaseが未設定です（.env.local を確認してください）。', inquiry: null };

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr) {
    console.error('[contact] getUser error:', userErr);
    return { ok: false, error: 'AI返信案の保存にはログインが必要です。', inquiry: null };
  }
  if (!userData.user?.id) return { ok: false, error: 'AI返信案の保存にはログインが必要です。', inquiry: null };

  const { data, error } = await sb
    .from('contact_inquiries')
    .update({ ai_draft_reply: draft })
    .eq('id', id)
    .select(ADMIN_SELECT)
    .single();

  if (error) return { ok: false, error: formatError(error, 'AI返信案の保存に失敗しました。'), inquiry: null };
  return { ok: true, error: null, inquiry: mapAdminInquiry(data as AdminInquiryRow) };
}

/**
 * お問い合わせ内容から返信案（下書き）を生成する。
 *
 * いまはローカルの簡易テンプレート生成。将来 OpenAI 等の API に差し替えやすいよう、
 * この関数のシグネチャ（入力 → Promise<返信案文字列>）を保ったまま中身だけ置き換えればよい。
 * AIは送信せず、案を作るだけ（最終送信は管理者が「返信を保存」で行う）。
 */
export interface ReplyDraftInput {
  userName: string;
  category: string;
  message: string;
  replyStatus: string;
}

export async function generateInquiryReplyDraft(input: ReplyDraftInput): Promise<string> {
  // 将来の API 接続を見据えて非同期。簡易生成のため軽い待機を入れる（UIの「作成中…」を活かす）。
  await new Promise((r) => setTimeout(r, 350));

  const name = (input.userName || '').trim();
  const nameLine = name ? `${name} 様` : 'お客様';
  const category = (input.category || '').trim();
  const message = (input.message || '').trim();
  const snippet = message.length > 60 ? `${message.slice(0, 60)}…` : message;

  const topic = /解約/.test(category)
    ? '解約に関するお手続き'
    : /プラン/.test(category)
    ? 'プランに関するご質問'
    : /アプリ/.test(category)
    ? 'アプリのご利用に関するお問い合わせ'
    : 'お問い合わせ';

  const lines: string[] = [
    `${nameLine}`,
    '',
    'いつもMyBrainをご利用いただき、誠にありがとうございます。',
    `このたびは${topic}をいただき、ありがとうございます。`,
  ];
  if (snippet) {
    lines.push('', `いただいた内容（「${snippet}」）について確認いたしました。`);
  }
  lines.push(
    '',
    'お手数ですが、より正確にご案内するため、ご不明な点や詳しい状況がございましたら、あわせてお知らせいただけますと幸いです。',
    '',
    '必要に応じて、追加でご連絡ください。',
    '',
    'MyBrain運営',
  );
  return lines.join('\n');
}
