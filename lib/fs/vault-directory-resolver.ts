/**
 * 保存済み Vault フォルダハンドルを「そのまま使えるか」まで解決する小さなオーケストレーション（UI 非接続）。
 *
 * - loadVaultHandle（保存ハンドル取得）と ensureVaultPermission（権限確認）を組み合わせるだけ。
 * - ここではフォルダ選択（pickDirectory）も書き込みもしない・保存ハンドルの自動削除もしない。
 * - 「保存ハンドルが使えるなら再利用、ダメなら呼び出し側が pickDirectory にフォールバック」する判断材料を返す。
 * - 設計方針：docs/obsidian-vault-export-design.md
 */

import { loadVaultHandle } from './vault-handle-store';
import { ensureVaultPermission } from './vault-permission';

/** 保存ハンドル解決の結果状態。 */
export type ResolvedVaultDirectoryState =
  | 'ready' // 保存ハンドルがあり readwrite 権限も granted（そのまま使える）
  | 'missing' // 保存ハンドルが無い（未接続）
  | 'permission-denied' // ハンドルはあるが権限が得られない（denied / prompt 未許可）
  | 'unsupported' // SSR / 権限 API 非対応
  | 'error'; // 想定外の例外

/** 保存ハンドル解決の結果。state==='ready' のときだけ handle を使ってよい。 */
export interface ResolvedVaultDirectory {
  state: ResolvedVaultDirectoryState;
  handle: FileSystemDirectoryHandle | null;
  error?: string;
}

/**
 * 保存済みの Vault フォルダハンドルを取得し、readwrite 権限まで確認して返す。
 *
 * - 保存ハンドルが無い → 'missing'。
 * - 権限 granted → 'ready'（handle を返す）。
 * - 非対応（SSR / 権限 API なし）→ 'unsupported'。
 * - 拒否 / 未許可 → 'permission-denied'。
 * - 例外 → 'error'。
 *
 * フォルダ選択・書き込み・保存ハンドルの削除は行わない（呼び出し側の責務）。
 */
export async function resolveSavedVaultDirectory(): Promise<ResolvedVaultDirectory> {
  try {
    const handle = await loadVaultHandle();
    if (!handle) return { state: 'missing', handle: null };

    const permission = await ensureVaultPermission(handle);
    if (permission.canWrite) return { state: 'ready', handle };

    switch (permission.state) {
      case 'unsupported':
        return { state: 'unsupported', handle: null };
      case 'error':
        return { state: 'error', handle: null, error: permission.error };
      default:
        // 'denied' / 'prompt'（未許可）はまとめて権限不可とする。
        return { state: 'permission-denied', handle: null };
    }
  } catch (e) {
    return { state: 'error', handle: null, error: e instanceof Error ? e.message : String(e) };
  }
}
