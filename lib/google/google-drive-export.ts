/**
 * Google Drive への Markdown 書き出しアダプタのスケルトン（UI 非接続・実アップロード未実装）。
 *
 * - 将来、選択メモを Drive の MyBrain/Memos/ に Obsidian 互換 Markdown として書き出すための型を先に用意する。
 * - 結果の形は、ローカル Vault のバッチ書き込み（lib/fs の MemoBatchWriteResult）に揃える。
 *   宛先（ローカル FS / Google Drive）を差し替えても、呼び出し側が同じ形で結果を扱えるようにするため。
 * - ここでは何もアップロードしない：
 *   - Google API を呼ばない・OAuth トークンを要求/使用しない。
 *   - Google Identity Services を読み込まない・ポップアップ/リダイレクトしない・保存もしない。
 * - 実装は設計メモ（docs/google-drive-markdown-export-design.md）に沿って後で行う。
 */

import type { Memo } from '@/lib/types';

/** 1件のメモを Drive に書き出した結果（ローカルの MemoWriteResult と同形）。 */
export interface GoogleDriveMemoWriteResult {
  /** 実際に書き込んだファイル名（重複回避で連番が付く場合がある）。 */
  fileName: string;
  /** Drive 内の相対パス（例: "MyBrain/Memos/買い物メモ.md"）。 */
  path: string;
}

/** 1件のメモの Drive 書き出し失敗（ローカルの failed 要素と同形）。 */
export interface GoogleDriveMemoWriteFailure {
  memoId: string;
  title: string;
  error: string;
}

/** 複数メモを Drive に書き出した結果のサマリ（ローカルの MemoBatchWriteResult と同形）。 */
export interface GoogleDriveBatchWriteResult {
  /** 書き込みに成功したメモのファイル情報。 */
  written: GoogleDriveMemoWriteResult[];
  /** 書き込みに失敗したメモ（理由つき）。 */
  failed: GoogleDriveMemoWriteFailure[];
  /** 対象メモの総数。 */
  total: number;
  /** 成功件数。 */
  successCount: number;
  /** 失敗件数。 */
  failureCount: number;
}

/** 未実装時の失敗理由（呼び出し側の表示・分岐に使う）。 */
const NOT_IMPLEMENTED_ERROR = 'Google Drive export is not implemented yet';

/**
 * 選択したメモを Google Drive の MyBrain/Memos/ に書き出す（現状はスケルトン）。
 *
 * - 何もアップロードしない。全メモを「未実装」の失敗として返す。
 * - successCount は 0、failureCount は memos.length。
 *
 * TODO(Drive 実装): 設計メモに従い、OAuth（GIS トークンフロー・drive.file）でアクセストークンを得てから、
 * createMemoMarkdownFile で Markdown 化し、MyBrain/Memos/ に重複名回避でアップロードする。
 * それまでは未実装として失敗を返す。
 */
export async function exportMemosToGoogleDrive(
  memos: Memo[],
): Promise<GoogleDriveBatchWriteResult> {
  const failed: GoogleDriveMemoWriteFailure[] = memos.map((m) => ({
    memoId: m.id,
    title: m.title,
    error: NOT_IMPLEMENTED_ERROR,
  }));
  return {
    written: [],
    failed,
    total: memos.length,
    successCount: 0,
    failureCount: memos.length,
  };
}
