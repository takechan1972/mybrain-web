import {
  listMemos as supabaseListMemos,
  getMemo as supabaseGetMemo,
  createMemo as supabaseCreateMemo,
  updateMemo as supabaseUpdateMemo,
  deleteMemo as supabaseDeleteMemo,
} from './supabase-memo-store';
import type { MemoStore } from './memo-store';
import { createMemoMarkdownFile } from '@/lib/markdown/memo-markdown-file';

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
  // list / get / delete は現状そのまま MyBrain/Supabase に委譲（挙動は不変）。
  listMemos: () => supabaseListMemos(),
  getMemo: (id) => supabaseGetMemo(id),

  createMemo: async (input) => {
    // まず従来どおり MyBrain/Supabase に作成（保存挙動は不変）。
    const result = await supabaseCreateMemo(input);
    if (result.memo) {
      // 作成済みメモから Obsidian Markdown ファイル表現を生成（まだ書き出さない）。
      const markdownFile = createMemoMarkdownFile(result.memo);
      // TODO(Obsidian local): この markdownFile を選択された Vault フォルダ配下へ書き出す。
      void markdownFile;
    }
    return result;
  },

  updateMemo: async (id, input) => {
    // まず従来どおり MyBrain/Supabase を更新（保存挙動は不変）。
    const result = await supabaseUpdateMemo(id, input);
    if (result.memo) {
      // 更新済みメモから Obsidian Markdown ファイル表現を生成（まだ書き出さない）。
      const markdownFile = createMemoMarkdownFile(result.memo);
      // TODO(Obsidian local): この markdownFile を選択された Vault フォルダ配下へ書き出す。
      void markdownFile;
    }
    return result;
  },

  deleteMemo: (id) => supabaseDeleteMemo(id),
};
