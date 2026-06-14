import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * AI プロバイダー設定。
 *
 * 今回は本物の API 接続・課金・APIキー保存は行わず、
 * 「どのプラン / どの接続方式 / どのプロバイダーを使うか」という
 * 設定値だけを保持する。実際の処理分岐は ai-client.ts が担う。
 */

// ── 販売プラン関連の型 ──────────────────────────────────────────────────────

export type AiPlanType = 'free' | 'basic' | 'standard' | 'pro' | 'byok' | 'business';
export type AiBillingMode = 'free' | 'included' | 'user_api_key' | 'custom_contract';
export type AiConnectionMode = 'mock' | 'backend' | 'user-api-key' | 'local' | 'custom';
export type AiProvider = 'mock' | 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom';
export type AiTaskType =
  | 'transcription'
  | 'summary'
  | 'chat'
  | 'scheduleExtraction'
  | 'memoClassification';

export interface AiTaskProviderSettings {
  provider: AiProvider;
  connectionMode: AiConnectionMode;
  model?: string;
  endpoint?: string;
  enabled: boolean;
}

// ── 既存の文字起こし / 要約 / 言語の型（維持） ───────────────────────────────

export type TranscriptionProvider = 'mock' | 'web-speech' | 'whisper' | 'local-whisper';
export type SummaryProvider = 'mock' | 'openai' | 'gemini' | 'claude' | 'local';

// 音声認識言語（BCP-47）。Web Speech / 将来の Whisper 等で共通利用。
export type TranscriptionLanguage = 'ja-JP' | 'en-US' | 'ko-KR' | 'zh-CN';

// ── AiSettings ──────────────────────────────────────────────────────────────

export interface AiSettings {
  // 既存（チャット / 文字起こし / 要約 / 言語）
  /** チャットAI（旧設定・互換維持） */
  provider: SummaryProvider;
  /** 文字起こし方式 */
  transcriptionProvider: TranscriptionProvider;
  /** 要約AI（旧設定・互換維持） */
  summaryProvider: SummaryProvider;
  /** 音声認識言語 */
  transcriptionLanguage: TranscriptionLanguage;

  // 販売プラン / 接続方式
  planType: AiPlanType;
  billingMode: AiBillingMode;
  connectionMode: AiConnectionMode;
  selectedProvider: AiProvider;
  selectedModel?: string;
  backendEndpoint?: string;
  customApiEndpoint?: string;
  localEndpoint?: string;
  userApiKeyEnabled: boolean;
  apiKeyStored: boolean;
  // SecureStore 保存状態（表示用フラグのみ。キー本体は含まない）
  apiKeyStatus?: {
    openai?: boolean;
    anthropic?: boolean;
    gemini?: boolean;
    custom?: boolean;
  };

  // 機能別設定
  summarySettings: AiTaskProviderSettings;
  chatSettings: AiTaskProviderSettings;
  scheduleExtractionSettings: AiTaskProviderSettings;
  memoClassificationSettings: AiTaskProviderSettings;

  // AIチャット参照設定（backend へ送る情報のオン・オフと件数）
  chatIncludeHistory: boolean;
  chatIncludeMemos: boolean;
  chatIncludeSchedules: boolean;
  chatHistoryLimit: number;
  chatMemoLimit: number;
  chatScheduleLimit: number;
  chatReferencePreset: ChatReferencePreset;

  // 自動バックアップ提案
  autoBackupEnabled: boolean;
  autoBackupIntervalDays: number;
  lastDataBackupAt?: string;
}

export type ChatReferencePreset = 'minimal' | 'standard' | 'maximum' | 'custom';

// プリセットごとの参照設定値（custom は手動調整用なので値は持たない）
export type ChatReferenceValues = Pick<
  AiSettings,
  | 'chatIncludeHistory'
  | 'chatIncludeMemos'
  | 'chatIncludeSchedules'
  | 'chatHistoryLimit'
  | 'chatMemoLimit'
  | 'chatScheduleLimit'
>;

