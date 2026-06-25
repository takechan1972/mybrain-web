/**
 * Obsidian Vault 内のメモ用フォルダパスを組み立てる定数・ヘルパー（純関数）。
 *
 * - これは内部ユーティリティであり、保存処理・UI・既存の保存挙動には接続しない。
 * - Vault 内の相対パス（POSIX 形式 "/" 区切り）を返す。Obsidian は "/" 区切りで統一。
 * - 将来、Obsidian アダプタ実装時にこのフォルダ規約を使う。
 */

/** 通常メモの保存先フォルダ（Vault 内相対パス）。 */
export const OBSIDIAN_MEMO_FOLDER = 'MyBrain/Memos';

/** アーカイブ済みメモの保存先フォルダ（Vault 内相対パス）。 */
export const OBSIDIAN_ARCHIVE_FOLDER = 'MyBrain/Archive';

/**
 * フォルダとファイル名（またはパス断片）を "/" で安全に連結する。
 * - 各断片の前後の "/" を取り除いてから単一の "/" で結合し、重複スラッシュを防ぐ。
 * - 空の断片は無視する。
 */
export function joinObsidianPath(...parts: string[]): string {
  return parts
    .map((p) => (p ?? '').replace(/^\/+|\/+$/g, '')) // 前後のスラッシュを除去
    .filter((p) => p.length > 0)
    .join('/');
}

/**
 * メモの Markdown ファイル名から Vault 内の保存先パスを作る。
 *
 * @param fileName 例: "買い物メモ.md"
 * @returns 例: "MyBrain/Memos/買い物メモ.md"（重複スラッシュなし）
 */
export function createMemoMarkdownPath(fileName: string): string {
  return joinObsidianPath(OBSIDIAN_MEMO_FOLDER, fileName);
}
