import type { Memo, Reservation } from '@/lib/types';
import type { RefTarget } from '@/lib/consult-store';
import type { DriveReferenceMemo } from '@/components/DriveExportedFilesList';
import { ollamaChat, type OllamaSettings } from './ollama';

// モバイル AI 相談に渡す Google Drive 参照メモの上限（OBS36 設計・Phase M1）。
// デスクトップ（DesktopMemos.tsx の DRIVE_REF_AI_MAX_*）と同一の値・同一の形式を保つ。
export const DRIVE_REF_AI_MAX_ITEMS = 5;
const DRIVE_REF_AI_MAX_CHARS = 200;
const DRIVE_REF_AI_MAX_TITLE = 60;

/**
 * 読み込み済み Drive 参照メモを、AI に渡す「別ブロック」の文字列へ整形する（OBS36・Phase M1）。
 * - 本体メモ（source of truth）とは必ず別見出しにする（黙って混ぜない）。
 * - 先頭 DRIVE_REF_AI_MAX_ITEMS 件まで・本文は各 DRIVE_REF_AI_MAX_CHARS 字まで・タイトルは切り詰める。
 * - 参照が0件なら空文字を返す（呼び出し側で「足さない＝挙動不変」に使う）。
 * - デスクトップの buildDriveReferenceBlock（DesktopMemos.tsx）と同じ規則。
 */
function buildDriveReferenceBlock(refs: DriveReferenceMemo[]): string {
  if (refs.length === 0) return '';
  const items = refs.slice(0, DRIVE_REF_AI_MAX_ITEMS);
  const lines = items.map((r, i) => {
    const title = (r.title || r.fileName || '無題').trim().replace(/\s+/g, ' ').slice(0, DRIVE_REF_AI_MAX_TITLE);
    const body = (r.body || '').trim().replace(/\s+/g, ' ').slice(0, DRIVE_REF_AI_MAX_CHARS);
    const tagLine = r.tags.length > 0 ? `\n   タグ：${r.tags.map((t) => `#${t}`).join(' ')}` : '';
    return `${i + 1}. タイトル：${title}${tagLine}\n   本文（抜粋）：${body || '（本文なし）'}`;
  });
  return `【Google Drive参照メモ（MyBrain本体ではありません／エクスポート済みファイルの参考）】\n${lines.join('\n')}`;
}

/** メモ本文を安全に取り出す（body 優先、旧構造も拾う） */
function memoBody(m: Memo): string {
  const anyM = m as unknown as Record<string, unknown>;
  const v = m.body ?? anyM.content ?? anyM.transcript ?? anyM.summary ?? '';
  return typeof v === 'string' ? v : String(v ?? '');
}

function recentBy<T extends { createdAt?: number; updatedAt?: number }>(list: T[], n: number): T[] {
  return [...list]
    .sort((a, b) => Math.max(b.createdAt || 0, b.updatedAt || 0) - Math.max(a.createdAt || 0, a.updatedAt || 0))
    .slice(0, n);
}

function whenLabel(ms: number | null | undefined): string {
  if (!ms) return '日時未設定';
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** メモ・予定から Ollama に渡すコンテキスト文字列を組み立てる（件数は上限あり） */
function buildContext(refTarget: RefTarget, memos: Memo[], reservations: Reservation[]): string {
  const useMemos = refTarget === 'both' || refTarget === 'memos';
  const useSched = refTarget === 'both' || refTarget === 'schedule';
  const blocks: string[] = [];

  if (useMemos) {
    const items = recentBy(memos, 20);
    if (items.length > 0) {
      const lines = items.map((m, i) => {
        const body = memoBody(m).trim().replace(/\s+/g, ' ').slice(0, 200);
        return `${i + 1}. 【${m.title || '無題'}】${body}`;
      });
      blocks.push(`■ メモ（新しい順・最大20件）\n${lines.join('\n')}`);
    } else {
      blocks.push('■ メモ：登録なし');
    }
  }

  if (useSched) {
    const items = recentBy(reservations, 20);
    if (items.length > 0) {
      const lines = items.map((r, i) => {
        const c = (r.content || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        return `${i + 1}. ${whenLabel(r.scheduleAt)}｜${r.title || '無題'}${c ? `（${c}）` : ''}`;
      });
      blocks.push(`■ 予定（新しい順・最大20件）\n${lines.join('\n')}`);
    } else {
      blocks.push('■ 予定：登録なし');
    }
  }

  return blocks.join('\n\n');
}

/**
 * Ollama に相談・要約・メモ整理を依頼する。
 * 保存済みのメモ・予定をコンテキストとして渡し、日本語で回答させる。
 *
 * driveRefs（省略可・OBS36 Phase M1）：読み込み済み Google Drive 参照メモ。
 * - 未指定・0件なら送信内容は従来と完全に同じ（挙動不変）。
 * - 1件以上なら、先頭5件・本文各約200字の別ブロックとして user メッセージ末尾に追記し、
 *   system に「参照メモは補助」の1文を足す（デスクトップ Phase 3b と同じ規則）。
 */
export async function askOllamaConsult(
  question: string,
  refTarget: RefTarget,
  memos: Memo[],
  reservations: Reservation[],
  settings: OllamaSettings,
  driveRefs?: DriveReferenceMemo[],
): Promise<string> {
  const context = buildContext(refTarget, memos, reservations);
  const refBlock = buildDriveReferenceBlock(driveRefs ?? []);
  const system =
    'あなたは「MyBrain」という個人向けノート/予定管理アプリの日本語アシスタントです。' +
    'ユーザーの保存済みメモと予定（コンテキスト）だけを根拠に、簡潔で分かりやすい日本語で回答してください。' +
    '相談・要約・メモ整理のいずれにも対応します。コンテキストに無いことは推測せず「該当する記録は見つかりませんでした」と述べてください。' +
    (refBlock
      ? '「Google Drive参照メモ」は補助的な参考情報です。回答の主な根拠は保存済みのメモ・予定とし、参照メモを使ったときはその旨が分かるように答えてください。'
      : '');
  const user =
    `# 質問\n${question}\n\n# コンテキスト（あなたが参照できる保存データ）\n${context}` +
    (refBlock ? `\n\n${refBlock}` : '');

  return ollamaChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    settings,
  );
}
