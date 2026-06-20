// アカウント情報（利用プラン・氏名・電話番号）の端末ローカル保存。
// - Supabase は使わず localStorage にのみ保存（既存の ollama / ai-assist / consult-store と同じ方針）。
// - SSR では window 無しのため既定値を返す（ハイドレーション安全）。
// - 現時点では「プラン選択のみ」（決済は未実装）。アプリ全体の有料機能ゲート（lib/plan）とは独立。

export type AccountPlan = 'free' | 'standard' | 'premium';

export interface AccountSettings {
  /** 利用プラン（現時点では選択のみ・課金なし） */
  plan: AccountPlan;
  /** 氏名（任意・端末ローカル） */
  name: string;
  /** 電話番号（任意・端末ローカル） */
  phone: string;
}

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  plan: 'free',
  name: '',
  phone: '',
};

export const PLAN_OPTIONS: { value: AccountPlan; label: string; price: string }[] = [
  { value: 'free', label: '無料（Free）', price: '0円' },
  { value: 'standard', label: 'スタンダード（Standard）', price: '準備中' },
  { value: 'premium', label: 'プレミアム（Premium）', price: '準備中' },
];

export function planLabel(plan: AccountPlan): string {
  return PLAN_OPTIONS.find((o) => o.value === plan)?.label ?? '無料（Free）';
}

const STORAGE_KEY = 'mybrain.account.settings';

export function loadAccountSettings(): AccountSettings {
  if (typeof window === 'undefined') return DEFAULT_ACCOUNT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ACCOUNT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AccountSettings>;
    return { ...DEFAULT_ACCOUNT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_ACCOUNT_SETTINGS;
  }
}

export function saveAccountSettings(s: AccountSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 保存失敗は致命的でないため握りつぶす */
  }
}
