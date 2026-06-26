/**
 * Google Drive 経由の Obsidian Markdown エクスポート戦略（設計メモ・ドキュメントのみ）。
 *
 * このファイルは「将来どうやって Google Drive 上の Obsidian Vault へメモを出すか」を整理した内部ノートです。
 * - 実装はまだしない。runtime の副作用なし・ブラウザ API 呼び出しなし・OAuth/トークン処理なし。
 * - どこからも import しない（純粋なドキュメント置き場）。
 * - 現状の保存挙動は不変（MyBrain/Supabase が source of truth）。
 *
 * 各設計トピックは定数として export しておき、将来実装時の参照・分岐キーに使えるようにする。
 */

/** Google Drive エクスポートの設計トピック識別子。 */
export type GoogleDriveObsidianExportTopic =
  | 'google-auth-consent'
  | 'drive-folder-selection'
  | 'one-way-export'
  | 'conflict-avoidance'
  | 'token-handling'
  | 'mobile-support'
  | 'future-sync';

/**
 * google-auth-consent：ユーザーが明示的に Google Drive を接続する。
 * - 黙ってつながない。専用の接続画面でユーザーの同意を得てから。
 */
export const TOPIC_GOOGLE_AUTH_CONSENT: GoogleDriveObsidianExportTopic = 'google-auth-consent';

/**
 * drive-folder-selection：ユーザーが Obsidian エクスポート用フォルダを選ぶ／作る。
 * - 既存 Vault フォルダを選ぶか、新規に作るかを選べるようにする。
 */
export const TOPIC_DRIVE_FOLDER_SELECTION: GoogleDriveObsidianExportTopic = 'drive-folder-selection';

/**
 * one-way-export：まず MyBrain から Drive への一方向エクスポートにする。
 * - Drive 側の変更を取り込む双方向同期は最初はやらない。
 */
export const TOPIC_ONE_WAY_EXPORT: GoogleDriveObsidianExportTopic = 'one-way-export';

/**
 * conflict-avoidance：既存ファイルを自動で上書きしない。
 * - 同名があれば確認・別名保存などで衝突を避ける（自動上書き禁止）。
 */
export const TOPIC_CONFLICT_AVOIDANCE: GoogleDriveObsidianExportTopic = 'conflict-avoidance';

/**
 * token-handling：トークン処理は後で慎重に設計する。
 * - 保存場所・有効期限・更新・失効を含め安全性を最優先で設計する。
 */
export const TOPIC_TOKEN_HANDLING: GoogleDriveObsidianExportTopic = 'token-handling';

/**
 * mobile-support：iPhone / iPad のブラウザ挙動を考慮する。
 * - Safari の制限（ポップアップ・リダイレクト・ファイル保存）を前提に設計する。
 */
export const TOPIC_MOBILE_SUPPORT: GoogleDriveObsidianExportTopic = 'mobile-support';

/**
 * future-sync：双方向同期は MVP に含めない。
 * - 一方向エクスポートが安定してから初めて検討する。
 */
export const TOPIC_FUTURE_SYNC: GoogleDriveObsidianExportTopic = 'future-sync';

/**
 * 推奨する MVP の進め方（順序）。
 *
 * 1. 現在の手動コピー / ダウンロードを安定維持する。
 * 2. Supabase を source of truth として維持する。
 * 3. 明示的な Google Drive 接続画面を後で追加する。
 * 4. フォルダ選択を後で追加する。
 * 5. 選んだ Drive フォルダへ Markdown を一方向エクスポートする。
 * 6. 自動上書きを避ける。
 * 7. 双方向同期は一方向エクスポートが安定してから検討する。
 */
export const GOOGLE_DRIVE_EXPORT_MVP_ORDER = [
  'Keep current manual copy/download stable.',
  'Keep Supabase as source of truth.',
  'Add explicit Google Drive connection screen later.',
  'Add folder selection later.',
  'Export Markdown one-way to selected Drive folder.',
  'Avoid automatic overwrite.',
  'Consider two-way sync only after one-way export is stable.',
] as const;

/**
 * 実装時の注意（必ず守る前提）。
 *
 * - 最初から広い Drive 権限を要求しない。
 * - ユーザー操作なしに黙ってアップロードしない。
 * - 既存の Obsidian ファイルを自動で上書きしない。
 * - Google Drive をまだ source of truth として扱わない。
 * - 最初のバージョンで双方向同期を実装しない。
 * - トークンを安全でない方法で保存しない。
 */
export const GOOGLE_DRIVE_EXPORT_WARNINGS = [
  'Do not request broad Drive permissions initially.',
  'Do not silently upload files without user action.',
  'Do not overwrite existing Obsidian files automatically.',
  'Do not treat Google Drive as the source of truth yet.',
  'Do not implement two-way sync in the first version.',
  'Do not store tokens insecurely.',
] as const;
