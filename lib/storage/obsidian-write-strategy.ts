/**
 * Obsidian Vault へのメモ Markdown 書き出し戦略（設計メモ・ドキュメントのみ）。
 *
 * このファイルは「将来どうやって実ファイルを書くか」を整理した内部ノートです。
 * - 実際の書き出しは未実装。runtime の振る舞いは追加しない。
 * - どこからも import しない（純粋なドキュメント置き場）。
 * - 現状の保存挙動は不変（MyBrain/Supabase が source of truth）。
 *
 * 各戦略は定数として export しておき、将来アダプタ実装時の参照・分岐キーに使えるようにする。
 */

/** 書き出し戦略の識別子。 */
export type ObsidianWriteStrategy = 'browser-download' | 'file-system-access' | 'google-drive' | 'local-helper';

/**
 * 戦略A：ブラウザのダウンロード（フォールバック）。
 * - 対応範囲が広く、どの環境でも概ね動く。
 * - ユーザーが手動で .md ファイルをダウンロードする。
 * - 安全だが「自動」ではない（手動操作が必要）。
 */
export const STRATEGY_BROWSER_DOWNLOAD: ObsidianWriteStrategy = 'browser-download';

/**
 * 戦略B：File System Access API。
 * - Chromium 系デスクトップブラウザで利用可能。
 * - iPhone / iPad の Safari では信頼できない（非対応）。
 * - フォルダ選択にユーザー許可が必要。
 * - デスクトップのローカル Obsidian Vault に向く。
 */
export const STRATEGY_FILE_SYSTEM_ACCESS: ObsidianWriteStrategy = 'file-system-access';

/**
 * 戦略C：Google Drive API。
 * - Google Drive 同期の Vault に書き出せる。
 * - Google OAuth と Drive 権限が必要。
 * - 実装はやや複雑だが、デバイス間利用に向く。
 */
export const STRATEGY_GOOGLE_DRIVE: ObsidianWriteStrategy = 'google-drive';

/**
 * 戦略D：ローカルヘルパーアプリ。
 * - 上級者向けに将来検討。
 * - MyBrain Web アプリが Markdown をローカルヘルパーへ送る。
 * - ヘルパーが Obsidian Vault へファイルを書き込む。
 * - MVP には不要。
 */
export const STRATEGY_LOCAL_HELPER: ObsidianWriteStrategy = 'local-helper';

/**
 * 推奨する MVP の方向性。
 *
 * 1. 当面は Supabase を source of truth として維持する。
 * 2. まず手動の .md エクスポート / ダウンロードを追加する（戦略A）。
 * 3. 次に、同期 Vault 向けに Google Drive API を検討する（戦略C）。
 * 4. ローカルフォルダへの直接書き込みは「デスクトップ限定の拡張」として扱う（戦略B）。
 *
 * ※ 戦略D（ローカルヘルパー）は MVP の範囲外。
 */
export const OBSIDIAN_WRITE_MVP_DIRECTION = [
  'Keep Supabase as source of truth for now.',
  'Add manual .md export/download first (Strategy A).',
  'Then consider Google Drive API for synced Vault (Strategy C).',
  'Treat direct local folder writing as desktop-only enhancement (Strategy B).',
] as const;
