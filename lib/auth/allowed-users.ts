/**
 * 特別扱いするアカウント（運営・家族）の集中管理。
 *
 * - メールのハードコードを各所に散らさず、ここ1か所に集約する。
 * - 比較は必ず正規化（trim ＋ 小文字化）してから行う。
 * - 管理画面は運営（ADMIN）のみ。家族（FAMILY）は通常機能をフル利用できるが、管理画面には入れない。
 * - 公開UIにこれらのメールを露出しない（ここは内部判定用）。
 */

/** 運営（管理者）。管理画面・管理操作はこのアカウントのみ。 */
export const ADMIN_EMAILS = ['designat5take@gmail.com'] as const;

/** 家族。通常機能をフル利用できる（管理画面は除く）。 */
export const FAMILY_EMAILS = ['kero24keroyon@gmail.com'] as const;

/** 全機能（有料相当）をフル利用できるアカウント（運営＋家族）。 */
export const FULL_ACCESS_EMAILS = ['designat5take@gmail.com', 'kero24keroyon@gmail.com'] as const;

/** メール比較用の正規化（前後空白除去＋小文字化）。null/undefined は空文字。 */
function normalizeEmail(email?: string | null): string {
  return (email ?? '').trim().toLowerCase();
}

/** 運営（管理者）メールか。 */
export function isAdminEmail(email?: string | null): boolean {
  const e = normalizeEmail(email);
  return e.length > 0 && ADMIN_EMAILS.some((a) => a.toLowerCase() === e);
}

/** 家族メールか。 */
export function isFamilyEmail(email?: string | null): boolean {
  const e = normalizeEmail(email);
  return e.length > 0 && FAMILY_EMAILS.some((a) => a.toLowerCase() === e);
}

/** 全機能フルアクセス対象（運営＋家族）か。 */
export function hasFullAccess(email?: string | null): boolean {
  const e = normalizeEmail(email);
  return e.length > 0 && FULL_ACCESS_EMAILS.some((a) => a.toLowerCase() === e);
}
