import { Platform } from 'react-native';

import { saveOrShareFile } from './file-download';
import type { ChatMessage, Memo, Reservation } from '../store/app-data';

/**
 * 利用データ（メモ・予定・AIチャット履歴）のバックアップ。
 *
 * セキュリティ: APIキー本体・トークン等は一切含めない（そもそも保持していない）。
 */

export const DATA_BACKUP_TYPE = 'AI_IPHONE_DATA_BACKUP';
export const DATA_BACKUP_VERSION = 1;

export interface DataBackup {
  type: typeof DATA_BACKUP_TYPE;
  version: number;
  exportedAt: string;
  app: 'ai-iphone';
  note: string;
  data: {
    memos: Memo[];
    schedules: Reservation[];
    chatMessages: ChatMessage[];
  };
}

export interface ImportedData {
  memos: Memo[];
  reservations: Reservation[];
  chatMessages: ChatMessage[];
}

// ── 共通ユーティリティ ──────────────────────────────────────────────────────

function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 成功時メッセージ（ネイティブは共有した旨を併記）
function successMessage(specific: string): string {
  return Platform.OS === 'web' ? specific : `${specific}（ファイルを共有しました）`;
}

const JSON_MIME = 'application/json';
const CSV_MIME = 'text/csv;charset=utf-8';

// CSV セル安全化
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\n');
}

function isoOrEmpty(ms: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toISOString();
  } catch {
    return '';
  }
}

// 予定の datetime "YYYY-MM-DD HH:mm-HH:mm" を分解
function splitDatetime(datetime: string): { date: string; startTime: string; endTime: string } {
  const s = (datetime ?? '').trim();
  if (s.length === 0) return { date: '', startTime: '', endTime: '' };
  const [datePart, timePart] = s.split(/[ T]/);
  let startTime = '';
  let endTime = '';
  if (timePart) {
    const [start, end] = timePart.split('-');
    startTime = start ?? '';
    endTime = end ?? '';
  }
  return { date: datePart ?? '', startTime, endTime };
}

// ── JSON エクスポート ────────────────────────────────────────────────────────

export async function exportAllDataJson(
  memos: Memo[],
  reservations: Reservation[],
  chatMessages: ChatMessage[],
): Promise<{ ok: boolean; message: string }> {
  const backup: DataBackup = {
    type: DATA_BACKUP_TYPE,
    version: DATA_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'ai-iphone',
    note: 'APIキー本体は含まれていません',
    data: { memos, schedules: reservations, chatMessages },
  };
  const res = await saveOrShareFile({
    filename: `ai-iphone-data-backup-${todayStamp()}.json`,
    content: JSON.stringify(backup, null, 2),
    mimeType: JSON_MIME,
  });
  return res.ok
    ? { ok: true, message: successMessage('全データをエクスポートしました') }
    : { ok: false, message: res.message };
}

// ── CSV エクスポート ─────────────────────────────────────────────────────────

export async function exportMemosCsv(memos: Memo[]): Promise<{ ok: boolean; message: string }> {
  const rows = memos.map((m) => [
    m.id,
    m.title,
    m.body,
    m.tags.join('；'),
    '', // category（現状データに無し）
    isoOrEmpty(m.createdAt),
    isoOrEmpty(m.updatedAt),
  ]);
  const csv = toCsv(['id', 'title', 'content', 'tags', 'category', 'createdAt', 'updatedAt'], rows);
  const res = await saveOrShareFile({
    filename: `ai-iphone-memos-${todayStamp()}.csv`,
    content: csv,
    mimeType: CSV_MIME,
  });
  return res.ok
    ? { ok: true, message: successMessage('メモCSVをエクスポートしました') }
    : { ok: false, message: res.message };
}

