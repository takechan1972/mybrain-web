/**
 * メモの Obsidian 互換 Markdown ファイル名を安全に生成するヘルパー（純関数）。
 *
 * - Windows / macOS / Obsidian で安全なファイル名を作る。
 * - これは内部ユーティリティであり、保存処理・UI・既存の保存挙動には接続しない。
 * - 既存の memo 詳細ページ（app/memos/[id]/page.tsx 等）の mdFilename と同じ方針。
 *   将来、Obsidian アダプタ実装時にこの共通ヘルパーへ寄せられる。
 */

/** ファイル名の既定（タイトルが空・無効なとき）。拡張子は含めない。 */
export const DEFAULT_MEMO_FILE_BASE = 'untitled-memo';

/**
 * Windows の予約デバイス名（拡張子を付けてもファイル名として使えない）。
 * 例: "CON" → "CON.md" も不可。該当時は先頭に "_" を付けて回避する。
 */
const WINDOWS_RESERVED_NAMES =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 文字列をファイル名の一部として安全化する（拡張子は付けない）。
 *
 * - Windows 禁止文字 < > : " / \ | ? * を除去。
 * - 制御文字（0x00–0x1f）を除去。
 * - 連続空白を1つに圧縮し、前後をトリム。
 * - 末尾のドット・空白を除去（Windows ではディレクトリ/ファイル名末尾の "." や " " が不正）。
 * - 最大長 maxLength で切り詰める（既定 80）。
 */
export function sanitizeFileNamePart(input: string, maxLength = 80): string {
  return (input || '')
    .replace(/[\\/:*?"<>|]/g, '') // ファイル名に使えない文字を除去
    .replace(/[\x00-\x1f]/g, '') // 制御文字を除去
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .replace(/[.\s]+$/, ''); // 末尾のドット・空白を除去（Windows対策）
}

/**
 * メモタイトルから安全な .md ファイル名を生成する。
 *
 * @param title メモのタイトル（空・未定義可）
 * @returns 例: "買い物メモ.md" / タイトルが空や無効なら "untitled-memo.md"
 */
export function createMemoMarkdownFileName(title?: string | null): string {
  const sanitized = sanitizeFileNamePart(title ?? '');
  let base = sanitized.length > 0 ? sanitized : DEFAULT_MEMO_FILE_BASE;
  // Windows 予約名（CON / NUL / COM1 等）は拡張子付きでも不可なので "_" を前置して回避。
  if (WINDOWS_RESERVED_NAMES.test(base)) base = `_${base}`;
  return `${base}.md`;
}