export const CHAT_PRESET_VALUES: Record<'minimal' | 'standard' | 'maximum', ChatReferenceValues> = {
  minimal: {
    chatIncludeHistory: false,
    chatIncludeMemos: false,
    chatIncludeSchedules: false,
    chatHistoryLimit: 0,
    chatMemoLimit: 0,
    chatScheduleLimit: 0,
  },
  standard: {
    chatIncludeHistory: true,
    chatIncludeMemos: true,
    chatIncludeSchedules: true,
    chatHistoryLimit: 10,
    chatMemoLimit: 5,
    chatScheduleLimit: 5,
  },
  maximum: {
    chatIncludeHistory: true,
    chatIncludeMemos: true,
    chatIncludeSchedules: true,
    chatHistoryLimit: 20,
    chatMemoLimit: 10,
    chatScheduleLimit: 10,
  },
};

export const CHAT_PRESET_LABELS: Record<ChatReferencePreset, string> = {
  minimal: '最小',
  standard: '標準',
  maximum: '最大',
  custom: 'カスタム',
};

// 現在の参照設定値が、いずれかのプリセットと一致するか判定（一致しなければ custom）
export function detectChatPreset(values: ChatReferenceValues): ChatReferencePreset {
  const match = (a: ChatReferenceValues, b: ChatReferenceValues) =>
    a.chatIncludeHistory === b.chatIncludeHistory &&
    a.chatIncludeMemos === b.chatIncludeMemos &&
    a.chatIncludeSchedules === b.chatIncludeSchedules &&
    a.chatHistoryLimit === b.chatHistoryLimit &&
    a.chatMemoLimit === b.chatMemoLimit &&
    a.chatScheduleLimit === b.chatScheduleLimit;
  if (match(values, CHAT_PRESET_VALUES.minimal)) return 'minimal';
  if (match(values, CHAT_PRESET_VALUES.standard)) return 'standard';
  if (match(values, CHAT_PRESET_VALUES.maximum)) return 'maximum';
  return 'custom';
}

const DEFAULT_TASK_SETTINGS: AiTaskProviderSettings = {
  provider: 'mock',
  connectionMode: 'mock',
  enabled: true,
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'mock',
  transcriptionProvider: 'mock',
  summaryProvider: 'mock',
  transcriptionLanguage: 'ja-JP',

  planType: 'free',
  billingMode: 'free',
  connectionMode: 'mock',
  selectedProvider: 'mock',
  selectedModel: '',
  backendEndpoint: '',
  customApiEndpoint: '',
  localEndpoint: '',
  userApiKeyEnabled: false,
  apiKeyStored: false,

  summarySettings: { ...DEFAULT_TASK_SETTINGS },
  chatSettings: { ...DEFAULT_TASK_SETTINGS },
  scheduleExtractionSettings: { ...DEFAULT_TASK_SETTINGS },
  memoClassificationSettings: { ...DEFAULT_TASK_SETTINGS },

  chatIncludeHistory: true,
  chatIncludeMemos: true,
  chatIncludeSchedules: true,
  chatHistoryLimit: 10,
  chatMemoLimit: 5,
  chatScheduleLimit: 5,
  chatReferencePreset: 'standard',

  autoBackupEnabled: true,
  autoBackupIntervalDays: 7,
  lastDataBackupAt: undefined,
};

// AsyncStorage 保存キー
export const AI_SETTINGS_KEY = 'AI_IPHONE_AI_SETTINGS';

