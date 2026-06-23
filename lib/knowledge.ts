import { getSupabaseBrowserClient } from './supabase/client';

/**
 * Q&A / FAQ ナレッジ（chatbot_knowledge）。
 * - お問い合わせ＋管理者返信から、個人情報を除いた一般的なQ&Aを作成・保存する。
 * - 管理者（許可メール）のみ insert/select/update 可能（RLSで制御）。
 * - is_public=false（公開前提ではなく、まずは確認用として保存）。
 * - Q&A案の生成はローカル処理。将来 API へ差し替えやすいよう generateQaDraft に分離。
 */

export interface QaDraft {
  question: string;
  answer: string;
  category: string;
}

export interface QaRecord {
  id: string;
  category: string;
  question: string;
  answer: string;
  isPublic: boolean;
  sourceInquiryId: string | null;
  createdAt: number;
}

export interface QaSaveResult {
  ok: boolean;
  error: string | null;
  record: QaRecord | null;
  duplicate?: boolean;
}

export interface QaGetResult {
  record: QaRecord | null;
  error: string | null;
}

type SupaError = { message?: string; code?: string; details?: string; hint?: string } | null;

function formatError(error: SupaError, fallback: string): string {
  if (!error) return fallback;
  console.error('[knowledge] Supabase error:', error);
  const parts = [error.message, error.code ? `code=${error.code}` : '', error.details ?? '', error.hint ?? '']
    .filter((s) => s && s.length > 0);
  return parts.length > 0 ? parts.join(' / ') : fallback;
}

