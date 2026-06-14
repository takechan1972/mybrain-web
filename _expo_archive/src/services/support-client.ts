/**
 * 契約・サポート用のAPIクライアント。
 *
 * 運営API（ai-iphone-backend）の /support/* を呼ぶ。
 * - APIキー・token・password・Bearer は送らない／保存しない
 * - AIチャット本文・メモ本文・ログ全文は自動添付しない
 * - 送るのはユーザーがフォームに入力した内容のみ
 * - すべて例外安全（アプリを落とさない）。エンベロープ {ok,data}/{ok:false,message} を解釈
 */

import { MSG_NOT_CONFIGURED, supportUrl } from '@/config/api';

const TIMEOUT_MS = 15000;

export interface SupportCategoryOption {
  key: 'usage' | 'billing' | 'bug' | 'ai' | 'other';
  label: string;
}

export const SUPPORT_CATEGORIES: SupportCategoryOption[] = [
  { key: 'usage', label: '使い方について' },
  { key: 'billing', label: '契約・料金について' },
  { key: 'bug', label: '不具合について' },
  { key: 'ai', label: 'AI回答について' },
  { key: 'other', label: 'その他' },
];

export interface CancelReasonOption {
  key:
    | 'not_used'
    | 'price'
    | 'difficult'
    | 'missing_feature'
    | 'other_service'
    | 'pause'
    | 'other';
  label: string;
}

export const CANCEL_REASONS: CancelReasonOption[] = [
  { key: 'not_used', label: '使わなくなった' },
  { key: 'price', label: '料金が合わない' },
  { key: 'difficult', label: '使い方が難しい' },
  { key: 'missing_feature', label: '必要な機能が足りない' },
  { key: 'other_service', label: '他サービスを使うため' },
  { key: 'pause', label: '一時的に停止したい' },
  { key: 'other', label: 'その他' },
];

export interface SubmitResult {
  ok: boolean;
  requestId?: string;
  createdAt?: string;
  message?: string;
  rateLimited?: boolean;
}

// 表示用の定型文言
export const MSG_RATE_LIMITED =
  '短時間に送信が集中しています。少し時間をおいて再度お試しください。';
export const MSG_NETWORK_FAIL =
  '送信できませんでした。通信状況を確認して、もう一度お試しください。';
export const MSG_SERVER_ERROR =
  '受付処理中に問題が発生しました。時間をおいて再度お試しください。';

export interface SupportLinks {
  termsUrl: string;
  privacyUrl: string;
  tokushohoUrl: string;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

async function postJson(url: string, body: unknown): Promise<SubmitResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // 応答が読めない：レート制限(429)なら専用文言、それ以外はサーバーエラー文言
      if (res.status === 429) return { ok: false, message: MSG_RATE_LIMITED, rateLimited: true };
      return { ok: false, message: MSG_SERVER_ERROR };
    }
    const env = asObject(data);
    if (!env) return { ok: false, message: MSG_SERVER_ERROR };

    // レート制限：HTTP 429 または rateLimited フラグ
    if (res.status === 429 || env.rateLimited === true) {
      return { ok: false, message: MSG_RATE_LIMITED, rateLimited: true };
    }
    if (env.ok === false) {
      // バリデーション等のメッセージはサーバー文言をそのまま表示（秘密情報は含まない）
      return { ok: false, message: typeof env.message === 'string' ? env.message : MSG_SERVER_ERROR };
    }
    const d = asObject(env.data);
    return {
      ok: true,
      requestId: d && typeof d.requestId === 'string' ? d.requestId : undefined,
      createdAt: d && typeof d.createdAt === 'string' ? d.createdAt : undefined,
    };
  } catch (e) {
    clearTimeout(timer);
    // タイムアウト・接続失敗はいずれも通信エラー文言に統一
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, message: MSG_NETWORK_FAIL };
    }
    return { ok: false, message: MSG_NETWORK_FAIL };
  }
}

export interface ContactInput {
  name: string;
  email: string;
  category: SupportCategoryOption['key'];
  subject: string;
  message: string;
}

export async function submitContact(
  input: ContactInput,
  backendEndpoint?: string,
): Promise<SubmitResult> {
  const r = supportUrl('/support/contact', backendEndpoint);
  if (!r.url) return { ok: false, message: r.error ?? MSG_NOT_CONFIGURED };
  return postJson(r.url, input);
}

export interface CancelInput {
  name: string;
  email: string;
  planType: string;
  desiredCancelDate: string;
  reason: CancelReasonOption['key'];
  detail: string;
  acknowledged: boolean;
}

export async function submitCancel(
  input: CancelInput,
  backendEndpoint?: string,
): Promise<SubmitResult> {
  const r = supportUrl('/support/cancel-request', backendEndpoint);
  if (!r.url) return { ok: false, message: r.error ?? MSG_NOT_CONFIGURED };
  return postJson(r.url, input);
}

export async function fetchSupportLinks(backendEndpoint?: string): Promise<SupportLinks> {
  const empty: SupportLinks = { termsUrl: '', privacyUrl: '', tokushohoUrl: '' };
  const r = supportUrl('/support/links', backendEndpoint);
  if (!r.url) return empty;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(r.url, { signal: controller.signal });
    clearTimeout(timer);
    const data: unknown = await res.json().catch(() => null);
    const env = asObject(data);
    const d = env ? asObject(env.data) : null;
    if (!d) return empty;
    return {
      termsUrl: typeof d.termsUrl === 'string' ? d.termsUrl : '',
      privacyUrl: typeof d.privacyUrl === 'string' ? d.privacyUrl : '',
      tokushohoUrl: typeof d.tokushohoUrl === 'string' ? d.tokushohoUrl : '',
    };
  } catch {
    clearTimeout(timer);
    return empty;
  }
}

// 受付完了の日時表示用
export function formatReceiptTime(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
