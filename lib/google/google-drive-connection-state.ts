/**
 * Google Drive 連携の接続状態を表すスケルトン（UI 非接続・OAuth 未実装）。
 *
 * - 現状は「設定があるか」までしか判定できない。OAuth / トークン保存が未実装のため、
 *   実際に接続済みかどうか（'connected'）はまだ判定できない。
 * - ここでは OAuth を始めない・トークンを保存しない・Google API も呼ばない。
 * - 'connected' は、OAuth とトークン保存を実装したあとに、実トークン/セッションを見て返すようにする。
 * - 設計方針：docs/google-drive-markdown-export-design.md
 */

import { isGoogleDriveConfigured } from './google-drive-config';

/** Google Drive 連携の接続状態。 */
export type GoogleDriveConnectionState =
  | 'unconfigured' // 連携に必要な公開設定が無い（クライアント ID 未設定 / 無効化）
  | 'disconnected' // 設定はあるが、まだ接続（OAuth 同意）していない
  | 'connected'; // 接続済み（※OAuth / トークン保存の実装後に使う）

/** 接続状態の結果。将来トークン情報などを足せるよう object で返す。 */
export interface GoogleDriveConnectionStatus {
  state: GoogleDriveConnectionState;
}

/**
 * Google Drive 連携の現在の接続状態を返す（スケルトン）。
 *
 * - 公開設定が無い → 'unconfigured'。
 * - 設定はあるが OAuth / トークン接続が未実装 → 'disconnected'。
 * - 'connected' はまだ返さない（実トークン/セッションのソースが無いため）。
 *   OAuth とトークン保存を実装したら、ここで実際の接続有無を見て 'connected' を返す。
 */
export function getGoogleDriveConnectionState(): GoogleDriveConnectionStatus {
  if (!isGoogleDriveConfigured()) return { state: 'unconfigured' };

  // TODO(OAuth/token 実装後): 保存済みトークン/セッションを確認し、あれば 'connected' を返す。
  // 現状はトークンの保存・取得が無いため、設定済みでも未接続として扱う。
  return { state: 'disconnected' };
}
