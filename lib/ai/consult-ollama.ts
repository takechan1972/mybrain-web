import type { Memo, Reservation } from '@/lib/types';
import type { RefTarget } from '@/lib/consult-store';
import { ollamaChat, type OllamaSettings } from './ollama';

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
 */
export async function askOllamaConsult(
  question: string,
  refTarget: RefTarget,
  memos: Memo[],
  reservations: Reservation[],
  settings: OllamaSettings,
): Promise<string> {
  const context = buildContext(refTarget, memos, reservations);
  const system =
    'あなたは「MyBrain」という個人向けノート/予定管理アプリの日本語アシスタントです。' +
    'ユーザーの保存済みメモと予定（コンテキスト）だけを根拠に、簡潔で分かりやすい日本語で回答してください。' +
    '相談・要約・メモ整理のいずれにも対応します。コンテキストに無いことは推測せず「該当する記録は見つかりませんでした」と述べてください。';
  const user = `# 質問\n${question}\n\n# コンテキスト（あなたが参照できる保存データ）\n${context}`;

  return ollamaChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    settings,
  );
}
