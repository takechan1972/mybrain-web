import type { MemoStorageTarget } from './memo-store';

/**
 * メモの保存先（storage target）の永続化（localStorage）。
 *
 * - Supabase は使わず端末ローカルにのみ保存（既存の ai-assist / ollama ストアと同じ方針）。
 * - SSR では window 無しのため既定値を返す（ハイドレーション安全）。
 * - この値は getMemoStore()（保存アダプタの切り替え）と、保存後の付加処理・表示メッセージで参照する。
 *   ただしメモ CRUD の source of truth は常に MyBrain/Supabase（アダプタを変えても CRUD 先は不変）。
 *   'obsidian-local' のときだけ、保存フローが lib/fs ヘルパーで追加的にローカル Vault へ .md を書き出す。
 */

export const DEFAULT_MEMO_STORAGE_TARGET: MemoStorageTarget = 'mybrain';
export const MEMO_STORAGE_TARGET_KEY = 'mybrain.memo.storageTarget';

const ALLOWED: readonly MemoStorageTarget[] = ['mybrain', 'obsidian-local', 'obsidian-gdrive'];

function isValidTarget(v: unknown): v is MemoStorageTarget {
  return typeof v === 'string' && (ALLOWED as readonly string[]).includes(v);
}

/** 保存済みの保存先を読み込む。未設定・不正値・SSR時は 'mybrain' を返す。 */
export function loadMemoStorageTarget(): MemoStorageTarget {
  if (typeof window === 'undefined') return DEFAULT_MEMO_STORAGE_TARGET;
  try {
    const raw = window.localStorage.getItem(MEMO_STORAGE_TARGET_KEY);
    return isValidTarget(raw) ? raw : DEFAULT_MEMO_STORAGE_TARGET;
  } catch {
    return DEFAULT_MEMO_STORAGE_TARGET;
  }
}

/**
 * 保存後に表示するメッセージ。現在選択中の保存先（storage target）で出し分ける。
 * - 保存自体は常に MyBrain（Supabase）。メッセージだけ切り替える（Phase 1.3/1.4）。
 * - モバイル（app/memos）／デスクトップ（DesktopMemos）の両方で同一文言を使うため集約。
 */
export function savedMessageForTarget(): string {
  switch (loadMemoStorageTarget()) {
    case 'obsidian-local':
      return 'MyBrainに保存しました。Obsidian用Markdownはメモ詳細画面からコピーまたはダウンロードできます。';
    case 'obsidian-gdrive':
      return 'MyBrainに保存しました。Google Drive連携は今後対応予定です。';
    default:
      return '保存しました';
  }
}

/** 保存先を保存する（不正値は 'mybrain' に正規化）。 */
export function saveMemoStorageTarget(target: MemoStorageTarget): void {
  if (typeof window === 'undefined') return;
  const value = isValidTarget(target) ? target : DEFAULT_MEMO_STORAGE_TARGET;
  try {
    window.localStorage.setItem(MEMO_STORAGE_TARGET_KEY, value);
  } catch {
    /* 保存失敗は致命的でないため握りつぶす */
  }
}
