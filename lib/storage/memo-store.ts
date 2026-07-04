import type { MemoInput } from '@/lib/types';
import {
  listMemos as supabaseListMemos,
  getMemo as supabaseGetMemo,
  createMemo as supabaseCreateMemo,
  updateMemo as supabaseUpdateMemo,
  deleteMemo as supabaseDeleteMemo,
  type ListResult,
  type MemoResult,
  type DeleteResult,
} from './supabase-memo-store';
import { loadMemoStorageTarget } from './memo-storage-target';
// 注意：memo-storage-target.ts は memo-store.ts から「型のみ」を import している
// （コンパイル時に消える）ため、ここで loadMemoStorageTarget を import しても実行時の循環は発生しない。
import { obsidianLocalMemoStore } from './obsidian-local-memo-store';
import { obsidianGdriveMemoStore } from './obsidian-gdrive-memo-store';
// 注意：両プレースホルダは supabase-memo-store.ts へ直接委譲し、memo-store.ts は型のみ
// 参照するため、実行時の循環 import は発生しない。

/**
 * メモ保存アダプタ層。
 *
 * 目的：「保存先（MyBrain / Obsidian Vault 等）」を1点で切り替えるための seam。
 *
 * 重要：
 * - lib/memos.ts（facade）は getMemoStore() 経由で本アダプタ層を使う。
 * - メモ CRUD の source of truth は常に Supabase。どのアダプタを選んでも CRUD 先は Supabase で不変。
 * - 保存先が 'obsidian-local' のときのローカル Vault への .md 書き出しは、この CRUD アダプタではなく
 *   保存フロー側の付加処理（lib/fs/write-saved-memo-to-vault.ts 等）が担う（追加的・非致命）。
 *
 * 契約は現行の async／結果ラッパー型（ListResult / MemoResult / DeleteResult）に一致させる。
 * 結果型は lib/memos.ts のものを再利用し、独自再定義による乖離を避ける。
 * parseTags は保存とは別の純ヘルパーのため、このインターフェースには含めない。
 */
export interface MemoStore {
  listMemos(): Promise<ListResult>;
  getMemo(id: string): Promise<MemoResult>;
  createMemo(input: MemoInput): Promise<MemoResult>;
  updateMemo(id: string, input: MemoInput): Promise<MemoResult>;
  deleteMemo(id: string): Promise<DeleteResult>;
}

/** 保存先の種別（メモの保存先設定で選択）。 */
export type MemoStorageTarget = 'mybrain' | 'obsidian-local' | 'obsidian-gdrive';

/**
 * Supabase 実装。既存の lib/memos.ts の関数へそのまま転送するだけ（ロジックは複製しない）。
 * = 現行の「MyBrainに保存」。
 */
export const supabaseMemoStore: MemoStore = {
  listMemos: () => supabaseListMemos(),
  getMemo: (id) => supabaseGetMemo(id),
  createMemo: (input) => supabaseCreateMemo(input),
  updateMemo: (id, input) => supabaseUpdateMemo(id, input),
  deleteMemo: (id) => supabaseDeleteMemo(id),
};

/**
 * 現在有効なメモ保存ストアを返す。
 *
 * 選択中の保存先（localStorage: mybrain.memo.storageTarget）を読み、対応するアダプタを返す。
 *
 * どのアダプタも CRUD の実体は Supabase（source of truth）。保存先を変えても CRUD 先は変わらない。
 * → 'obsidian-local' のローカル Vault への .md 追加書き出しは、この CRUD アダプタではなく
 *   保存フロー側の付加処理（lib/fs/write-saved-memo-to-vault.ts）が担当する。
 * → 'obsidian-gdrive' の自動書き出しは未対応（Google Drive へは手動エクスポートのみ）。
 *
 * SSR では loadMemoStorageTarget() が既定値 'mybrain' を返すため、サーバ側でも安全。
 */
export function getMemoStore(): MemoStore {
  const target = loadMemoStorageTarget();

  switch (target) {
    case 'obsidian-local':
      // Obsidian ローカル Vault 用アダプタ。CRUD は Supabase に委譲（挙動は不変）。
      // ローカル Vault への .md 書き出しは保存フロー側（lib/fs）が付加的に行う。
      return obsidianLocalMemoStore;

    case 'obsidian-gdrive':
      // Google Drive 同期の Obsidian Vault 用アダプタ。CRUD は Supabase に委譲（挙動は不変）。
      // 保存時の自動 Drive 書き出しは未対応（Drive へは手動エクスポートのみ）。
      return obsidianGdriveMemoStore;

    case 'mybrain':
    default:
      // MyBrain 標準（現行の保存先）。
      return supabaseMemoStore;
  }
}
