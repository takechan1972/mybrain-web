import type { Memo, MemoInput } from '../types';

/**
 * MyBrain のメモ ⇄ Obsidian 互換 Markdown（YAML フロントマター付き）の相互変換。
 *
 * Phase 0：純粋な変換ユーティリティのみ。
 * - UI・保存処理（lib/memos.ts）・Supabase スキーマには一切接続しない。
 * - 将来、保存先を Obsidian Vault（ローカル/Google Drive 等）にしたときの
 *   「メモの正準フォーマット」を確定するための土台。
 *
 * フロントマター項目：
 *   id      … MyBrain のメモID（往復用）
 *   title   … タイトル
 *   tags    … タグ（YAML フロー配列）
 *   created … 作成日時（ISO 8601）
 *   updated … 更新日時（ISO 8601）
 *   source  … 由来。常に "mybrain"
 *   images  … 添付画像の件数（画像がある時のみ出力。data URI 本体は含めない）
 *
 * 本文はフロントマターの下に、そのまま Markdown 本文として置く。
 */

/** source フロントマターの固定値 */
export const MEMO_MARKDOWN_SOURCE = 'mybrain';

/** Markdown から読み取った内容（メモを復元するための全フィールド） */
export interface ParsedMemoMarkdown {
  id: string;
  title: string;
  tags: string[];
  body: string;
  /** 作成日時（epoch ms。フロントマターに無効/無ければ 0） */
  createdAt: number;
  /** 更新日時（epoch ms。フロントマターに無効/無ければ 0） */
  updatedAt: number;
  /** source フロントマター（無ければ ''） */
  source: string;
}

// ── シリアライズ（Memo → Markdown） ──────────────────────────

/** YAML 用にダブルクオートで安全に囲む（バックスラッシュ・引用符をエスケープ、改行は空白化） */
function yamlQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ');
  return `"${escaped}"`;
}

/** epoch ms → ISO 8601。無効/0 のときは空文字 */
function msToIso(ms: number): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** タグ配列を YAML フロー配列にする（例：["a", "b"]／空なら []） */
function tagsToYamlFlow(tags: string[]): string {
  const clean = (Array.isArray(tags) ? tags : []).map((t) => (t ?? '').trim()).filter((t) => t.length > 0);
  if (clean.length === 0) return '[]';
  return `[${clean.map(yamlQuote).join(', ')}]`;
}

/**
 * Memo を Obsidian 互換 Markdown（フロントマター＋本文）に変換する。
 * - 既存の保存処理には影響しない純関数。
 */
export function memoToMarkdown(memo: Memo): string {
  // 添付画像の件数（data URI 本体は Markdown に含めない＝巨大化・実体は MyBrain に保存）。
  // 画像がある時だけ frontmatter に件数を出し、Obsidian 側でも「添付あり」が分かるようにする。
  const imageCount = Array.isArray(memo.images) ? memo.images.length : 0;
  const lines = [
    '---',
    `id: ${yamlQuote(memo.id ?? '')}`,
    `title: ${yamlQuote(memo.title ?? '')}`,
    `tags: ${tagsToYamlFlow(memo.tags ?? [])}`,
    `created: ${yamlQuote(msToIso(memo.createdAt))}`,
    `updated: ${yamlQuote(msToIso(memo.updatedAt))}`,
    `source: ${yamlQuote(MEMO_MARKDOWN_SOURCE)}`,
  ];
  if (imageCount > 0) lines.push(`images: ${imageCount}`);
  lines.push('---');
  const frontmatter = lines.join('\n');

  const body = memo.body ?? '';
  // フロントマターの後に空行を1つ入れて本文を続ける（Obsidian の慣習）。
  return body.length > 0 ? `${frontmatter}\n\n${body}\n` : `${frontmatter}\n`;
}

// ── パース（Markdown → Memo データ） ──────────────────────────

/** ダブルクオートで囲まれていれば外してアンエスケープ。素の値ならそのまま返す */
function yamlUnquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return v;
}

/** YAML フロー配列（["a","b"]）または素の [a, b] を文字列配列に */
function parseYamlFlowTags(raw: string): string[] {
  const v = raw.trim();
  if (!v.startsWith('[') || !v.endsWith(']')) return [];
  const inner = v.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner
    .split(',')
    .map((s) => yamlUnquote(s))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** ISO 8601 → epoch ms（無効なら 0） */
function isoToMs(iso: string): number {
  const v = iso.trim();
  if (v.length === 0) return 0;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Obsidian 互換 Markdown（フロントマター＋本文）を解析して、メモ復元用のデータにする。
 * - フロントマターが無い場合は、全文を本文として扱う（title/tags は空、日時は 0）。
 * - tags はフロー配列（["a","b"]）と素の [a, b] に対応。
 */
export function markdownToMemo(markdown: string): ParsedMemoMarkdown {
  const text = markdown ?? '';
  const empty: ParsedMemoMarkdown = {
    id: '',
    title: '',
    tags: [],
    body: text.replace(/^\s+/, ''),
    createdAt: 0,
    updatedAt: 0,
    source: '',
  };

  // 先頭の `---` … `---` をフロントマターとして取り出す。
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return empty;

  const fmBlock = match[1];
  const body = text.slice(match[0].length).replace(/^\r?\n/, ''); // 直後の空行を1つ取り除く

  const fields: Record<string, string> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key.length > 0) fields[key] = value;
  }

  return {
    id: fields.id !== undefined ? yamlUnquote(fields.id) : '',
    title: fields.title !== undefined ? yamlUnquote(fields.title) : '',
    tags: fields.tags !== undefined ? parseYamlFlowTags(fields.tags) : [],
    body,
    createdAt: fields.created !== undefined ? isoToMs(yamlUnquote(fields.created)) : 0,
    updatedAt: fields.updated !== undefined ? isoToMs(yamlUnquote(fields.updated)) : 0,
    source: fields.source !== undefined ? yamlUnquote(fields.source) : '',
  };
}

/**
 * Markdown を MemoInput（保存入力）へ変換する補助。
 * - Phase 0 では本文・タイトル・タグのみ（images は Markdown に含めないため空配列）。
 * - まだ保存処理には接続しない。
 */
export function markdownToMemoInput(markdown: string): MemoInput {
  const parsed = markdownToMemo(markdown);
  return {
    title: parsed.title,
    body: parsed.body,
    tags: parsed.tags,
    images: [],
  };
}
