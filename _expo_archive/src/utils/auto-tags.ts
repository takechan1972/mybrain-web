/**
 * 簡易ルールベースの自動タグ判定。
 *
 * 本物の AI/API は使わず、キーワードの含有でタグ候補を返す。
 * 大文字小文字は区別しない。
 */

interface TagRule {
  tag: string;
  keywords: string[];
}

export const AUTO_TAG_RULES: TagRule[] = [
  { tag: '予定', keywords: ['予定', '予約', '日時', '来店', '打合せ', '会議', '締切', 'イベント'] },
  { tag: '顧客', keywords: ['お客様', '顧客', '名前', '連絡'] },
  { tag: '売上', keywords: ['売上', '金額', '入金', '請求'] },
  { tag: '注意', keywords: ['クレーム', '不満', 'トラブル'] },
  { tag: 'アイデア', keywords: ['アイデア', '改善', '思いつき'] },
  { tag: 'レシピ', keywords: ['レシピ', '材料', '焼き菓子', 'ケーキ'] },
  { tag: 'タスク', keywords: ['タスク', 'やること', 'todo'] },
];

/**
 * 与えたテキスト（タイトル＋本文など）から該当するタグ候補を返す。
 * 重複は除去済み。ルール定義順を維持する。
 */
export function suggestTags(text: string): string[] {
  const lower = text.toLowerCase();
  const result: string[] = [];
  for (const rule of AUTO_TAG_RULES) {
    const hit = rule.keywords.some((kw) => lower.includes(kw.toLowerCase()));
    if (hit && !result.includes(rule.tag)) {
      result.push(rule.tag);
    }
  }
  return result;
}

// ── 保存時の自動タグ（ローカルのルールベース。AI/APIは使わない） ───────────────

// カテゴリ分類ルール（キーワード含有でカテゴリタグを付与）
const CATEGORY_RULES: TagRule[] = [
  { tag: 'お菓子', keywords: ['ケーキ', 'パウンドケーキ', '焼き菓子', 'クッキー', 'チーズケーキ', 'お菓子', 'スイーツ'] },
  { tag: 'レシピ', keywords: ['レシピ', '材料', '焼く', '作り方', '焼きたい', '生地', 'オーブン'] },
  { tag: '仕事', keywords: ['見積', '請求', '売上', '入金', '領収書', '納品書'] },
  { tag: '打ち合わせ', keywords: ['打ち合わせ', '打合せ', '商談', '会議', 'ミーティング', 'さん'] },
  { tag: '健康', keywords: ['歯医者', '病院', '薬', '体調', '通院', '診察'] },
  { tag: '買い物', keywords: ['買い物', '卵', '牛乳', '材料', '購入', 'スーパー'] },
  { tag: '予定', keywords: ['予定', '予約', '訪問', '納品', '来店', '締切'] },
  { tag: 'AI', keywords: ['ai', 'chatgpt', 'アプリ', 'システム', 'プログラム'] },
];

const MAX_AUTO_TAGS = 5;

/**
 * タイトル＋本文からカテゴリ自動タグを生成する（ローカルのルールベース・AI不使用）。
 * - 最大 MAX_AUTO_TAGS 個
 * - 1つも該当しなければ「メモ」を付ける
 */
export function generateAutoTags(title: string, body: string): string[] {
  const lower = `${title} ${body}`.toLowerCase();
  const result: string[] = [];
  for (const rule of CATEGORY_RULES) {
    if (result.length >= MAX_AUTO_TAGS) break;
    const hit = rule.keywords.some((kw) => lower.includes(kw.toLowerCase()));
    if (hit && !result.includes(rule.tag)) result.push(rule.tag);
  }
  if (result.length === 0) result.push('メモ');
  return result;
}

/**
 * 手動タグと自動タグを統合する。
 * - 手動タグを優先し順序を維持
 * - 重複を除去
 * - 合計を最大 MAX_AUTO_TAGS 個に制限
 */
export function mergeTags(manualTags: string[], autoTags: string[]): string[] {
  const merged: string[] = [];
  for (const t of [...manualTags, ...autoTags]) {
    const tag = t.trim();
    if (tag.length > 0 && !merged.includes(tag)) merged.push(tag);
  }
  return merged.slice(0, MAX_AUTO_TAGS);
}
