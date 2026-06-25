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

/**
 * メモ保存アダプタ層（Phase 1：足場のみ）。
 *
 * 目的：将来「保存先（MyBrain / Obsidian Vault 等）」を1点で切り替えられるようにするための seam。
 *
 * 重要：
 * - これは足場（scaffolding）であり、まだ既存ページからは使われない。
 * - 既存の保存挙動・lib/memos.ts・呼び出し箇所は一切変更していない。
 * - 現状 getMemoStore() は常に Supabase 実装（既存関数への転送）を返すため、アプリの動作は不変。
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

/** 保存先の種別（将来の選択用。現時点では切り替えに使用しない）。 */
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
 * Phase 1.3：選択中の保存先（localStorage: mybrain.memo.storageTarget）を読み、
 * それに応じてアダプタを切り替えられる seam にした。
 *
 * ただし現時点では「どの保存先を選んでも」Supabase 実装にフォールバックする。
 * → 保存挙動は従来どおり完全に不変（常に MyBrain/Supabase に保存）。
 * → Obsidian ローカル / Google Drive アダプタは未実装。下記 TODO の箇所で接続する。
 *
 * SSR では loadMemoStorageTarget() が既定値 'mybrain' を返すため、サーバ側でも安全。
 */
export function getMemoStore(): MemoStore {
  const target = loadMemoStorageTarget();

  switch (target) {
    case 'obsidian-local':
      // TODO(Obsidian local): File System Access API ベースの
      //   obsidianLocalMemoStore を実装したらここで返す。
      //   例: return obsidianLocalMemoStore;
      //   実装までは MyBrain/Supabase にフォールバック（保存挙動は不変）。
      return supabaseMemoStore;

    case 'obsidian-gdrive':
      // TODO(Obsidian on Google Drive): Google Drive API ベースの
      //   obsidianGdriveMemoStore を実装したらここで返す。
      //   例: return obsidianGdriveMemoStore;
      //   実装までは MyBrain/Supabase にフォールバック（保存挙動は不変）。
      return supabaseMemoStore;

    case 'mybrain':
    default:
      // MyBrain 標準（現行の保存先）。
      return supabaseMemoStore;
  }
}