function toMs(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

interface KnowledgeRow {
  id: string;
  category: string | null;
  question: string | null;
  answer: string | null;
  is_public: boolean | null;
  source_inquiry_id: string | null;
  created_at: string | null;
}

function mapRow(r: KnowledgeRow): QaRecord {
  return {
    id: r.id,
    category: r.category ?? '',
    question: r.question ?? '',
    answer: r.answer ?? '',
    isPublic: r.is_public ?? false,
    sourceInquiryId: r.source_inquiry_id,
    createdAt: toMs(r.created_at),
  };
}

const KNOWLEDGE_SELECT = 'id, category, question, answer, is_public, source_inquiry_id, created_at';

// ── 個人情報・固有情報の除去／一般化 ──────────────────────────

/** メール・電話・URL・指定文字列（氏名等）を除去する */
function stripPii(text: string, extra: string[] = []): string {
  let t = text;
  t = t.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, ''); // メール
  t = t.replace(/https?:\/\/\S+/g, ''); // URL
  t = t.replace(/0\d{1,4}[-(\s]?\d{1,4}[-)\s]?\d{3,4}/g, ''); // 電話番号
  t = t.replace(/\d{3}-?\d{4}/g, ''); // 郵便番号など
  for (const e of extra) {
    const s = (e || '').trim();
    if (s.length >= 2) t = t.split(s).join('');
  }
  // 「○○様」などの宛名
  t = t.replace(/[^\s、。\n]{1,16}\s*様/g, '');
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** 一人称・契約者固有の言い回しを一般化する */
function generalizeFirstPerson(text: string): string {
  return text
    .replace(/私の契約/g, 'ご契約')
    .replace(/私たちは|私たちの/g, '')
    .replace(/私は|私が/g, '')
    .replace(/私の/g, '')
    .replace(/弊社|当方/g, '')
    .trim();
}

/** カテゴリから一般的な質問文を用意（本文から質問が作れない場合のフォールバック） */
function categoryQuestion(category: string): string {
  if (/解約/.test(category)) return '解約方法について教えてください。';
  if (/プラン/.test(category)) return 'プランについて教えてください。';
  if (/アプリ/.test(category)) return 'アプリの使い方について教えてください。';
  return 'サービスについて教えてください。';
}

/** 質問らしい語尾に整える */
function ensureQuestion(q: string): string {
  const s = q.trim().replace(/[。．]$/, '');
  if (s.length === 0) return '';
  if (/[?？か]$/.test(s)) return s;
  return `${s}について教えてください。`;
}

/** 返信から宛名・あいさつ・署名を除いて回答本文だけにする */
function cleanAnswer(text: string): string {
  const dropLine = (ln: string) => {
    const t = ln.trim();
    if (t.length === 0) return false; // 空行は段落保持のため残す（後でまとめる）
    if (/様\s*$/.test(t)) return true; // 宛名
    if (t === 'MyBrain運営') return true; // 署名
    if (/ご利用いただき/.test(t)) return true; // 定型あいさつ
    return false;
  };
  return text
    .split('\n')
    .filter((ln) => !dropLine(ln))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * お問い合わせ＋返信から Q&A 案（個人情報除去済み）を作成する。
 * 現状はローカル生成。将来 API へ差し替える場合もこのシグネチャを維持する。
 */
export async function generateInquiryQaDraft(input: {
  category: string;
  message: string;
  reply: string;
  userName: string;
}): Promise<QaDraft> {
  await new Promise((r) => setTimeout(r, 300));

  const pii = [input.userName];
  const category = (input.category || 'その他').trim();

  // 質問：本文を個人情報除去＋一般化し、先頭の一文を簡潔な質問にする
  let q = generalizeFirstPerson(stripPii(input.message, pii));
  q = (q.split(/[。\n]/).map((s) => s.trim()).filter(Boolean)[0] ?? '');
  q = q.length > 0 ? ensureQuestion(q) : categoryQuestion(category);

  // 回答：返信を個人情報除去＋宛名/署名除去＋一般化
  let a = cleanAnswer(generalizeFirstPerson(stripPii(input.reply, pii)));
  if (a.length === 0) a = '内容を確認のうえ、順次ご案内しています。ご不明な点は、お問い合わせよりご連絡ください。';

  return { question: q, answer: a, category };
}

// ── 取得・保存 ──────────────────────────

/** あるお問い合わせから既に登録済みの Q&A を取得（重複登録の判定・表示用） */
export async function getQaForInquiry(inquiryId: string): Promise<QaGetResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { record: null, error: 'Supabaseが未設定です。' };
  const { data, error } = await sb
    .from('chatbot_knowledge')
    .select(KNOWLEDGE_SELECT)
    .eq('source_inquiry_id', inquiryId)
    .maybeSingle();
  if (error) return { record: null, error: formatError(error, 'Q&Aの取得に失敗しました。') };
  return { record: data ? mapRow(data as KnowledgeRow) : null, error: null };
}

/**
 * Q&A を保存する（source_type='inquiry' / is_public=false）。
 * 同一お問い合わせからの重複は一意制約で防止し、重複時は分かりやすいエラーを返す。
 */
export async function saveQaFromInquiry(input: {
  question: string;
  answer: string;
  category: string;
  sourceInquiryId: string;
}): Promise<QaSaveResult> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: 'Supabaseが未設定です（.env.local を確認してください）。', record: null };

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData.user?.id) {
    return { ok: false, error: 'Q&Aの保存にはログインが必要です。', record: null };
  }

  const { data, error } = await sb
    .from('chatbot_knowledge')
    .insert({
      category: input.category,
      question: input.question,
      answer: input.answer,
      source_type: 'inquiry',
      source_inquiry_id: input.sourceInquiryId,
      is_public: false,
    })
    .select(KNOWLEDGE_SELECT)
    .single();

  if (error) {
    // 23505 = unique_violation（同一お問い合わせから登録済み）
    if (error.code === '23505') {
      return { ok: false, error: 'このお問い合わせは既にQ&Aに登録されています。', record: null, duplicate: true };
    }
    return { ok: false, error: formatError(error, 'Q&Aの保存に失敗しました。'), record: null };
  }
  return { ok: true, error: null, record: mapRow(data as KnowledgeRow) };
}

// ── 一覧取得・公開トグル（FAQ管理画面用） ──────────────────────