export async function exportSchedulesCsv(
  reservations: Reservation[],
): Promise<{ ok: boolean; message: string }> {
  const rows = reservations.map((r) => {
    const { date, startTime, endTime } = splitDatetime(r.datetime);
    return [r.id, r.name, date, startTime, endTime, r.content, '', isoOrEmpty(r.createdAt)];
  });
  const csv = toCsv(
    ['id', 'title', 'date', 'startTime', 'endTime', 'description', 'location', 'createdAt'],
    rows,
  );
  const res = await saveOrShareFile({
    filename: `ai-iphone-schedules-${todayStamp()}.csv`,
    content: csv,
    mimeType: CSV_MIME,
  });
  return res.ok
    ? { ok: true, message: successMessage('予定CSVをエクスポートしました') }
    : { ok: false, message: res.message };
}

export async function exportChatCsv(
  chatMessages: ChatMessage[],
): Promise<{ ok: boolean; message: string }> {
  const rows = chatMessages.map((m) => [m.id, m.role, m.text, '']);
  const csv = toCsv(['id', 'role', 'content', 'createdAt'], rows);
  const res = await saveOrShareFile({
    filename: `ai-iphone-chat-history-${todayStamp()}.csv`,
    content: csv,
    mimeType: CSV_MIME,
  });
  return res.ok
    ? { ok: true, message: successMessage('AIチャット履歴CSVをエクスポートしました') }
    : { ok: false, message: res.message };
}

// ── JSON インポート（検証＋安全な復元データ生成） ────────────────────────────

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function coerceMemo(raw: unknown): Memo {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const now = Date.now();
  return {
    id: typeof o.id === 'string' && o.id.length > 0 ? o.id : genId(),
    title: typeof o.title === 'string' ? o.title : '',
    body: typeof o.body === 'string' ? o.body : '',
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string') : [],
    pinned: o.pinned === true,
    source: o.source === 'voice' ? 'voice' : 'manual',
    ...(typeof o.summary === 'string' && o.summary.length > 0 ? { summary: o.summary } : {}),
    ...(Array.isArray(o.images) ? { images: o.images as Memo['images'] } : {}),
    ...(typeof o.ocrText === 'string' && o.ocrText.length > 0 ? { ocrText: o.ocrText } : {}),
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : now,
  };
}

function coerceReservation(raw: unknown): Reservation {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    id: typeof o.id === 'string' && o.id.length > 0 ? o.id : genId(),
    name: typeof o.name === 'string' ? o.name : typeof o.title === 'string' ? o.title : '',
    datetime: typeof o.datetime === 'string' ? o.datetime : '',
    content: typeof o.content === 'string' ? o.content : '',
    note: typeof o.note === 'string' ? o.note : '',
    ...(o.notificationEnabled === true ? { notificationEnabled: true } : {}),
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    updatedAt:
      typeof o.updatedAt === 'number'
        ? o.updatedAt
        : typeof o.createdAt === 'number'
          ? o.createdAt
          : Date.now(),
  };
}

function coerceChatMessage(raw: unknown): ChatMessage {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    id: typeof o.id === 'string' && o.id.length > 0 ? o.id : genId(),
    role: o.role === 'assistant' ? 'assistant' : 'user',
    text: typeof o.text === 'string' ? o.text : typeof o.content === 'string' ? o.content : '',
  };
}

export interface ParseResult {
  ok: boolean;
  message: string;
  data?: ImportedData;
}

export function parseDataBackup(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'バックアップファイルの形式が正しくありません' };
  }
  const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  if (!obj || obj.type !== DATA_BACKUP_TYPE || typeof obj.data !== 'object' || obj.data === null) {
    return { ok: false, message: 'バックアップファイルの形式が正しくありません' };
  }
  const data = obj.data as Record<string, unknown>;
  return {
    ok: true,
    message: 'データをインポートしました',
    data: {
      memos: asArray(data.memos).map(coerceMemo),
      reservations: asArray(data.schedules).map(coerceReservation),
      chatMessages: asArray(data.chatMessages).map(coerceChatMessage),
    },
  };
}
