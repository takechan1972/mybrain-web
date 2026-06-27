/**
 * File System Access API の対応判定（最小ユーティリティ・能力検出のみ）。
 *
 * - 将来の「Obsidian Vault ローカルフォルダ直接書き出し」の土台。
 * - ここでは showDirectoryPicker を呼び出さない・ファイル書き込みもしない（検出のみ）。
 * - 設計方針：docs/obsidian-vault-export-design.md
 * - ブラウザ専用：window が無い環境（SSR 等）では安全に false を返す。
 */

/**
 * このブラウザで `window.showDirectoryPicker`（ディレクトリ選択）が使えるかを返す。
 *
 * - SSR など window が無い環境では false。
 * - window に showDirectoryPicker が存在するときだけ true。
 *
 * @returns 対応していれば true、そうでなければ false
 */
export function isDirectoryPickerSupported(): boolean {
  // SSR ガード：window が無ければ非対応として扱う。
  if (typeof window === 'undefined') return false;
  return 'showDirectoryPicker' in window;
}
