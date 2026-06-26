/**
 * 一括 Obsidian エクスポート用のメモ選択モデル（設計メモ・ドキュメントのみ）。
 *
 * このファイルは「複数メモをどう選ぶか（選択状態の考え方）」を整理した内部ノートです。
 * - 実装はまだしない。runtime の副作用なし・ブラウザ API 呼び出しなし・依存追加なし。
 * - どこからも import しない（純粋なドキュメント置き場）。
 * - 現状の保存挙動は不変（MyBrain/Supabase が source of truth）。
 *
 * 関連設計メモ：
 * - obsidian-list-export-flow-strategy.ts（メモ一覧からの一括エクスポート導線）
 * - obsidian-bulk-export-strategy.ts（一括エクスポートの戦略候補）
 *
 * 各トピックは定数として export しておき、将来実装時の参照・分岐キーに使えるようにする。
 */

/** メモ選択モデルの設計トピック識別子。 */
export type ObsidianMemoSelectionModelTopic =
  | 'selection-mode-entry'
  | 'individual-selection'
  | 'select-all-visible'
  | 'filtered-selection'
  | 'selected-count-display'
  | 'clear-selection'
  | 'selection-limit'
  | 'export-action-availability';

/**
 * selection-mode-entry：将来、ユーザーがどうやって選択モードに入るか。
 * - 通常の閲覧を邪魔しない、分かりやすい入口にする。
 */
export const TOPIC_SELECTION_MODE_ENTRY: ObsidianMemoSelectionModelTopic = 'selection-mode-entry';

/**
 * individual-selection：メモを1件ずつ選ぶ。
 * - チェックなどで個別に選択・解除できるようにする。
 */
export const TOPIC_INDIVIDUAL_SELECTION: ObsidianMemoSelectionModelTopic = 'individual-selection';

/**
 * select-all-visible：将来、今表示中のメモをまとめて選ぶ。
 * - 「見えている分だけ」を対象にし、隠れている分は含めない。
 */
export const TOPIC_SELECT_ALL_VISIBLE: ObsidianMemoSelectionModelTopic = 'select-all-visible';

/**
 * filtered-selection：選択は今の検索・絞り込みに従う。
 * - 検索やフィルタで表示されているメモだけを選択対象にする。
 */
export const TOPIC_FILTERED_SELECTION: ObsidianMemoSelectionModelTopic = 'filtered-selection';

/**
 * selected-count-display：今いくつ選ばれているかを表示する。
 * - 「3件 選択中」のように、件数を分かりやすく出す。
 */
export const TOPIC_SELECTED_COUNT_DISPLAY: ObsidianMemoSelectionModelTopic = 'selected-count-display';

/**
 * clear-selection：選択をまとめて解除できるようにする。
 * - ワンタップで全部の選択を外せるようにする。
 */
export const TOPIC_CLEAR_SELECTION: ObsidianMemoSelectionModelTopic = 'clear-selection';

/**
 * selection-limit：安全な選択数の上限を検討する。
 * - 端末・ブラウザの負荷を考え、多すぎる選択には上限や警告を設ける。
 */
export const TOPIC_SELECTION_LIMIT: ObsidianMemoSelectionModelTopic = 'selection-limit';

/**
 * export-action-availability：何も選ばれていないときはエクスポートを押せないようにする。
 * - 0件のときはエクスポート操作を無効化する。
 */
export const TOPIC_EXPORT_ACTION_AVAILABILITY: ObsidianMemoSelectionModelTopic = 'export-action-availability';

/**
 * 推奨する MVP の進め方（順序）。
 *
 * 1. 現在の「1件コピー / ダウンロード」を安定維持する。
 * 2. UI 実装の前に選択状態（モデル）を設計する。
 * 3. シンプルな個別選択を後で追加する。
 * 4. 選択件数を表示する。
 * 5. 選択解除を追加する。
 * 6. 絞り込みの挙動が固まってから「表示中をすべて選択」を追加する。
 * 7. 選択の挙動が安定してからエクスポート操作を追加する。
 */
export const OBSIDIAN_MEMO_SELECTION_MVP_ORDER = [
  'Keep current single memo copy/download stable.',
  'Design selection state before UI implementation.',
  'Add simple individual selection later.',
  'Show selected count.',
  'Add clear selection.',
  'Add select-all-visible only after filtering behavior is clear.',
  'Add export action only after selection behavior is stable.',
] as const;

/**
 * 実装時の注意（必ず守る前提）。
 *
 * - Supabase の source of truth を変えない。
 * - 必要がない限り、選択状態を永続化しない。
 * - 隠れている／絞り込みで除外されたメモを予期せずエクスポートしない。
 * - 警告なしに巨大なエクスポートを許可しない。
 * - ユーザー確認なしにダウンロードを発火しない。
 * - 双方向同期を実装しない。
 * - まずは一方向エクスポートにする。
 */
export const OBSIDIAN_MEMO_SELECTION_WARNINGS = [
  'Do not change Supabase source of truth.',
  'Do not persist selection permanently unless needed.',
  'Do not export hidden or filtered-out memos unexpectedly.',
  'Do not allow huge exports without warning.',
  'Do not trigger downloads without user confirmation.',
  'Do not implement two-way sync.',
  'Keep export one-way first.',
] as const;
