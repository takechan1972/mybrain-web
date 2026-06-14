import type { Memo, MemoInput } from './types';

/**
 * メモのCRUD（P1：ブラウザ localStorage 保存）。
 *
 * 将来 Supabase に差し替えやすいよう、入出力を Memo/MemoInput に統一している。
 * （P3以降で同じ関数群を Supabase 実装へ置き換える想定）
 */

const STORAGE_KEY = 'aiplura_web_memos';

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readAll(): Memo[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Memo[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(memos: Memo[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
  } catch {
    // 保存失敗はUIを止めない
  }
}

function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** 更新日時の新しい順で全件取得 */
export function listMemos(): Memo[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getMemo(id: string): Memo | null {
  return readAll().find((m) => m.id === id) ?? null;
}

/** 新規作成（createdAt / updatedAt を自動記録） */
export function createMemo(input: MemoInput): Memo {
  const ts = Date.now();
  const memo: Memo = {
    id: genId(),
    title: input.title.trim() || '無題',
    body: input.body.trim(),
    tags: input.tags,
    images: input.images ?? [],
    createdAt: ts,
    updatedAt: ts,
  };
  const all = readAll();
  writeAll([memo, ...all]);
  return memo;
}

/** 更新（updatedAt のみ更新。createdAt は維持） */
export function updateMemo(id: string, input: MemoInput): Memo | null {
  const all = readAll();
  let updated: Memo | null = null;
  const next = all.map((m) => {
    if (m.id !== id) return m;
    updated = {
      ...m,
      title: input.title.trim() || '無題',
      body: input.body.trim(),
      tags: input.tags,
      updatedAt: Date.now(),
    };
    return updated;
  });
  if (updated) writeAll(next);
  return updated;
}

export function deleteMemo(id: string): void {
  writeAll(readAll().filter((m) => m.id !== id));
}

export { parseTags };
