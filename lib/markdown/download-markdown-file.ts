/**
 * Markdown ファイルをブラウザのダウンロードとして保存する小さなヘルパー。
 *
 * - 端末のダウンロードのみ（Obsidian Vault への実保存ではない）。
 * - メモ詳細（スマホ／デスクトップ）で重複していた Blob/URL/anchor の手順を共通化したもの。
 * - ブラウザ専用：window / document が無い環境（SSR 等）では何もせず安全に返る。
 */

/**
 * 指定の内容を .md ファイルとしてダウンロードさせる。
 *
 * @param fileName ダウンロードファイル名（例: "買い物メモ.md"）
 * @param content  ファイル本文（Markdown）
 */
export function downloadMarkdownFile(fileName: string, content: string): void {
  // ブラウザガード：SSR など window/document が無い環境では何もしない。
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
