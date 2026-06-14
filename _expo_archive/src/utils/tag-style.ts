/**
 * タグ名ごとの色分け定義。
 *
 * 淡色（背景）＋同系の濃色（文字・枠線）で、スマホでも見やすくする。
 * React Native / Web 両対応のため、明示的なカラーコードのみ使用する。
 * 内部データに「予約」が残っていても表示・色は「予定」として扱う。
 */

export interface TagStyle {
  bg: string;
  text: string;
  border: string;
}

const TAG_COLORS: Record<string, TagStyle> = {
  予定: { bg: '#DCE9FF', text: '#1B4D9B', border: '#3C87F7' }, // 青系
  顧客: { bg: '#ECE1FB', text: '#5B2A9B', border: '#8B5CF6' }, // 紫系
  売上: { bg: '#DCF5E5', text: '#1B7A45', border: '#22C55E' }, // 緑系
  注意: { bg: '#FBE0E1', text: '#9B1B22', border: '#E5484D' }, // 赤系
  アイデア: { bg: '#FCF3D0', text: '#8A6D1B', border: '#EAB308' }, // 黄系
  レシピ: { bg: '#FBE0EE', text: '#9B2A66', border: '#EC4899' }, // ピンク系
  タスク: { bg: '#E3E4E8', text: '#44474E', border: '#9AA0A6' }, // グレー系
};

// その他（未定義タグ）用の淡いグレー
const DEFAULT_STYLE: TagStyle = { bg: '#EEEFF2', text: '#60646C', border: '#C7CAD1' };

// 表示・色の正規化（「予約」→「予定」）
export function normalizeTag(tag: string): string {
  return tag === '予約' ? '予定' : tag;
}

export function getTagStyle(tagName: string): TagStyle {
  return TAG_COLORS[normalizeTag(tagName)] ?? DEFAULT_STYLE;
}
