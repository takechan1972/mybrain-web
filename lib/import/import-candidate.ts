import { markdownToMemo } from '../markdown/memo-markdown';

/**
 * メモ取り込み（インポート）の純ヘルパー：取り込み候補の生成（IMP1）。
 *
 * - 設計：docs/memo-import-design.md（OBS43）§3・§5〜§9・§11。
 * - 純関数のみ。DOM・File・FileReader・fetch・UI には依存しない
 *   （ファイルの読み取り自体は IMP2 の UI 側の責務。ここは読み取り済みテキストを受け取る）。
 * - 解析は既存の markdownToMemo を再利用する（新しいパーサは作らない）。
 * - ここでは保存しない。保存（insert-only）は確認後に呼び出し側が行う。
 */

/**
 * 1ファイルあたりの上限サイズ（バイト）。設計 §11。
 * Drive 読み取りの前例（DRIVE_MARKDOWN_READ_MAX_BYTES）と同じ値を独立定数として持つ。
 */
export const IMPORT_MAX_FILE_BYTES = 1024 * 1024;

/**
 * 1回の取り込みで選択できる最大ファイル数。設計 §3。
 * 21件以上は案内を出して取り込みを開始しない（先頭20件だけ処理する方式は採らない）。
 * この定数の enforcement は UI（IMP2）が行う。ここでは値の提供のみ。
 */
export const IMPORT_MAX_FILES_PER_BATCH = 20;

/** 取り込み候補1件の判定状態（設計 §5） */
export type ImportCandidateStatus =
  | 'ok'                // 取り込み可能
  | 'duplicate-id'      // 重複（同じメモID）：frontmatter id＋source==="mybrain" が既存メモと一致
  | 'duplicate-content' // 重複の可能性：タイトル＋本文が既存メモと完全一致
  | 'invalid';          // エラー（拡張子・サイズ超過・空・読み取り不能 等）

/** 解析・正規化済みの保存候補データ（invalid のときは持たない） */
export interface ImportCandidateParsed {
  /** frontmatter の id（無ければ ''）。重複検知・由来表示のみに使い、保存には使わない */
  sourceId: string;
  /** frontmatter の source（無ければ ''） */
  source: string;
  /** 確定タイトル（frontmatter title → ファイル名（.md 除去））。空なら保存時に「無題」になる */
  title: string;
  /** 本文（改変しない。trim は保存時の既存挙動に委ねる） */
  body: string;
  /** 正規化済みタグ（trim・空除去・重複統合・先頭出現順を維持） */
  tags: string[];
  /** 保存に使う作成日時（epoch ms。フォールバック適用済み） */
  createdAt: number;
  /** 保存に使う更新日時（epoch ms。フォールバック適用済み） */
  updatedAt: number;
  /** created が frontmatter 由来か（false＝取り込み時刻フォールバック） */
  createdFromFrontmatter: boolean;
  /** updated が frontmatter 由来か */
  updatedFromFrontmatter: boolean;
}

/** 取り込み候補1件（プレビュー・確認・保存の共通データ。設計 §5） */
export interface ImportCandidate {
  /** 選択されたファイル名（例: "買い物メモ.md"） */
  fileName: string;
  /** 判定状態 */
  status: ImportCandidateStatus;
  /** スキップ・エラー時の理由（やさしい日本語。ok のときは null） */
  reason: string | null;
  /** 解析・正規化済みデータ（invalid のときは null） */
  parsed: ImportCandidateParsed | null;
  /**
   * 「重複の可能性」（duplicate-content）の項目だけ、ユーザーが明示的に
   * 「新しいメモとして取り込む」を選べる（既定 false＝スキップ）。
   */
  importAsNew: boolean;
}

/**
 * 確定タイトルを解決する（設計 §6）。
 * 1. frontmatter の title（trim 後に非空ならそれ）。
 * 2. 無ければファイル名から拡張子 .md（大文字小文字問わず）を除いたもの（trim 後）。
 * 3. それも空なら ''（保存時に既存挙動で「無題」になる）。
 */
export function resolveImportTitle(frontmatterTitle: string, fileName: string): string {
  const fromFrontmatter = (frontmatterTitle ?? '').trim();
  if (fromFrontmatter.length > 0) return fromFrontmatter;
  return (fileName ?? '').replace(/\.md$/i, '').trim();
}

/**
 * タグを正規化する（設計 §9）：trim → 空要素除去 → 完全一致の重複を統合（先頭出現順を維持）。
 * それ以外の新しいタグ規則（小文字化・記号除去など）は足さない。
 */
export function normalizeImportTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = (raw ?? '').trim();
    if (tag.length === 0) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

