/**
 * Google Drive OAuth 開始フローのスケルトン（UI 非接続・実 OAuth 未実装）。
 *
 * - 将来の「Google Drive への Markdown 書き出し」のための、型だけ先に用意した入口。
 * - ここでは実際の OAuth を始めない：
 *   - Google Identity Services を読み込まない。
 *   - ポップアップを開かない・リダイレクトしない。
 *   - アクセストークンを要求しない・保存しない。
 *   - Google API を呼ばない。
 * - 実装は設計メモ（docs/google-drive-markdown-export-design.md の「OAuth 同意フロー設計」）に沿って後で行う。
 *   方針：GIS トークンフロー採用、scope は drive.file、アクセストークンはメモリ保持・短命、
 *   リフレッシュトークンはブラウザに保存しない。
 */

import { isGoogleDriveConfigured } from './google-drive-config';

/** OAuth 開始の結果状態（現時点のスケルトン）。 */
export type GoogleDriveOAuthStartState =
  | 'unconfigured' // 連携に必要な公開設定が無い（クライアント ID 未設定 / 無効化）
  | 'not-implemented'; // 設定はあるが、実 OAuth はまだ未実装

/** OAuth 開始の結果。将来トークン情報などを足せるよう object で返す。 */
export interface GoogleDriveOAuthStartResult {
  state: GoogleDriveOAuthStartState;
}

/**
 * Google Drive の OAuth 同意フローを開始する（現状はスケルトン）。
 *
 * - 公開設定が無い → { state: 'unconfigured' }。
 * - 設定はあるが実 OAuth 未実装 → { state: 'not-implemented' }。
 *
 * TODO(OAuth 実装): 設計メモ「OAuth 同意フロー設計」に従い、GIS トークンフローで
 * drive.file スコープのアクセストークンを取得する。トークンはメモリ保持・短命、
 * リフレッシュトークンはブラウザに保存しない。実装するまでは 'not-implemented' を返す。
 */
export async function startGoogleDriveOAuth(): Promise<GoogleDriveOAuthStartResult> {
  if (!isGoogleDriveConfigured()) return { state: 'unconfigured' };

  // 実 OAuth はまだ実装していない（GIS 読み込み・ポップアップ・トークン取得はしない）。
  return { state: 'not-implemented' };
}
