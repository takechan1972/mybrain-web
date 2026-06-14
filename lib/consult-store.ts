// AI相談履歴のローカル永続化（localStorage）。
// NOTE: 現在はローカル端末のみに保存。ログイン・ユーザーアカウント実装後は
// Supabase / DB 永続化に置き換え可能（loadConsultTurns / saveConsultTurns を差し替えるだけ）。

import { safeUUID } from './uuid';

export type RefTarget = 'both' | 'memos' | 'schedule';

export interface Turn {
  id: string;
  question: string;
  answer: string;
  refTarget: RefTarget;
  createdAt: number;
  /** 回答が参照したメモ件数（旧データには無い場合がある） */
  memoCount?: number;
  /** 回答が参照した予定件数（旧データには無い場合がある） */
  scheduleCount?: number;
  /** 回答が参照した予定ID（タップで詳細へ。旧データには無い場合がある） */
  scheduleIds?: string[];
  /** 回答が参照したメモID（タップで詳細へ。旧データには無い場合がある） */
  memoIds?: string[];
}

// 相談履歴の localStorage 保存キー（相談画面・履歴画面で共通利用）
export const CONSULT_STORAGE_KEY = 'mybrain_consult_turns';

export function loadConsultTurns(): Turn[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CONSULT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 古い構造でも壊れないように最低限のフィールドを補完する
    return parsed
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({
        id: typeof t.id === 'string' ? t.id : safeUUID(),
        question: typeof t.question === 'string' ? t.question : '',
        answer: typeof t.answer === 'string' ? t.answer : '',
        refTarget: (['both', 'memos', 'schedule'] as const).includes(t.refTarget)
          ? t.refTarget
          : 'both',
        createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
        memoCount: typeof t.memoCount === 'number' ? t.memoCount : undefined,
        scheduleCount: typeof t.scheduleCount === 'number' ? t.scheduleCount : undefined,
        scheduleIds: Array.isArray(t.scheduleIds) ? t.scheduleIds.filter((s: unknown) => typeof s === 'string') : undefined,
        memoIds: Array.isArray(t.memoIds) ? t.memoIds.filter((s: unknown) => typeof s === 'string') : undefined,
      }));
  } catch {
    // 不正な JSON は安全に無視して空配列にリセット
    return [];
  }
}

export function saveConsultTurns(turns: Turn[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONSULT_STORAGE_KEY, JSON.stringify(turns));
  } catch {
    // 保存失敗（容量超過など）は無視してクラッシュさせない
  }
}

export const REF_TARGET_LABEL: Record<RefTarget, string> = {
  both: 'メモ＋予定',
  memos: 'メモ',
  schedule: '予定',
};
