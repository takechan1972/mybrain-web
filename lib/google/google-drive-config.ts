/**
 * Google Drive 連携の公開設定チェック（最小ユーティリティ・能力検出のみ）。
 *
 * - 将来の「Google Drive への Markdown 書き出し」の土台。ここでは OAuth を始めない・API も呼ばない。
 * - 読むのは公開前提の NEXT_PUBLIC_ 値のみ。サーバ専用の秘密（クライアントシークレット等）は読まない。
 * - NEXT_PUBLIC_ は静的参照で書く（ビルド時インライン化のため。Supabase 設定と同じ流儀）。
 * - 設計方針：docs/google-drive-markdown-export-design.md
 */

/** Google Drive 連携設定の状態。 */
export type GoogleDriveConfigStatus = 'configured' | 'missing-client-id' | 'disabled';

/**
 * 公開用の Google Drive クライアント ID を返す（未設定なら undefined）。
 * - 公開前提の値のみ。秘密鍵・シークレットはここでは扱わない。
 */
export function getGoogleDriveClientId(): string | undefined {
  return process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID || undefined;
}

/**
 * Google Drive 連携を明示的に無効化しているか。
 * - NEXT_PUBLIC_GOOGLE_DRIVE_ENABLED='false' のときだけ無効とみなす（既定は有効扱い）。
 */
function isExplicitlyDisabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_DRIVE_ENABLED === 'false';
}

/**
 * Google Drive 連携の設定状態を返す。
 * - 'disabled'：明示的に無効化されている。
 * - 'missing-client-id'：クライアント ID が無い（連携不可）。
 * - 'configured'：必要な公開設定が揃っている。
 */
export function getGoogleDriveConfigStatus(): GoogleDriveConfigStatus {
  if (isExplicitlyDisabled()) return 'disabled';
  if (!getGoogleDriveClientId()) return 'missing-client-id';
  return 'configured';
}

/**
 * Google Drive 連携に必要な公開設定が揃っているか。
 * - クライアント ID が無い／無効化されている場合は false。
 * - OAuth 開始・API 呼び出しはしない（設定の有無を返すだけ）。
 */
export function isGoogleDriveConfigured(): boolean {
  return getGoogleDriveConfigStatus() === 'configured';
}