/** normalizeImportTimestamps の結果 */
export interface NormalizedImportTimestamps {
  createdAt: number;
  updatedAt: number;
  createdFromFrontmatter: boolean;
  updatedFromFrontmatter: boolean;
}

/**
 * 日時を正規化する（設計 §8・承認済みルール）。
 * 入力は markdownToMemo の解析結果（0＝無効・欠落）。
 *
 * - created 有効 → 保持。無効・欠落 → 取り込み時刻。
 * - updated 有効 かつ updated ≥ 採用した created → 保持。
 * - updated 無効・欠落・逆転（updated < created）→ 採用した created を使う。
 */
export function normalizeImportTimestamps(
  createdAtMs: number,
  updatedAtMs: number,
  importTimeMs: number,
): NormalizedImportTimestamps {
  const createdValid = Number.isFinite(createdAtMs) && createdAtMs > 0;
  const createdAt = createdValid ? createdAtMs : importTimeMs;

  const updatedValid =
    Number.isFinite(updatedAtMs) && updatedAtMs > 0 && updatedAtMs >= createdAt;
  const updatedAt = updatedValid ? updatedAtMs : createdAt;

  return {
    createdAt,
    updatedAt,
    createdFromFrontmatter: createdValid,
    updatedFromFrontmatter: updatedValid,
  };
}

/** buildImportCandidate の入力 */
export interface BuildImportCandidateInput {
  /** 選択されたファイル名（例: "買い物メモ.md"） */
  fileName: string;
  /** ファイルサイズ（バイト） */
  fileSizeBytes: number;
  /** 読み取り済みの Markdown テキスト。null＝読み取り失敗 */
  markdownText: string | null;
  /** 取り込み時刻（epoch ms）。省略時は Date.now()。検証を決定的にするため注入可能 */
  importTimeMs?: number;
}

/** invalid 候補を作る内部ヘルパー */
function invalidCandidate(fileName: string, reason: string): ImportCandidate {
  return { fileName, status: 'invalid', reason, parsed: null, importAsNew: false };
}

/**
 * 1ファイル分を検証・解析・正規化して取り込み候補にする（設計 §5〜§9・§11）。
 *
 * - ここでの status は 'ok' か 'invalid' のみ。重複判定は detectImportDuplicates が行う。
 * - invalid（理由付きスキップ）：.md 以外／1MB 超／読み取り失敗／確定タイトル・本文の両方が空。
 * - 1件の invalid は他ファイルの処理を止めない（呼び出し側は候補ごとに本関数を呼ぶだけ）。
 */
export function buildImportCandidate(input: BuildImportCandidateInput): ImportCandidate {
  const fileName = input.fileName ?? '';
  const importTimeMs = input.importTimeMs ?? Date.now();

  // 拡張子チェック（大文字小文字問わず）
  if (!/\.md$/i.test(fileName.trim())) {
    return invalidCandidate(fileName, '.mdファイルではないため取り込めません。');
  }

  // サイズ情報の異常（負値・非数）は読み取り失敗として扱う
  if (!Number.isFinite(input.fileSizeBytes) || input.fileSizeBytes < 0) {
    return invalidCandidate(fileName, 'ファイルを読み取れませんでした。');
  }

  // 1MB 上限（設計 §11）
  if (input.fileSizeBytes > IMPORT_MAX_FILE_BYTES) {
    return invalidCandidate(fileName, '1MBを超えているため取り込めません。');
  }

  // 読み取り失敗
  if (input.markdownText === null) {
    return invalidCandidate(fileName, 'ファイルを読み取れませんでした。');
  }

  // 既存パーサで解析（frontmatter 無しは「全文＝本文」に安全フォールバック）
  const parsedMarkdown = markdownToMemo(input.markdownText);

  const title = resolveImportTitle(parsedMarkdown.title, fileName);
  const body = parsedMarkdown.body ?? '';

  // 確定タイトル・本文の両方が空 → 取り込み対象にしない（設計 §7・§11）
  if (title.length === 0 && body.trim().length === 0) {
    return invalidCandidate(fileName, 'メモの内容が空のため取り込めません。');
  }

  const timestamps = normalizeImportTimestamps(
    parsedMarkdown.createdAt,
    parsedMarkdown.updatedAt,
    importTimeMs,
  );

  return {
    fileName,
    status: 'ok',
    reason: null,
    parsed: {
      sourceId: parsedMarkdown.id,
      source: parsedMarkdown.source,
      title,
      body,
      tags: normalizeImportTags(parsedMarkdown.tags),
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt,
      createdFromFrontmatter: timestamps.createdFromFrontmatter,
      updatedFromFrontmatter: timestamps.updatedFromFrontmatter,
    },
    importAsNew: false,
  };
}
