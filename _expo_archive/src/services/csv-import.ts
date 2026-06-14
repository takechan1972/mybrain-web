import type { ChatMessage, Memo, Reservation } from '../store/app-data';

/**
 * CSV インポート（メモ・予定・AIチャット履歴）。
 *
 * - 外部ライブラリ不使用の簡易 CSV パーサ（引用符・カンマ・改行・エスケープ対応）
 * - 不正行はスキップして継続
 * - 許可した列以外は無視（APIキー等の秘密情報は読み込まない）
 */

export interface CsvImportResult<T> {
  ok: boolean;
  items: T[];
  skipped: number;
  message?: string;
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowMs(): number {
  return Date.now();
}

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseMs(value: string): number {
  const s = value.trim();
  if (s.length === 0) return nowMs();
  const t = Date.parse(s);
  return Number.isNaN(t) ? nowMs() : t;
}

// ── CSV パーサ ──────────────────────────────────────────────────────────────

// 文字列を行×セルの2次元配列へ。引用符内のカンマ・改行・""エスケープに対応。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  // 改行コード正規化
  const src = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  // 最終セル/行
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // 空行（全セル空）は除外
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

// ヘッダー名→列indexのマップを作る（小文字・trim比較）
function headerIndex(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    map[h.trim().toLowerCase()] = i;
  });
  return map;
}

function cellAt(row: string[], idx: number | undefined): string {
  if (idx === undefined || idx < 0 || idx >= row.length) return '';
  return (row[idx] ?? '').trim();
}

// ── メモ CSV ────────────────────────────────────────────────────────────────

export function importMemosFromCsv(text: string): CsvImportResult<Memo> {
  const rows = parseCsv(text);
  if (rows.length < 1) {
    return { ok: false, items: [], skipped: 0, message: 'CSVファイルの形式が正しくありません' };
  }
  const h = headerIndex(rows[0]);
  if (!('title' in h) && !('content' in h) && !('id' in h)) {
    return { ok: false, items: [], skipped: 0, message: 'CSVファイルの形式が正しくありません' };
  }
  const items: Memo[] = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r += 1) {
    try {
      const row = rows[r];
      const tagsRaw = cellAt(row, h['tags']);
      const tags = tagsRaw
        .split(/[；,]/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const category = cellAt(row, h['category']);
      if (category.length > 0 && !tags.includes(category)) tags.push(category);
      const createdAt = parseMs(cellAt(row, h['createdat']));
      items.push({
        id: cellAt(row, h['id']) || genId(),
        title: cellAt(row, h['title']) || '無題メモ',
        body: cellAt(row, h['content']),
        tags,
        pinned: false,
        source: 'manual',
        createdAt,
        updatedAt: parseMs(cellAt(row, h['updatedat'])) || createdAt,
      });
    } catch {
      skipped += 1;
    }
  }
  return { ok: true, items, skipped };
}

// ── 予定 CSV ────────────────────────────────────────────────────────────────

export function importSchedulesFromCsv(text: string): CsvImportResult<Reservation> {
  const rows = parseCsv(text);
  if (rows.length < 1) {
    return { ok: false, items: [], skipped: 0, message: 'CSVファイルの形式が正しくありません' };
  }
  const h = headerIndex(rows[0]);
  if (!('title' in h) && !('date' in h) && !('id' in h)) {
    return { ok: false, items: [], skipped: 0, message: 'CSVファイルの形式が正しくありません' };
  }
  const items: Reservation[] = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r += 1) {
    try {
      const row = rows[r];
      const date = cellAt(row, h['date']) || todayYmd();
      const startTime = cellAt(row, h['starttime']);
      const endTime = cellAt(row, h['endtime']);
      const datetime =
        [date, startTime].filter((s) => s.length > 0).join(' ') + (endTime ? `-${endTime}` : '');
      items.push({
        id: cellAt(row, h['id']) || genId(),
        name: cellAt(row, h['title']) || '無題の予定',
        datetime,
        content: cellAt(row, h['description']),
        note: cellAt(row, h['location']),
        createdAt: parseMs(cellAt(row, h['createdat'])),
        updatedAt: parseMs(cellAt(row, h['updatedat'])) || parseMs(cellAt(row, h['createdat'])),
      });
    } catch {
      skipped += 1;
    }
  }
  return { ok: true, items, skipped };
}

// ── AIチャット履歴 CSV ──────────────────────────────────────────────────────

export function importChatFromCsv(text: string): CsvImportResult<ChatMessage> {
  const rows = parseCsv(text);
  if (rows.length < 1) {
    return { ok: false, items: [], skipped: 0, message: 'CSVファイルの形式が正しくありません' };
  }
  const h = headerIndex(rows[0]);
  if (!('content' in h) && !('role' in h) && !('id' in h)) {
    return { ok: false, items: [], skipped: 0, message: 'CSVファイルの形式が正しくありません' };
  }
  const items: ChatMessage[] = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const content = cellAt(row, h['content']);
    if (content.length === 0) {
      skipped += 1; // 本文空はスキップ
      continue;
    }
    const roleRaw = cellAt(row, h['role']).toLowerCase();
    const role: ChatMessage['role'] = roleRaw === 'assistant' ? 'assistant' : 'user';
    items.push({
      id: cellAt(row, h['id']) || genId(),
      role,
      text: content,
    });
  }
  return { ok: true, items, skipped };
}
