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
 * - Phase 1 では常に Supabase 実装を返す（保存先選択は読まない）。
 * - 将来、保存先設定に応じて別アダプタを返すための拡張点。
 */
export function getMemoStore(): MemoStore {
  return supabaseMemoStore;
}
