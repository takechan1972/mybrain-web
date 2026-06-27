/**
 * Blob を端末のダウンロードとして保存する小さな共通ヘルパー。
 *
 * - ZIP 書き出し（デスクトップ／モバイル）で重複していた Blob/URL/anchor の手順を1箇所に集約する。
 * - 端末のダウンロードのみ（Obsidian Vault への実保存・アップロードではない）。
 * - ブラウザ専用：window / document が無い環境（SSR 等）では何もせず安全に返る。
 */

/**
 * 指定の Blob を任意のファイル名でダウンロードさせる。
 *
 * @param fileName ダウンロードファイル名（例: "mybrain-memos-2026-06-27.zip"）
 * @param blob     ダウンロードする Blob
 */
export function downloadBlobFile(fileName: string, blob: Blob): void {
  // ブラウザガード：SSR など window/document が無い環境では何もしない。
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
