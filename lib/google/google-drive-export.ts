/**
 * Google Drive への Markdown 書き出しアダプタ（手動エクスポートの中核）。
 *
 * - 選択メモを Drive の MyBrain/Memos/ に Obsidian 互換 Markdown として書き出す。
 * - 結果の形は、ローカル Vault のバッチ書き込み（lib/fs の MemoBatchWriteResult）に揃える。
 *   宛先（ローカル FS / Google Drive）を差し替えても、呼び出し側が同じ形で結果を扱えるようにするため。
 * - 既存ヘルパーを組み合わせるだけ（トークン取得・フォルダ確保・Markdown 化・アップロードは各ヘルパーに委譲）。
 * - アクセストークンは引数で持ち回るだけ・保存しない。リフレッシュトークンは扱わない。
 * - UI 接続済み：デスクトップのメモ一覧（複数選択）・メモ詳細（単体）、モバイルの保存後ボタンから、
 *   いずれもユーザー操作（ボタン/確認ダイアログ）起点で呼ばれる「手動エクスポート」。
 * - 保存時の自動 Drive 書き出しはこの関数ではなく別のスキャフォールド
 *   （write-saved-memo-to-drive.ts の writeSavedMemoToDriveIfEnabled）の役割で、現状 UI 未接続。
 * - 設計方針：docs/google-drive-markdown-export-design.md
 */

import type { Memo } from '@/lib/types';
import { createMemoMarkdownFile } from '@/lib/markdown';
import { requestGoogleDriveAccessToken } from './google-drive-oauth';
import { ensureDriveFolderPath } from './google-drive-folders';
import { uploadMarkdownToDrive } from './google-drive-upload';

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

/** 全メモを同じ理由で失敗にしたサマリを作る（トークン未取得・フォルダ確保失敗などの早期失敗用）。 */
function allFailed(memos: Memo[], error: string): GoogleDriveBatchWriteResult {
  const failed: GoogleDriveMemoWriteFailure[] = memos.map((m) => ({
    memoId: m.id,
    title: m.title,
    error,
  }));
  return {
    written: [],
    failed,
    total: memos.length,
    successCount: 0,
    failureCount: memos.length,
  };
}

/**
 * 選択したメモを Google Drive の MyBrain/Memos/ に書き出す（UI 非接続のコア）。
 *
 * - 短命アクセストークンを取得し、MyBrain/Memos/ を確保してから1件ずつアップロードする。
 * - トークン状態に応じて早期に全件失敗を返す：
 *   - unconfigured → 'Google Drive is not configured'
 *   - cancelled    → 'Google Drive authorization was cancelled'
 *   - error        → 取得できたエラーメッセージ
 * - フォルダ確保に失敗した場合も全件失敗。
 * - 各メモは createMemoMarkdownFile → uploadMarkdownToDrive。1件失敗しても止めず次へ。
 * - トークンは持ち回るだけで保存しない。
 */
export async function exportMemosToGoogleDrive(
  memos: Memo[],
): Promise<GoogleDriveBatchWriteResult> {
  const token = await requestGoogleDriveAccessToken();
  if (token.state === 'unconfigured') return allFailed(memos, 'Google Drive is not configured');
  if (token.state === 'cancelled') return allFailed(memos, 'Google Drive authorization was cancelled');
  if (token.state !== 'granted' || !token.accessToken) {
    return allFailed(memos, token.error || 'Failed to get Google Drive access token');
  }
  const accessToken = token.accessToken;

  let folderId: string;
  try {
    folderId = await ensureDriveFolderPath(accessToken); // MyBrain/Memos/ を確保
  } catch (e) {
    return allFailed(memos, e instanceof Error ? e.message : String(e));
  }

  const written: GoogleDriveMemoWriteResult[] = [];
  const failed: GoogleDriveMemoWriteFailure[] = [];
  for (const memo of memos) {
    try {
      const { fileName, content } = createMemoMarkdownFile(memo);
      const uploaded = await uploadMarkdownToDrive(accessToken, fileName, content, folderId);
      written.push({ fileName: uploaded.name, path: uploaded.path ?? uploaded.name });
    } catch (e) {
      // 1件の失敗で全体を止めない。理由を集めて続行する。
      failed.push({
        memoId: memo.id,
        title: memo.title,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return {
    written,
    failed,
    total: memos.length,
    successCount: written.length,
    failureCount: failed.length,
  };
}
