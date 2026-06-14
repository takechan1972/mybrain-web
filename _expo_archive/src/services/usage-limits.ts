import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadAiSettings, type AiPlanType } from './ai-settings';

/**
 * プラン別の機能制限と利用回数カウント。
 *
 * - 日別カウント（JST）: memoVoiceInput / reservationVoiceInput / aiChat
 * - 月別カウント（JST）: transcriptionMinutes / autoReservationFromVoice
 * - 本文・音声認識結果・個人情報・APIキー等は一切保存しない（回数/分数のみ）
 * - AsyncStorage に保存し、アプリ再起動後も保持。JST の日付/月が変わると自動リセット
 */

export interface PlanLimits {
  memoManual: boolean;
  reservationManual: boolean;
  memoVoiceInputPerDay: number;
  reservationVoiceInputPerDay: number;
  aiChatPerDay: number;
  transcriptionMinutesPerMonth: number;
  autoReservationFromVoicePerMonth: number;
}

export const PLAN_LIMITS: Record<AiPlanType, PlanLimits> = {
  free: {
    memoManual: true,
    reservationManual: true,
    memoVoiceInputPerDay: 3,
    reservationVoiceInputPerDay: 3,
    aiChatPerDay: 3,
    transcriptionMinutesPerMonth: 0,
    autoReservationFromVoicePerMonth: 0,
  },
  basic: {
    memoManual: true,
    reservationManual: true,
    memoVoiceInputPerDay: 20,
    reservationVoiceInputPerDay: 20,
    aiChatPerDay: 30,
    transcriptionMinutesPerMonth: 30,
    autoReservationFromVoicePerMonth: 10,
  },
  standard: {
    memoManual: true,
    reservationManual: true,
    memoVoiceInputPerDay: 100,
    reservationVoiceInputPerDay: 100,
    aiChatPerDay: 100,
    transcriptionMinutesPerMonth: 180,
    autoReservationFromVoicePerMonth: 100,
  },
  pro: {
    memoManual: true,
    reservationManual: true,
    memoVoiceInputPerDay: 500,
    reservationVoiceInputPerDay: 500,
    aiChatPerDay: 300,
    transcriptionMinutesPerMonth: 600,
    autoReservationFromVoicePerMonth: 500,
  },
  byok: {
    memoManual: true,
    reservationManual: true,
    memoVoiceInputPerDay: 500,
    reservationVoiceInputPerDay: 500,
    aiChatPerDay: 500,
    transcriptionMinutesPerMonth: 600,
    autoReservationFromVoicePerMonth: 500,
  },
  business: {
    memoManual: true,
    reservationManual: true,
    memoVoiceInputPerDay: 1000,
    reservationVoiceInputPerDay: 1000,
    aiChatPerDay: 1000,
    transcriptionMinutesPerMonth: 1200,
    autoReservationFromVoicePerMonth: 1000,
  },
};

export function getLimits(plan: AiPlanType): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

// ── 利用回数カウント ─────────────────────────────────────────────────────────

export type DailyKind = 'memoVoiceInput' | 'reservationVoiceInput' | 'aiChat';
export type MonthlyKind = 'transcriptionMinutes' | 'autoReservationFromVoice';
export type UsageKind = DailyKind | MonthlyKind;

interface UsageSnapshot {
  day: string; // JST YYYY-MM-DD
  month: string; // JST YYYY-MM
  memoVoiceInput: number;
  reservationVoiceInput: number;
  aiChat: number;
  transcriptionMinutes: number;
  autoReservationFromVoice: number;
}

const USAGE_KEY = 'AI_IPHONE_USAGE';

