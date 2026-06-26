/**
 * 複数メモの Obsidian Markdown 一括エクスポート戦略（設計メモ・ドキュメントのみ）。
 *
 * このファイルは「将来どうやって複数メモをまとめて Obsidian へ出すか」を整理した内部ノートです。
 * - 実装はまだしない。runtime の副作用なし・ブラウザ API 呼び出しなし。
 * - どこからも import しない（純粋なドキュメント置き場）。
 * - 現状の保存挙動は不変（MyBrain/Supabase が source of truth）。
 *
 * 各戦略は定数として export しておき、将来実装時の参照・分岐キーに使えるようにする。
 */

/** 一括エクスポート戦略の識別子。 */
export type ObsidianBulkExportStrategy =
  | 'single-download-current'
  | 'bulk-markdown-files'
  | 'bulk-zip-download'
  | 'google-drive-folder-export'
  | 'local-vault-export';

/**
 * 現在実装済み：1件のメモを単体でコピー / ダウンロードする。
 * - 全環境で動作。手動で Obsidian に入れる前提。
 * - この導線は今後も安定運用する（壊さない）。
 */
export const STRATEGY_SINGLE_DOWNLOAD_CURRENT: ObsidianBulkExportStrategy = 'single-download-current';

/**
 * 将来：複数の .md ファイルを1件ずつ／ブラウザのダウンロードフローでまとめて出す。
 * - 追加依存なしで実現しやすい。
 * - ただし iPhone / iPad の Safari は連続ダウンロードに制限があり、件数が多いと扱いにくい。
 */
export const STRATEGY_BULK_MARKDOWN_FILES: ObsidianBulkExportStrategy = 'bulk-markdown-files';

/**
 * 将来：複数の .md ファイルを1つの ZIP にまとめてダウンロードする。
 * - まとめて扱いやすいが、ZIP 生成ライブラリ（依存）の方針決定が前提。
 * - 依存を入れる判断をしてから着手する（このメモでは実装しない）。
 */
export const STRATEGY_BULK_ZIP_DOWNLOAD: ObsidianBulkExportStrategy = 'bulk-zip-download';

/**
 * 将来：Google Drive 上の Vault フォルダへまとめて書き出す。
 * - Google OAuth と Drive 権限が必要。デバイス間利用に向く。
 * - 手動エクスポートが安定してから着手する。
 */
export const STRATEGY_GOOGLE_DRIVE_FOLDER_EXPORT: ObsidianBulkExportStrategy = 'google-drive-folder-export';

/**
 * 将来：デスクトップのローカル Vault フォルダへまとめて書き出す。
 * - File System Access API（Chromium デスクトップ）を想定。
 * - スマホ非対応のため「デスクトップ限定の拡張」として後回し。
 */
export const STRATEGY_LOCAL_VAULT_EXPORT: ObsidianBulkExportStrategy = 'local-vault-export';

/**
 * 推奨する MVP の進め方（順序）。
 *
 * 1. 現在の「1件コピー / ダウンロード」を安定維持する。
 * 2. 「選択した複数メモの一括エクスポート」を設計してから追加する。
 * 3. ZIP は依存ライブラリの方針を決めてから採用する。
 * 4. Google Drive エクスポートは、手動エクスポートが安定してから。
 * 5. ローカル Vault エクスポートはデスクトップ限定なので後回し。
 */
export const OBSIDIAN_BULK_EXPORT_MVP_ORDER = [
  'Keep current single memo copy/download stable.',
  'Add selectable memo bulk export design later.',
  'Prefer ZIP only after deciding dependency strategy.',
  'Google Drive export comes after manual export is stable.',
  'Local vault export is desktop-only and should be later.',
] as const;

/**
 * 実装時の注意（必ず守る前提）。
 *
 * - 一括エクスポートは「まず一方向エクスポート（コピー出力）」に限定する。
 * - 初期実装で双方向同期はしない。
 * - 既存の Obsidian ファイルを自動で上書きしない。
 * - Supabase を source of truth として維持し、まだ変更しない。
 * - iPhone / iPad のブラウザ制限（連続ダウンロード・ファイル保存）を必ず考慮する。
 */
export const OBSIDIAN_BULK_EXPORT_WARNINGS = [
  'Bulk export should be one-way export first.',
  'Do not implement two-way sync initially.',
  'Do not overwrite existing Obsidian files automatically.',
  'Do not change Supabase source of truth yet.',
  'iPhone/iPad browser limitations must be considered.',
] as const;
