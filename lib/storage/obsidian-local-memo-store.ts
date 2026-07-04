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
 * Obsidian ローカル Vault 用メモ保存アダプタ。
 *
 * CRUD の source of truth は MyBrain/Supabase（すべての操作を既存実装へ委譲）。
 *   保存挙動（CRUD 先）は 'mybrain' と同じで不変。
 *
 * 端末ローカルの Obsidian Vault への Markdown 書き出し自体は実装済みだが、
 *   この CRUD アダプタではなく保存フロー側の付加処理が担う：
 *   File System Access API で Vault が認可済みのとき lib/fs/write-saved-memo-to-vault.ts が
 *   .md（lib/markdown の Obsidian 互換 Markdown）を追加的に書き出す。
 *   そのため、このアダプタ内の createMemoMarkdownFile 呼び出しはファイル書き出しには使わない。
 *
 * 重要：memo-store.ts ではなく supabase-memo-store.ts へ直接委譲することで
 *   循環 import を回避する（MemoStore は型のみ import＝コンパイル時に消える）。
 */
export const obsidianLocalMemoStore: MemoStore = {
  // list / get / delete は現状そのまま MyBrain/Supabase に委譲（挙動は不変）。
  listMemos: () => supabaseListMemos(),
  getMemo: (id) => supabaseGetMemo(id),

  createMemo: async (input) => {
    // MyBrain/Supabase に作成（保存挙動は不変・source of truth）。
    const result = await supabaseCreateMemo(input);
    if (result.memo) {
      // Obsidian Markdown ファイル表現を生成（このアダプタ内では書き出さない）。
      // 実際のローカル Vault への .md 書き出しは保存フロー側（lib/fs/write-saved-memo-to-vault.ts）が担う。
      const markdownFile = createMemoMarkdownFile(result.memo);
      void markdownFile;
    }
    return result;
  },

  updateMemo: async (id, input) => {
    // MyBrain/Supabase を更新（保存挙動は不変・source of truth）。
    const result = await supabaseUpdateMemo(id, input);
    if (result.memo) {
      // Obsidian Markdown ファイル表現を生成（このアダプタ内では書き出さない）。
      // 実際のローカル Vault の更新は保存フロー側（lib/fs/overwrite-vault-memo-file-if-found.ts）が担う。
      const markdownFile = createMemoMarkdownFile(result.memo);
      void markdownFile;
    }
    return result;
  },

  deleteMemo: (id) => supabaseDeleteMemo(id),
};
