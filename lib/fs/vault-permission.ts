/**
 * 保存済み Vault フォルダハンドルの読み書き権限を確認／要求する最小ヘルパー（UI 非接続）。
 *
 * - 保存ハンドル（vault-handle-store）を使う前に、readwrite 権限があるかを確かめるための土台。
 * - queryPermission / requestPermission は標準 lib.dom.d.ts に型が無いため、このファイルでのみ最小宣言する。
 *   （FileSystemDirectoryHandle 自体は標準 DOM 型を使用する。）
 * - requestPermission は「ユーザー操作（クリック）起点」でのみ許可が出る点に注意（呼び出し側の責務）。
 * - 設計方針：docs/obsidian-vault-export-design.md
 */

/** 権限確認の結果状態。 */
export type VaultPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported' | 'error';

/** 権限確認の結果。canWrite が true のときだけ書き込んでよい。 */
export interface VaultPermissionResult {
  state: VaultPermissionState;
  canWrite: boolean;
  error?: string;
}

// File System Access の権限メソッドは lib.dom 未収録のため、このファイル内のみで最小宣言する。
type FileSystemHandlePermissionDescriptor = { mode?: 'read' | 'readwrite' };
interface PermissionCapableHandle {
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
}

/**
 * 渡されたディレクトリハンドルに対して readwrite 権限を確認し、必要なら要求する。
 *
 * - SSR / 権限 API 非対応：state 'unsupported'、canWrite false。
 * - すでに granted：そのまま canWrite true。
 * - prompt：requestPermission で要求し、granted なら canWrite true。
 * - 拒否：canWrite false（denied / prompt のまま）。
 * - 想定外の例外：state 'error'、canWrite false。
 *
 * @param handle 権限を確認する Vault フォルダハンドル
 * @returns 権限状態と書き込み可否
 */
export async function ensureVaultPermission(
  handle: FileSystemDirectoryHandle,
): Promise<VaultPermissionResult> {
  // SSR ガード。
  if (typeof window === 'undefined') return { state: 'unsupported', canWrite: false };

  const h = handle as unknown as PermissionCapableHandle;
  // 権限 API 非対応（古い実装など）。
  if (typeof h.queryPermission !== 'function') {
    return { state: 'unsupported', canWrite: false };
  }

  const descriptor: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  try {
    let status = await h.queryPermission(descriptor);
    if (status === 'granted') return { state: 'granted', canWrite: true };

    if (status === 'prompt') {
      // ユーザー操作起点で要求する（呼び出し側がクリック内で呼ぶ前提）。
      if (typeof h.requestPermission === 'function') {
        status = await h.requestPermission(descriptor);
      }
      if (status === 'granted') return { state: 'granted', canWrite: true };
      if (status === 'denied') return { state: 'denied', canWrite: false };
      return { state: 'prompt', canWrite: false };
    }

    // ここに来るのは 'denied'。
    return { state: 'denied', canWrite: false };
  } catch (e) {
    return {
      state: 'error',
      canWrite: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