export async function loadAiSettings(): Promise<AiSettings> {
  try {
    const raw = await AsyncStorage.getItem(AI_SETTINGS_KEY);
    if (raw == null) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    // 欠けた項目は既定値で補完（後方互換）
    return {
      ...DEFAULT_AI_SETTINGS,
      ...parsed,
      summarySettings: { ...DEFAULT_TASK_SETTINGS, ...parsed.summarySettings },
      chatSettings: { ...DEFAULT_TASK_SETTINGS, ...parsed.chatSettings },
      scheduleExtractionSettings: {
        ...DEFAULT_TASK_SETTINGS,
        ...parsed.scheduleExtractionSettings,
      },
      memoClassificationSettings: {
        ...DEFAULT_TASK_SETTINGS,
        ...parsed.memoClassificationSettings,
      },
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  try {
    // 注意: APIキーそのものは保存しない（apiKeyStored は状態フラグのみ）。
    // 将来 SecureStore で APIキーを安全に保存する想定。
    await AsyncStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 保存失敗は無視（ベストエフォート）
  }
}

// 自動バックアップの提案が必要か（前回から interval 日以上、または未実行）
export function isBackupDue(settings: AiSettings, now: number = Date.now()): boolean {
  if (settings.autoBackupEnabled === false) return false;
  const last = settings.lastDataBackupAt;
  if (!last) return true;
  const t = Date.parse(last);
  if (Number.isNaN(t)) return true; // 不正な日付は未実行扱い
  const days = typeof settings.autoBackupIntervalDays === 'number' && settings.autoBackupIntervalDays > 0
    ? settings.autoBackupIntervalDays
    : 7;
  return now - t >= days * 24 * 60 * 60 * 1000;
}

// 前回バックアップ日時の表示用整形
export function formatLastBackup(lastDataBackupAt?: string): string {
  if (!lastDataBackupAt) return '前回バックアップ：なし';
  const t = Date.parse(lastDataBackupAt);
  if (Number.isNaN(t)) return '前回バックアップ：なし';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `前回バックアップ：${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// プラン → 課金モードの対応（UI の利便用）
export function billingModeForPlan(plan: AiPlanType): AiBillingMode {
  switch (plan) {
    case 'standard':
    case 'pro':
      return 'included';
    case 'byok':
      return 'user_api_key';
    case 'business':
      return 'custom_contract';
    case 'free':
    case 'basic':
    default:
      return 'free';
  }
}

// ── ラベル / メッセージ（UI 用） ─────────────────────────────────────────────

export const PLAN_LABELS: Record<AiPlanType, string> = {
  free: '無料',
  basic: 'Basic',
  standard: 'Standard',
  pro: 'Pro',
  byok: 'BYOK',
  business: 'Business',
};

export const PLAN_MESSAGES: Record<AiPlanType, string> = {
  free: '無料プランです。音声入力やAIチャットは1日3回までお試しいただけます。手入力は無制限です。',
  basic: '現在は簡易AI（お試し）で動作します。AI接続なしでも基本機能を確認できます。',
  standard: '運営側APIを使用します。APIキーの設定は不要です。',
  pro: '運営側APIを使用します。Standardより多い利用量を想定したプランです。',
  byok: 'この設定では、ご自身のAPIキーを使用します。API利用料は各AIサービス側で発生します。APIキーの管理はご自身の責任で行ってください。',
  business: '法人・専門家向けの個別契約またはCustom API接続を想定しています。',
};

export const CONNECTION_MODE_LABELS: Record<AiConnectionMode, string> = {
  mock: '簡易AI',
  backend: '運営API',
  'user-api-key': '自分のAPIキー',
  local: 'ローカルAI',
  custom: 'Custom API',
};

// 新プロバイダー（プラン設定用）
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  mock: '簡易AI',
  openai: 'OpenAI',
  anthropic: 'Claude',
  gemini: 'Gemini',
  ollama: 'Ollama',
  custom: 'Custom API',
};

// 既存のチャット/要約セレクタ用ラベル（SummaryProvider）
export const PROVIDER_LABELS: Record<SummaryProvider, string> = {
  mock: '簡易AI（お試し）',
  openai: 'OpenAI',
  gemini: 'Gemini',
  claude: 'Claude',
  local: 'ローカルAI',
};

export const TRANSCRIPTION_LABELS: Record<TranscriptionProvider, string> = {
  mock: '簡易（お試し）',
  'web-speech': 'Web Speech',
  whisper: 'Whisper',
  'local-whisper': 'ローカルWhisper',
};

export const LANGUAGE_LABELS: Record<TranscriptionLanguage, string> = {
  'ja-JP': '日本語',
  'en-US': '英語',
  'ko-KR': '韓国語',
  'zh-CN': '中国語',
};
