/**
 * 保存済みメモを「付加的に」Google Drive の MyBrain/Memos/ へ1件書き出す共有ヘルパー（スキャフォールド・呼び出し元なし）。
 *
 * - 目的：将来「保存先 = obsidian-gdrive のときに保存後 Drive へ自動書き出す」導線の接続点を1箇所に用意する。
 *   Obsidian ローカルの writeSavedMemoToVaultIfEnabled（lib/fs）を鏡写しにした seam。
 * - 現状どの画面・保存フローからも呼ばれていない（呼び出し元 0 件）。存在するだけで挙動には影響しない。
 * - 現在ユーザーが使える Google Drive 書き出しは、これとは別の「手動エクスポート」
 *   （google-drive-export.ts の exportMemosToGoogleDrive）で、デスクトップ一覧・詳細・
 *   モバイル保存後ボタンに UI 接続済み。本ヘルパーはその自動化版であり、まだ未接続。
 * - このヘルパーは UI 文言・トーストを持たない。status を返すだけで、表示は呼び出し側の責務。
 * - OAuth を自動で起動しない：アクセストークンは呼び出し側が用意して渡す（ユーザー操作起点で取得したもの）。
 *   トークンが無ければ 'needs-auth' を返すだけで、ポップアップは出さない。
 * - Drive への実書き込みは既存の低レベルヘルパー（ensureDriveFolderPath / uploadMarkdownToDrive）に委譲。
 *   Markdown 化は既存の createMemoMarkdownFile を再利用（生成ロジックは複製しない）。
 * - 既存の手動エクスポート（exportMemosToGoogleDrive）には一切触れない。MyBrain/Supabase 保存は外で完了済みの前提。
 * - 失敗は致命的ではない（呼び出し側はメモを「保存済み」として扱ってよい）。
 * - 設計方針：docs/google-drive-markdown-export-design.md
 */

import type { Memo } from '@/lib/types';
import { loadMemoStorageTarget } from '@/lib/storage/memo-storage-target';
import { createMemoMarkdownFile } from '@/lib/markdown';
import { ensureDriveFolderPath } from './google-drive-folders';
import { uploadMarkdownToDrive } from './google-drive-upload';

/** 付加的 Drive 書き出しの結果。呼び出し側はこれを見てトースト等を出す。 */
export type DriveWriteOutcome =
  | { status: 'skipped' } // 保存先が obsidian-gdrive ではない（何もしない）
  | { status: 'needs-auth' } // 保存先は gdrive だが、アクセストークンが未提供（OAuth は自動起動しない）
  | { status: 'written'; fileName: string; path: string } // 1件書き出し成功
  | { status: 'error'; error?: string }; // フォルダ確保・アップロードの想定外失敗（非致命）

/**
 * 保存先が obsidian-gdrive のとき、保存済みメモを Drive に1件書き出して結果を返す（スキャフォールド）。
 *
 * - target が obsidian-gdrive 以外 → { status: 'skipped' }。
 * - target は gdrive だが accessToken 未提供 → { status: 'needs-auth' }（OAuth は自動で開かない）。
 * - accessToken あり → MyBrain/Memos/ を確保し、既存メモを上書きしない規則でアップロード、{ status: 'written', ... }。
 * - フォルダ確保・アップロードで例外 → { status: 'error' }（非致命）。
 *
 * UI 文言は返さない。トースト・メッセージは呼び出し側が status から決める。
 *
 * @param memo 直前に MyBrain へ保存済みのメモ
 * @param accessToken ユーザー操作起点で取得した短命アクセストークン（保存しない。無ければ needs-auth）
 * @returns DriveWriteOutcome
 */
export async function writeSavedMemoToDriveIfEnabled(
  memo: Memo,
  accessToken?: string,
): Promise<DriveWriteOutcome> {
  if (loadMemoStorageTarget() !== 'obsidian-gdrive') {
    return { status: 'skipped' };
  }
  if (!accessToken) {
    return { status: 'needs-auth' };
  }

  try {
    const folderId = await ensureDriveFolderPath(accessToken); // MyBrain/Memos/ を確保
    const { fileName, content } = createMemoMarkdownFile(memo);
    const uploaded = await uploadMarkdownToDrive(accessToken, fileName, content, folderId);
    return { status: 'written', fileName: uploaded.name, path: uploaded.path ?? uploaded.name };
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
