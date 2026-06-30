/**
 * ローカル Obsidian Vault 内の「既存 MyBrain メモ Markdown ファイル」を、frontmatter の
 * id / source で安全に特定できたときだけ上書きする「付加的・非致命」ヘルパー（UI 非接続）。
 *
 * - 目的：将来の「更新内容の Vault 反映（write-back）」の本体。まず“見つかった1件だけ上書き”を切り出す。
 * - 照合は findVaultMemoFileById に委譲（id 一致かつ source==="mybrain" の最初の1件のみ）。
 *   → 任意ファイルや非 MyBrain ノートを誤って上書きしない。
 * - 一致が無ければ何もしない（新規作成しない・リネームしない・削除しない）。
 * - タイトル変更時もファイル名は変えない（既存ファイルの中身だけ更新）。
 * - 保存先が obsidian-local のときだけ動く。MyBrain/Supabase 保存はこのヘルパーの外で完了している前提。
 * - 権限の自動要求はしない（resolveSavedVaultDirectory が ready のときだけ書き込む）。
 * - 失敗は致命的にしない（呼び出し側へ throw しない。status を返すだけ）。
 * - UI 文言・トーストは持たない。React / UI / Google Drive には一切依存しない。
 * - 設計方針：Phase 4.13 レビュー（A 案：内容のみ更新・リネームしない）
 */

import type { Memo } from '@/lib/types';
import { loadMemoStorageTarget } from '@/lib/storage/memo-storage-target';
import { createMemoMarkdownFile } from '@/lib/markdown';
import { resolveSavedVaultDirectory } from './vault-directory-resolver';
import { findVaultMemoFileById } from './find-vault-memo-file-by-id';

/** 上書き（write-back）の結果。呼び出し側はこれを見てトースト等を出す。 */
export type OverwriteVaultMemoOutcome =
  | { status: 'skipped' } // 保存先が obsidian-local ではない（何もしない）
  | { status: 'updated'; fileName: string } // 一致ファイルを上書き更新した
  | { status: 'not-found' } // Vault 未接続、または一致ファイルが無い（作成しない）
  | { status: 'unsupported' } // ブラウザ非対応（File System Access / 権限 API なし）
  | { status: 'permission-denied' } // 権限が得られない（denied / 未許可）
  | { status: 'error'; error?: string }; // resolver / 書き込みの想定外失敗（非致命）

/**
 * 保存先が obsidian-local のとき、Vault 内の「この memo に対応する既存ファイル」を探し、
 * 見つかった1件だけを最新の Markdown で上書きして結果を返す。
 *
 * - target が obsidian-local 以外 → { status: 'skipped' }。
 * - Vault 未接続（missing）→ { status: 'not-found' }（上書き対象が無い＝作成もしない）。
 * - unsupported / permission-denied → 対応する status（書き込みはしない）。
 * - ready かつ一致ファイルあり → そのファイルを上書きして { status: 'updated', fileName }。
 * - ready だが一致ファイルなし → { status: 'not-found' }（新規作成しない）。
 * - resolver/書き込みで例外 → { status: 'error' }（非致命、呼び出し側へ throw しない）。
 *
 * ファイル名は既存のものを維持する（タイトルが変わってもリネームしない）。
 *
 * @param memo 直前に MyBrain へ保存済みのメモ
 * @returns OverwriteVaultMemoOutcome
 */
export async function overwriteVaultMemoFileIfFound(
  memo: Memo,
): Promise<OverwriteVaultMemoOutcome> {
  if (loadMemoStorageTarget() !== 'obsidian-local') {
    return { status: 'skipped' };
  }

  try {
    const resolved = await resolveSavedVaultDirectory();

    if (resolved.state !== 'ready' || !resolved.handle) {
      switch (resolved.state) {
        case 'missing':
          // Vault 未接続：上書きできる既存ファイルが存在しない＝作成もしない。
          return { status: 'not-found' };
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
    }

    // 既存ファイルを id / source で安全に特定（無ければ null）。
    const fileHandle = await findVaultMemoFileById(resolved.handle, memo.id);
    if (!fileHandle) {
      // 一致なし：新規作成・リネームはしない。
      return { status: 'not-found' };
    }

    // 中身だけ最新化（ファイル名は既存のまま維持＝リネームしない）。
    const { content } = createMemoMarkdownFile(memo);
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    return { status: 'updated', fileName: fileHandle.name };
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