// JST（UTC+9）基準の日付・月
function jstDay(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function jstMonth(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function emptySnapshot(): UsageSnapshot {
  return {
    day: jstDay(),
    month: jstMonth(),
    memoVoiceInput: 0,
    reservationVoiceInput: 0,
    aiChat: 0,
    transcriptionMinutes: 0,
    autoReservationFromVoice: 0,
  };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

// 保存値を読み込み、日付/月が変わっていれば該当カウントをリセットして返す（必要時は保存）
export async function loadUsage(): Promise<UsageSnapshot> {
  let snap = emptySnapshot();
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<UsageSnapshot>;
      snap = {
        day: typeof p.day === 'string' ? p.day : jstDay(),
        month: typeof p.month === 'string' ? p.month : jstMonth(),
        memoVoiceInput: num(p.memoVoiceInput),
        reservationVoiceInput: num(p.reservationVoiceInput),
        aiChat: num(p.aiChat),
        transcriptionMinutes: num(p.transcriptionMinutes),
        autoReservationFromVoice: num(p.autoReservationFromVoice),
      };
    }
  } catch {
    snap = emptySnapshot();
  }

  let changed = false;
  const today = jstDay();
  const thisMonth = jstMonth();
  if (snap.day !== today) {
    snap.day = today;
    snap.memoVoiceInput = 0;
    snap.reservationVoiceInput = 0;
    snap.aiChat = 0;
    changed = true;
  }
  if (snap.month !== thisMonth) {
    snap.month = thisMonth;
    snap.transcriptionMinutes = 0;
    snap.autoReservationFromVoice = 0;
    changed = true;
  }
  if (changed) {
    try {
      await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(snap));
    } catch {
      // 保存失敗は無視（ベストエフォート）
    }
  }
  return snap;
}

// kind に対応する上限値を取得
function limitFor(plan: AiPlanType, kind: UsageKind): number {
  const l = getLimits(plan);
  switch (kind) {
    case 'memoVoiceInput':
      return l.memoVoiceInputPerDay;
    case 'reservationVoiceInput':
      return l.reservationVoiceInputPerDay;
    case 'aiChat':
      return l.aiChatPerDay;
    case 'transcriptionMinutes':
      return l.transcriptionMinutesPerMonth;
    case 'autoReservationFromVoice':
      return l.autoReservationFromVoicePerMonth;
    default:
      return 0;
  }
}

export interface LimitCheck {
  allowed: boolean;
  used: number;
  limit: number;
}

// 上限チェック（amount 分が使えるか）。プラン未指定なら設定から取得。
export async function checkLimit(
  kind: UsageKind,
  amount = 1,
  plan?: AiPlanType,
): Promise<LimitCheck> {
  const p = plan ?? (await loadAiSettings()).planType;
  const snap = await loadUsage();
  const used = snap[kind];
  const limit = limitFor(p, kind);
  return { allowed: used + amount <= limit, used, limit };
}

// 利用を記録（回数 or 分数を加算）。本文・個人情報は保存しない。
export async function recordUsage(kind: UsageKind, amount = 1): Promise<void> {
  const snap = await loadUsage();
  snap[kind] = num(snap[kind]) + amount;
  try {
    await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(snap));
  } catch {
    // 保存失敗は無視
  }
}

// ── 上限到達時のユーザー向け文言 ─────────────────────────────────────────────

export const LIMIT_MESSAGES = {
  voiceInput: '本日の音声入力回数に達しました。明日以降に再度お試しいただくか、プラン変更をご検討ください。',
  transcription: '今月の文字起こし利用時間に達しました。プラン変更をご検討ください。',
  autoReservation:
    '今月の予約自動登録の上限に達しました。手入力での予約登録は引き続きご利用いただけます。',
  aiChat: '本日の利用上限に達しました。明日以降に再度お試しいただくか、プラン変更をご検討ください。',
} as const;

// ── 設定画面の利用状況表示用 ─────────────────────────────────────────────────

export interface UsageRow {
  label: string;
  used: number;
  limit: number;
  unit: string;
}

export async function getUsageRows(plan?: AiPlanType): Promise<UsageRow[]> {
  const p = plan ?? (await loadAiSettings()).planType;
  const l = getLimits(p);
  const snap = await loadUsage();
  return [
    { label: '今日のAIチャット', used: snap.aiChat, limit: l.aiChatPerDay, unit: '回' },
    { label: '今日のメモ音声入力', used: snap.memoVoiceInput, limit: l.memoVoiceInputPerDay, unit: '回' },
    { label: '今日の予定音声入力', used: snap.reservationVoiceInput, limit: l.reservationVoiceInputPerDay, unit: '回' },
    { label: '今月の文字起こし', used: snap.transcriptionMinutes, limit: l.transcriptionMinutesPerMonth, unit: '分' },
    { label: '今月の予約自動登録', used: snap.autoReservationFromVoice, limit: l.autoReservationFromVoicePerMonth, unit: '件' },
  ];
}
