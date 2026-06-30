/**
 * 保存済みメモを「付加的に」ローカル Obsidian Vault へ1件書き出す共有ヘルパー（UI 非接続）。
 *
 * - 目的：複数の保存パス（デスクトップ クイック保存／別メモ保存／詳細更新 等）で重複しがちな
 *   「target 判定 → Vault 解決 → ready なら書き込み → 結果を分類」のロジックを1箇所に集約する。
 * - このヘルパーは UI 文言・トーストを持たない。状態（status）を返すだけで、表示は呼び出し側の責務。
 * - 保存先が obsidian-local のときだけ動く。MyBrain/Supabase 保存はこのヘルパーの外で完了している前提。
 * - 失敗は致命的ではない（呼び出し側はメモを「保存済み」として扱ってよい）。
 * - フォルダ権限の自動要求はしない（resolveSavedVaultDirectory が ready のときだけ書き込む）。
 * - 設計方針：docs/obsidian-storage-flow-review.md / Phase 4.3 レビュー
 */

import type { Memo } from '@/lib/types';
import { loadMemoStorageTarget } from '@/lib/storage/memo-storage-target';
import { resolveSavedVaultDirectory } from './vault-directory-resolver';
import { writeMemoToDirectory } from './file-system-access';

/** 付加的 Vault 書き出しの結果。呼び出し側はこれを見てトースト等を出す。 */
export type VaultWriteOutcome =
  | { status: 'skipped' } // 保存先が obsidian-local ではない（何もしない）
  | { status: 'written'; fileName: string; path: string } // 1件書き出し成功
  | { status: 'missing' } // Vault フォルダ未接続
  | { status: 'unsupported' } // ブラウザ非対応（File System Access / 権限 API なし）
  | { status: 'permission-denied' } // 権限が得られない（denied / 未許可）
  | { status: 'error'; error?: string }; // resolver / 書き込みの想定外失敗（非致命）

/**
 * 保存先が obsidian-local のとき、保存済みメモを Vault に1件書き出して結果を返す。
 *
 * - target が obsidian-local 以外 → { status: 'skipped' }。
 * - Vault が ready（保存ハンドル＋readwrite 許可済み）→ writeMemoToDirectory で書き込み、{ status: 'written', ... }。
 * - missing / unsupported / permission-denied → 対応する status（書き込みはしない）。
 * - resolver が想定外の状態、または resolver/書き込みで例外 → { status: 'error' }（非致命）。
 *
 * UI 文言は返さない。トースト・メッセージは呼び出し側が status から決める。
 *
 * @param memo 直前に MyBrain へ保存済みのメモ
 * @returns VaultWriteOutcome
 */
export async function writeSavedMemoToVaultIfEnabled(memo: Memo): Promise<VaultWriteOutcome> {
  if (loadMemoStorageTarget() !== 'obsidian-local') {
    return { status: 'skipped' };
  }

  try {
    const resolved = await resolveSavedVaultDirectory();

    if (resolved.state === 'ready' && resolved.handle) {
      const written = await writeMemoToDirectory(resolved.handle, memo);
      return { status: 'written', fileName: written.fileName, path: written.path };
    }

    switch (resolved.state) {
      case 'missing':
        return { status: 'missing' };
      case 'unsupported':
        return { status: 'unsupported' };
      case 'permission-denied':
        return { status: 'permission-denied' };
      case 'error':
        return { status: 'error', error: resolved.error };
      default:
        // 'ready' だが handle 欠落、等の想定外。致命的にせず error 扱い。
        return { status: 'error' };
    }
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
