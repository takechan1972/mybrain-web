import type { Memo } from '../types';
import { MEMO_MARKDOWN_SOURCE } from '../markdown/memo-markdown';
import type { ImportCandidate } from './import-candidate';

/**
 * メモ取り込み（インポート）の純ヘルパー：重複検知と保存対象の選別（IMP1）。
 *
 * - 設計：docs/memo-import-design.md（OBS43）§10。
 * - 純関数のみ（非破壊。渡された配列・候補は変更せず、新しい値を返す）。
 * - 判定は選択直後（プレビュー構築時）に1回行う想定（設計 §5）。
 * - insert-only の原則：ここに既存メモの更新・上書き・削除の経路は存在しない。
 * - バッチ内（選択ファイル同士）の重複検知は IMP1 では行わない（設計どおり・既知の限界）。
 */

/** 保存時の既定タイトル（既存の createMemo と同じ値） */
const UNTITLED_TITLE = '無題';

/**
 * 「保存されるとおりの値」で比較キーを作る（設計 §10 の解釈）。
 * - タイトル：trim・空なら「無題」（既存の保存挙動と同じ正規化）。
 * - 本文：trim（既存の保存挙動と同じ）。
 * - 既存メモは保存時に正規化済みだが、安全のため両辺に同じ正規化を適用する。
 */
function savedContentKey(title: string, body: string): string {
  const normalizedTitle = (title ?? '').trim() || UNTITLED_TITLE;
  const normalizedBody = (body ?? '').trim();
  // 区切り文字の混入による誤一致を防ぐため、JSON 配列表現を比較キーにする
  return JSON.stringify([normalizedTitle, normalizedBody]);
}

/**
 * 'ok' の候補を既存メモと突き合わせ、重複を再分類した新しい配列を返す（設計 §10）。
 *
 * 優先順：
 * 1. frontmatter の id が既存メモの id と一致 かつ source==="mybrain"
 *    → 'duplicate-id'（重複（同じメモID）。常にスキップ・選択肢なし）。
 * 2. タイトル＋本文が既存メモと完全一致（保存されるとおりの値で比較）
 *    → 'duplicate-content'（重複の可能性。既定スキップ・「新しいメモとして取り込む」を選択可）。
 *
 * - 'invalid' は再分類しない。'duplicate-id' / 'duplicate-content' も再判定しない（1回判定の想定）。
 * - 既存メモ側は一切変更しない（読み取りのみ）。
 */
export function detectImportDuplicates(
  candidates: ImportCandidate[],
  existingMemos: Memo[],
): ImportCandidate[] {
  const existingIds = new Set<string>();
  const existingContentKeys = new Set<string>();
  for (const memo of Array.isArray(existingMemos) ? existingMemos : []) {
    if (memo.id) existingIds.add(memo.id);
    existingContentKeys.add(savedContentKey(memo.title, memo.body));
  }

  return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    if (candidate.status !== 'ok' || candidate.parsed === null) return candidate;

    // ① 重複（同じメモID）：MyBrain 由来（source==="mybrain"）の id 一致のみ。常にスキップ。
    if (
      candidate.parsed.sourceId.length > 0 &&
      candidate.parsed.source === MEMO_MARKDOWN_SOURCE &&
      existingIds.has(candidate.parsed.sourceId)
    ) {
      return {
        ...candidate,
        status: 'duplicate-id' as const,
        reason: '同じメモIDのメモが既に存在するためスキップします。',
        importAsNew: false,
      };
    }

    // ② 重複の可能性：タイトル＋本文の完全一致（保存されるとおりの値で比較）。既定スキップ。
    if (existingContentKeys.has(savedContentKey(candidate.parsed.title, candidate.parsed.body))) {
      return {
        ...candidate,
        status: 'duplicate-content' as const,
        reason: 'タイトルと本文が同じメモが既に存在します（既定ではスキップされます）。',
        importAsNew: false,
      };
    }

    return candidate;
  });
}

/**
 * 「重複の可能性」（duplicate-content）の候補だけ importAsNew を設定した新しい候補を返す（設計 §10）。
 * - それ以外の status（ok / duplicate-id / invalid）は変更せずそのまま返す
 *   （duplicate-id と invalid に取り込みの選択肢はない）。
 */
export function setImportAsNew(candidate: ImportCandidate, importAsNew: boolean): ImportCandidate {
  if (candidate.status !== 'duplicate-content') return candidate;
  return { ...candidate, importAsNew };
}

/**
 * 保存対象の候補を返す（設計 §15）：
 * - 'ok' の全件。
 * - 'duplicate-content' のうち、ユーザーが明示的に「新しいメモとして取り込む」を選んだもの。
 * - 'duplicate-id' と 'invalid' は決して含まれない。
 */
export function listImportTargets(candidates: ImportCandidate[]): ImportCandidate[] {
  return (Array.isArray(candidates) ? candidates : []).filter(
    (candidate) =>
      candidate.parsed !== null &&
      (candidate.status === 'ok' ||
        (candidate.status === 'duplicate-content' && candidate.importAsNew)),
  );
}
