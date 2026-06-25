import {
  listMemos as supabaseListMemos,
  getMemo as supabaseGetMemo,
  createMemo as supabaseCreateMemo,
  updateMemo as supabaseUpdateMemo,
  deleteMemo as supabaseDeleteMemo,
} from './supabase-memo-store';
import type { MemoStore } from './memo-store';

/**
 * Obsidian ローカル Vault 用メモ保存アダプタ（プレースホルダ）。
 *
 * 将来：端末ローカルの Obsidian Vault に、メモを Obsidian 互換 Markdown
 *   （YAML frontmatter + 本文。lib/markdown/memo-markdown.ts）として保存する。
 *   保存手段は File System Access API（PC / Android Chrome）を想定。
 *
 * 現時点：実ファイル保存は未実装。アプリを壊さないよう、すべての操作を
 *   既存の MyBrain/Supabase 実装へそのまま委譲する（＝保存挙動は不変）。
 *
 * 重要：memo-store.ts ではなく supabase-memo-store.ts へ直接委譲することで
 *   循環 import を回避する（MemoStore は型のみ import＝コンパイル時に消える）。
 */
export const obsidianLocalMemoStore: MemoStore = {
  // TODO(Obsidian local): 選択された Vault フォルダ配下に Markdown ファイルを書き出す。
  //   当面は MyBrain/Supabase にフォールバック（保存挙動は不変）。
  listMemos: () => supabaseListMemos(),
  getMemo: (id) => supabaseGetMemo(id),
  createMemo: (input) => supabaseCreateMemo(input),
  updateMemo: (id, input) => supabaseUpdateMemo(id, input),
  deleteMemo: (id) => supabaseDeleteMemo(id),
};
