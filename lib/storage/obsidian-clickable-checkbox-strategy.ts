/**
 * デスクトップのメモ選択チェック表示を「将来クリック可能にする」ときの安全設計（設計メモ・ドキュメントのみ）。
 *
 * このファイルは、現在 components/DesktopMemos.tsx にある「見た目だけの ☐（aria-hidden の span）」を
 * 将来クリック可能にする場合の、安全な実装方針を整理した内部ノートです。
 * - 実装はまだしない。runtime の副作用なし・ブラウザ API 呼び出しなし・依存追加なし。
 * - どこからも import しない（純粋なドキュメント置き場）。
 * - 現状の保存挙動・UI は不変（MyBrain/Supabase が source of truth）。
 *
 * 関連設計メモ：
 * - obsidian-selection-ui-safety-strategy.ts（選択UI/状態の安全設計）
 * - obsidian-memo-selection-model-strategy.ts（選択モデルの候補）
 *
 * 各トピックは定数として export しておき、将来実装時の参照・分岐キーに使えるようにする。
 */

/** クリック可能チェックの設計トピック識別子。 */
export type ObsidianClickableCheckboxTopic =
  | 'clickable-checkbox-requires-selected-ids'
  | 'stop-propagation-first'
  | 'stop-double-click-propagation'
  | 'remove-aria-hidden-when-interactive'
  | 'checkbox-accessibility'
  | 'local-selected-ids-only'
  | 'keep-selected-id-separate'
  | 'desktop-only-first'
  | 'no-input-inside-button'
  | 'no-export-until-selection-stable';

/**
 * clickable-checkbox-requires-selected-ids：クリック可能にするなら selectedIds が必要。
 * - 状態のないクリック可能チェックは作らない（押しても ☐ のままで壊れて見える）。
 * - クリック可能化と selectedIds は同時に入れる。
 */
export const TOPIC_CLICKABLE_REQUIRES_SELECTED_IDS: ObsidianClickableCheckboxTopic = 'clickable-checkbox-requires-selected-ids';

/**
 * stop-propagation-first：チェックの onClick で最初に e.stopPropagation() する。
 * - その後で selectedIds を切り替える（お気に入り星と同じ順序）。
 */
export const TOPIC_STOP_PROPAGATION_FIRST: ObsidianClickableCheckboxTopic = 'stop-propagation-first';

/**
 * stop-double-click-propagation：チェックの onDoubleClick でも伝播を止める。
 * - チェックをダブルクリックしても detail モードを開かない。
 */
export const TOPIC_STOP_DOUBLE_CLICK_PROPAGATION: ObsidianClickableCheckboxTopic = 'stop-double-click-propagation';

/**
 * remove-aria-hidden-when-interactive：操作可能にするとき aria-hidden を外す。
 * - 操作できる要素を aria-hidden のままにしない（アクセシビリティ違反）。
 */
export const TOPIC_REMOVE_ARIA_HIDDEN_WHEN_INTERACTIVE: ObsidianClickableCheckboxTopic = 'remove-aria-hidden-when-interactive';

/**
 * checkbox-accessibility：チェックボックスのアクセシビリティ。
 * - role="checkbox" / aria-checked / tabIndex={0} / aria-label を付ける。
 * - Enter と Space のキーボード操作に対応する。
 */
export const TOPIC_CHECKBOX_ACCESSIBILITY: ObsidianClickableCheckboxTopic = 'checkbox-accessibility';

/**
 * local-selected-ids-only：selectedIds は画面内ローカルのみ。
 * - Set<string> をデスクトップのメモ一覧画面の中だけで持つ。
 * - Supabase にも localStorage にも保存しない。
 */
export const TOPIC_LOCAL_SELECTED_IDS_ONLY: ObsidianClickableCheckboxTopic = 'local-selected-ids-only';

/**
 * keep-selected-id-separate：既存の selectedId とは別物。
 * - selectedId はプレビュー用の単一選択。
 * - selectedIds は一括操作用の複数選択。名前も役割も分ける。
 */
export const TOPIC_KEEP_SELECTED_ID_SEPARATE: ObsidianClickableCheckboxTopic = 'keep-selected-id-separate';

/**
 * desktop-only-first：まずデスクトップだけで実装する。
 * - スマホ（app/history/page.tsx）はこのフェーズでは触らない。
 */
export const TOPIC_DESKTOP_ONLY_FIRST: ObsidianClickableCheckboxTopic = 'desktop-only-first';