/** 登録済みQ&Aを新しい順に取得する（管理者のFAQ管理画面用）。 */
export async function listKnowledge(): Promise<{ records: QaRecord[]; error: string | null }> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { records: [], error: 'Supabaseが未設定です（.env.local を確認してください）。' };
  const { data, error } = await sb
    .from('chatbot_knowledge')
    .select(KNOWLEDGE_SELECT)
    .order('created_at', { ascending: false });
  if (error) return { records: [], error: formatError(error, 'Q&A一覧の取得に失敗しました。') };
  return { records: (data as KnowledgeRow[]).map(mapRow), error: null };
}

/**
 * 公開状態（is_public）を切り替える。
 * RLS（管理者の update ポリシー）で許可されている場合のみ成功する。
 * スキーマは変更しない（既存カラムの更新のみ）。
 */
export async function setKnowledgePublic(
  id: string,
  isPublic: boolean,
): Promise<{ ok: boolean; error: string | null; record: QaRecord | null }> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: 'Supabaseが未設定です。', record: null };
  const { data, error } = await sb
    .from('chatbot_knowledge')
    .update({ is_public: isPublic, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(KNOWLEDGE_SELECT)
    .single();
  if (error) return { ok: false, error: formatError(error, '公開状態の更新に失敗しました。'), record: null };
  return { ok: true, error: null, record: mapRow(data as KnowledgeRow) };
}

// ── 類似Q&Aの簡易判定（重複注意の表示用） ──────────────────────

/** 文字バイグラムの重なり（overlap係数）で簡易な類似度を出す（0〜1） */
function bigrams(s: string): string[] {
  const t = (s || '').replace(/\s+/g, '');
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i += 1) out.push(t.slice(i, i + 2));
  return out;
}
function similarityScore(a: string, b: string): number {
  const A = new Set(bigrams(a));
  const B = new Set(bigrams(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((x) => {
    if (B.has(x)) inter += 1;
  });
  return inter / Math.min(A.size, B.size);
}

/**
 * 似ているQ&Aを探す（簡易判定）。
 * - 同じカテゴリの既存Q&Aを取得し、質問文の文字列類似度で候補を抽出する。
 * - 自動で上書きはしない。あくまで「重複に注意」表示のための候補。
 */
export async function findSimilarQa(input: {
  category: string;
  question: string;
  excludeInquiryId?: string;
}): Promise<{ records: QaRecord[]; error: string | null }> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { records: [], error: 'Supabaseが未設定です。' };

  let q = sb.from('chatbot_knowledge').select(KNOWLEDGE_SELECT).order('created_at', { ascending: false }).limit(50);
  const category = (input.category || '').trim();
  if (category) q = q.eq('category', category);

  const { data, error } = await q;
  if (error) return { records: [], error: formatError(error, '類似Q&Aの取得に失敗しました。') };

  const records = (data as KnowledgeRow[])
    .map(mapRow)
    .filter((r) => !input.excludeInquiryId || r.sourceInquiryId !== input.excludeInquiryId)
    .map((r) => ({ r, score: similarityScore(input.question, r.question) }))
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.r);

  return { records, error: null };
}

// ── ユーザー向け：公開FAQの検索（参照カード用） ──────────────────

/**
 * 公開FAQ（is_public=true）から、質問文に近いものを上位N件返す。
 * - /consult の「関連するよくある質問」参照カード用。AIプロンプトには注入しない。
 * - RLS の公開ポリシーに加え、クエリでも is_public=true で限定（多重防御）。
 * - 既存の文字バイグラム類似度で簡易ランキング（質問文・回答文の高い方を採用）。
 */
export async function searchPublicFaq(
  query: string,
  limit = 3,
): Promise<{ records: QaRecord[]; error: string | null }> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { records: [], error: 'Supabaseが未設定です。' };

  const text = (query || '').trim();
  if (text.length === 0) return { records: [], error: null };

  const { data, error } = await sb
    .from('chatbot_knowledge')
    .select(KNOWLEDGE_SELECT)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return { records: [], error: formatError(error, '公開FAQの取得に失敗しました。') };

  const records = (data as KnowledgeRow[])
    .map(mapRow)
    .map((r) => ({ r, score: Math.max(similarityScore(text, r.question), similarityScore(text, r.answer)) }))
    .filter((x) => x.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.r);

  return { records, error: null };
}
