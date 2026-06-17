// AIアシスト管理画面の設定（localStorage 永続化）。
// - Supabase は使わず端末ローカルにのみ保存（既存の ollama / consult-store と同じ方針）。
// - SSR では window 無しのため既定値を返す（ハイドレーション安全）。

export type ResponseTone = 'gentle' | 'concrete' | 'short' | 'detailed';

export interface AiAssistSettings {
  /** AIアシスト全体のON/OFF */
  enabled: boolean;
  /** AIが参照するコンテキスト */
  useMemos: boolean;
  useSchedules: boolean;
  useHistory: boolean;
  /** 応答スタイル */
  tone: ResponseTone;
}

export const DEFAULT_AI_ASSIST_SETTINGS: AiAssistSettings = {
  enabled: true,
  useMemos: true,
  useSchedules: true,
  useHistory: false,
  tone: 'gentle',
};

export const TONE_LABEL: Record<ResponseTone, string> = {
  gentle: 'やさしく',
  concrete: '具体的',
  short: '短く',
  detailed: '詳しく',
};

const STORAGE_KEY = 'mybrain.ai-assist.settings';

export function loadAiAssistSettings(): AiAssistSettings {
  if (typeof window === 'undefined') return DEFAULT_AI_ASSIST_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_ASSIST_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiAssistSettings>;
    return { ...DEFAULT_AI_ASSIST_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_AI_ASSIST_SETTINGS;
  }
}

export function saveAiAssistSettings(s: AiAssistSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 保存失敗は致命的でないため握りつぶす */
  }
}
