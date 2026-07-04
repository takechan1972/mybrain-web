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
 * Google Drive 同期の Obsidian Vault 用メモ保存アダプタ（プレースホルダ）。
 *
 * CRUD の source of truth は MyBrain/Supabase（すべての操作を既存実装へ委譲）。
 *   保存挙動（CRUD 先）は 'mybrain' と同じで不変。
 *
 * 保存時に Google Drive へ自動書き出しする処理は未実装。
 *   現状 Google Drive へは手動エクスポート（メモ保存後に表示されるボタン、lib/google の Drive 書き出し）
 *   でのみ .md を書き出せる。将来ここで OAuth 認可経由の自動書き出しに接続する。
 *
 * 重要：memo-store.ts ではなく supabase-memo-store.ts へ直接委譲することで
 *   循環 import を回避する（MemoStore は型のみ import＝コンパイル時に消える）。
 */
export const obsidianGdriveMemoStore: MemoStore = {
  // list / get / delete は現状そのまま MyBrain/Supabase に委譲（挙動は不変）。
  listMemos: () => supabaseListMemos(),
  getMemo: (id) => supabaseGetMemo(id),

  createMemo: async (input) => {
    // MyBrain/Supabase に作成（保存挙動は不変・source of truth）。
    const result = await supabaseCreateMemo(input);
    if (result.memo) {
      // Obsidian Markdown ファイル表現を生成（自動 Drive 書き出しは未対応のため、まだ使わない）。
      const markdownFile = createMemoMarkdownFile(result.memo);
      // TODO(Obsidian on Google Drive): この markdownFile を Drive 上の Vault フォルダへ自動書き出す。
      void markdownFile;
    }
    return result;
  },

  updateMemo: async (id, input) => {
    // MyBrain/Supabase を更新（保存挙動は不変・source of truth）。
    const result = await supabaseUpdateMemo(id, input);
    if (result.memo) {
      // Obsidian Markdown ファイル表現を生成（自動 Drive 書き出しは未対応のため、まだ使わない）。
      const markdownFile = createMemoMarkdownFile(result.memo);
      // TODO(Obsidian on Google Drive): この markdownFile を Drive 上の Vault フォルダへ自動書き出す。
      void markdownFile;
    }
    return result;
  },

  deleteMemo: (id) => supabaseDeleteMemo(id),
};
