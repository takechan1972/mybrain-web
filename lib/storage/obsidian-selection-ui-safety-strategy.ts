/**
 * メモ選択UIと選択状態の安全設計（設計メモ・ドキュメントのみ）。
 *
 * このファイルは「実チェックボックスを入れる前に、選択件数表示・選択解除・選択状態の扱いを
 * どう安全に設計するか」を整理した内部ノートです。
 * - 実装はまだしない。runtime の副作用なし・ブラウザ API 呼び出しなし・依存追加なし。
 * - どこからも import しない（純粋なドキュメント置き場）。UIファイルに selectedIds は足さない。
 * - 現状の保存挙動は不変（MyBrain/Supabase が source of truth）。
 *
 * 関連設計メモ：
 * - obsidian-memo-selection-model-strategy.ts（選択モデルの候補）
 * - obsidian-list-export-flow-strategy.ts（一覧からの一括エクスポート導線）
 *
 * 各トピックは定数として export しておき、将来実装時の参照・分岐キーに使えるようにする。
 */

/** 選択UI/状態の安全設計トピック識別子。 */
export type ObsidianSelectionUiSafetyTopic =
  | 'selected-count-display'
  | 'clear-selection-action'
  | 'selection-state-scope'
  | 'filter-aware-selection'
  | 'detail-navigation-safety'
  | 'empty-selection-state'
  | 'large-selection-warning'
  | 'export-disabled-until-stable';

/**
 * selected-count-display：選択中の件数を分かりやすく表示する。
 * - 「3件 選択中」のように、今いくつ選ばれているかを常に見せる。
 * - 実選択を入れてから表示する（それまで件数は出さない）。
 */
export const TOPIC_SELECTED_COUNT_DISPLAY: ObsidianSelectionUiSafetyTopic = 'selected-count-display';

/**
 * clear-selection-action：選択をまとめて解除できるようにする。
 * - ワンタップで全部の選択を外せる「選択を解除」を用意する。
 * - エクスポート操作を足す前に、必ず解除を先に用意する。
 */
export const TOPIC_CLEAR_SELECTION_ACTION: ObsidianSelectionUiSafetyTopic = 'clear-selection-action';

/**
 * selection-state-scope：選択状態はメモ一覧画面の中だけに閉じる。
 * - ローカル state（例：Set<string>）として、その画面の中だけで持つ。
 * - 画面を離れたら破棄してよい。むやみに永続化しない。
 */
export const TOPIC_SELECTION_STATE_SCOPE: ObsidianSelectionUiSafetyTopic = 'selection-state-scope';

/**
 * filter-aware-selection：選択は今の検索・絞り込みに従う。
 * - 表示されているメモだけを選択対象にする。
 * - 隠れている／絞り込みで外れたメモを巻き込まない。
 */
export const TOPIC_FILTER_AWARE_SELECTION: ObsidianSelectionUiSafetyTopic = 'filter-aware-selection';

/**
 * detail-navigation-safety：メモカード/詳細への遷移を壊さない。
 * - 選択モードが明確に有効なときだけ、タップ＝選択に切り替える。
 * - 通常時はこれまで通り、タップ＝詳細を開く。
 */
export const TOPIC_DETAIL_NAVIGATION_SAFETY: ObsidianSelectionUiSafetyTopic = 'detail-navigation-safety';

/**
 * empty-selection-state：1件も選ばれていないときの扱い。
 * - 0件のときはエクスポート操作を出さない／押せないようにする。
 * - 必要なら「メモを選んでください」とやさしく案内する（エラーにしない）。
 */
export const TOPIC_EMPTY_SELECTION_STATE: ObsidianSelectionUiSafetyTopic = 'empty-selection-state';

/**
 * large-selection-warning：選択が多すぎる場合は警告するか上限を設ける。
 * - 端末・ブラウザの負荷やダウンロード制限を踏まえて知らせる。
 */
export const TOPIC_LARGE_SELECTION_WARNING: ObsidianSelectionUiSafetyTopic = 'large-selection-warning';

/**
 * export-disabled-until-stable：選択の挙動が安定するまでエクスポートは無効。
 * - 選択件数表示・解除が固まるまで、エクスポート操作は出さない／無効のままにする。
 */
export const TOPIC_EXPORT_DISABLED_UNTIL_STABLE: ObsidianSelectionUiSafetyTopic = 'export-disabled-until-stable';

/**
 * 推奨する MVP の進め方（順序）。
 *
 * 1. 現在の「選択してまとめる」準備中入口を安定維持する。
 * 2. チェックボックスを足す前に、選択件数表示と解除を設計する。
 * 3. ローカルの selectedIds 状態を後で追加する（メモ一覧画面だけにスコープする）。
 * 4. 実選択を入れてから、選択件数を表示する。
 * 5. どのエクスポート操作よりも先に、選択解除を追加する。
 * 6. 選択の挙動が安定するまで、エクスポートは無効のままにする。
 * 7. 大量エクスポートを許す前に、警告を追加する。
 */
export const OBSIDIAN_SELECTION_UI_SAFETY_MVP_ORDER = [
  'Keep current selection preparation entry stable.',
  'Design selected count and clear action before adding checkboxes.',
  'Add local selectedIds state later, scoped only to the memo list screen.',
  'Show selected count only after real selection is introduced.',
  'Add clear selection before adding any export action.',
  'Keep export disabled until selection behavior is stable.',
  'Add warnings before allowing large exports.',
] as const;

/**
 * 実装時の注意（必ず守る前提）。
 *
 * - 本当に必要でない限り selectedIds を永続化しない。
 * - 隠れている／絞り込みで外れたメモを予期せず選択しない。
 * - 選択モードが明確に有効になるまで、メモカード/詳細の遷移を変えない。
 * - 選択件数が 0 のときはエクスポート操作を出さない。
 * - 確認なしにダウンロードを発火しない。
 * - ローカル選択が安定する前に ZIP や Google Drive を足さない。
 * - Supabase を source of truth として維持する。
 * - まずは一方向エクスポートにする。
 */
export const OBSIDIAN_SELECTION_UI_SAFETY_WARNINGS = [
  'Do not persist selectedIds unless truly needed.',
  'Do not select hidden or filtered-out memos unexpectedly.',
  'Do not change memo card/detail navigation until selection mode is clearly active.',
  'Do not show an export action when selected count is 0.',
  'Do not trigger downloads without confirmation.',
  'Do not add ZIP or Google Drive before local selection is stable.',
  'Keep Supabase as the source of truth.',
  'Keep export one-way first.',
] as const;