/**
 * no-input-inside-button：親 button の中に本物の input を入れない。
 * - メモ一覧アイテムは <button>。中に <input type="checkbox"> は入れない。
 * - お気に入り星と同じく <span> ベースで表現する。
 */
export const TOPIC_NO_INPUT_INSIDE_BUTTON: ObsidianClickableCheckboxTopic = 'no-input-inside-button';

/**
 * no-export-until-selection-stable：選択が安定するまでエクスポートを足さない。
 * - 一括エクスポート / ZIP / Google Drive はこのフェーズで入れない。
 */
export const TOPIC_NO_EXPORT_UNTIL_SELECTION_STABLE: ObsidianClickableCheckboxTopic = 'no-export-until-selection-stable';

/**
 * 推奨する実装の単位（クリック可能チェックを入れるときの最小セット）。
 *
 * - 状態のないクリック可能チェックは作らない。
 * - 実装するときは「ローカル selectedIds」と「クリック可能チェック」を同時に入れる。
 * - チェックの見た目は、未選択で ☐ / 選択済みで ☑ に切り替える。
 * - selectedIds はデスクトップのメモ一覧画面内の Set<string>。
 * - selectedIds は Supabase にも localStorage にも保存しない。
 * - 既存の selectedId（プレビュー単一選択）は別物として残す。
 */
export const OBSIDIAN_CLICKABLE_CHECKBOX_IMPLEMENTATION_UNIT = [
  'Do not implement a clickable checkbox without selectedIds.',
  'When implementing, add local selectedIds and clickable checkbox together.',
  'Show the unchecked box as ☐ and the checked box as ☑.',
  'selectedIds is a local Set<string> scoped to the desktop memo list screen.',
  'selectedIds is not persisted to Supabase or localStorage.',
  'Keep the existing selectedId preview selection separate.',
] as const;

/**
 * イベント処理の指針（クリック/ダブルクリック/キーボード）。
 *
 * - onClick はチェックの <span> にだけ付ける。
 * - onClick は最初に e.stopPropagation() を呼ぶ。
 * - その後 selectedIds の所属を切り替える。
 * - onDoubleClick={(e) => e.stopPropagation()} で detail モードを開かせない。
 * - Enter と Space のキーボード操作に対応する。
 * - 親メモ一覧アイテムのシングルクリック/ダブルクリックは変更しない。
 */
export const OBSIDIAN_CLICKABLE_CHECKBOX_EVENT_GUIDANCE = [
  'Add onClick to the checkbox span only.',
  'onClick must call e.stopPropagation() first.',
  'Then toggle selectedIds membership.',
  'Add onDoubleClick to stopPropagation to prevent opening detail mode.',
  'Add keyboard support for Enter and Space.',
  'Keep parent list item single click and double click unchanged.',
] as const;

/**
 * アクセシビリティの指針。
 *
 * - 操作可能になったら aria-hidden を外す。
 * - role="checkbox" を付ける。
 * - aria-checked={isSelected} を付ける。
 * - tabIndex={0} を付ける。
 * - aria-label="このメモを選択" を付ける。
 * - 親 button の中に <input type="checkbox"> を入れない。
 */
export const OBSIDIAN_CLICKABLE_CHECKBOX_ACCESSIBILITY_GUIDANCE = [
  'Remove aria-hidden when the checkbox becomes interactive.',
  'Add role="checkbox".',
  'Add aria-checked={isSelected}.',
  'Add tabIndex={0}.',
  'Add aria-label="このメモを選択".',
  'Do not use <input type="checkbox"> inside the parent button.',
] as const;

/**
 * 実装時の注意（必ず守る前提）。
 *
 * - 状態がないままチェックをクリック可能にしない。
 * - UI の準備ができる前に selectedIds を使わない。
 * - selectedIds を永続化しない。
 * - チェックのクリックでプレビュー選択（setSelectedId）を発火させない。
 * - チェックのダブルクリックで detail モードを開かない。
 * - このフェーズで export / ZIP / Google Drive を足さない。
 * - このフェーズでスマホ側の挙動を変えない。
 */
export const OBSIDIAN_CLICKABLE_CHECKBOX_WARNINGS = [
  'Do not make the checkbox clickable while it has no state.',
  'Do not use selectedIds before the UI is ready.',
  'Do not persist selectedIds.',
  'Do not trigger preview selection when clicking the checkbox.',
  'Do not open detail mode when double-clicking the checkbox.',
  'Do not add export, ZIP, or Google Drive in this phase.',
  'Do not change smartphone behavior in this phase.',
] as const;
