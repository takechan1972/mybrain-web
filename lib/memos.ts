import type { MemoInput } from './types';
import { getMemoStore } from './storage/memo-store';

/**
 * メモCRUD（facade）。
 *
 * - 実体は保存アダプタ（getMemoStore()）へ委譲する。現状は Supabase 実装
 *   （lib/storage/supabase-memo-store.ts）。振る舞いは従来どおり（Supabase が source of truth）。
 * - 既存ページは引き続き本モジュール（@/lib/memos）を import する（呼び出し箇所は無変更）。
 * - localStorage版は lib/memos-store-local.ts に退避済み。
 */

// 結果型は実装側（supabase-memo-store）で定義。後方互換のため re-export する。
export type { ListResult, MemoResult, DeleteResult } from './storage/supabase-memo-store';

export function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** 一覧（更新日時の新しい順。RLSで自分の分のみ） */
export function listMemos() {
  return getMemoStore().listMemos();
}

export function getMemo(id: string) {
  return getMemoStore().getMemo(id);
}

export function createMemo(input: MemoInput) {
  return getMemoStore().createMemo(input);
}

export function updateMemo(id: string, input: MemoInput) {
  return getMemoStore().updateMemo(id, input);
}

export function deleteMemo(id: string) {
  return getMemoStore().deleteMemo(id);
}
