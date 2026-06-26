/**
 * メモ一覧からの複数メモ一括 Obsidian エクスポート導線（設計メモ・ドキュメントのみ）。
 *
 * このファイルは「メモ一覧で複数メモを選んでまとめて出す」UX の流れを整理した内部ノートです。
 * - 実装はまだしない。runtime の副作用なし・ブラウザ API 呼び出しなし・依存追加なし。
 * - どこからも import しない（純粋なドキュメント置き場）。
 * - 現状の保存挙動は不変（MyBrain/Supabase が source of truth）。
 *
 * 関連設計メモ：
 * - obsidian-bulk-export-strategy.ts（一括エクスポートの戦略候補）
 * - obsidian-zip-export-strategy.ts（ZIP 依存の採否）
 * - google-drive-obsidian-export-strategy.ts（Google Drive 出力）
 *
 * 各トピックは定数として export しておき、将来実装時の参照・分岐キーに使えるようにする。
 */

/** メモ一覧エクスポート導線の設計トピック識別子。 */
export type ObsidianListExportFlowTopic =
  | 'list-selection-entry'
  | 'memo-selection-mode'
  | 'selected-memos-export'
  | 'export-target-choice'
  | 'empty-selection-handling'
  | 'large-selection-warning'
  | 'mobile-download-limits'
  | 'one-way-export-only';

/**
 * list-selection-entry：メモ一覧に「選択モード」の入口を将来置く。
 * - 通常の閲覧を邪魔しない、控えめな入口にする。
 */
export const TOPIC_LIST_SELECTION_ENTRY: ObsidianListExportFlowTopic = 'list-selection-entry';

/**
 * memo-selection-mode：ユーザーが個々のメモを後で選べるようにする。
 * - チェックなどで個別選択。選択状態は分かりやすく表示する。
 */
export const TOPIC_MEMO_SELECTION_MODE: ObsidianListExportFlowTopic = 'memo-selection-mode';

/**
 * selected-memos-export：選択したメモだけをエクスポートする。
 * - 全件ではなく「選んだ分だけ」を出す。
 */
export const TOPIC_SELECTED_MEMOS_EXPORT: ObsidianListExportFlowTopic = 'selected-memos-export';

/**
 * export-target-choice：出力先を後で選べるようにする。
 * - 候補：逐次ダウンロード / ZIP / Google Drive フォルダ。
 * - まずは最も安全な選択肢から始める。
 */
export const TOPIC_EXPORT_TARGET_CHOICE: ObsidianListExportFlowTopic = 'export-target-choice';

/**
 * empty-selection-handling：1件も選ばれていない場合は、やさしいメッセージを出す。
 * - エラーではなく「メモを選んでください」程度の案内にする。
 */
export const TOPIC_EMPTY_SELECTION_HANDLING: ObsidianListExportFlowTopic = 'empty-selection-handling';

/**
 * large-selection-warning：選択が多すぎる場合は、警告するか上限を設ける。
 * - 端末・ブラウザの負荷やダウンロード制限を踏まえて知らせる。
 */
export const TOPIC_LARGE_SELECTION_WARNING: ObsidianListExportFlowTopic = 'large-selection-warning';

/**
 * mobile-download-limits：iPhone / iPad のブラウザのダウンロード制限を考慮する。
 * - 連続ダウンロードが効きにくい点を前提に導線を設計する。
 */
export const TOPIC_MOBILE_DOWNLOAD_LIMITS: ObsidianListExportFlowTopic = 'mobile-download-limits';

/**
 * one-way-export-only：最初は MyBrain から外向きの一方向エクスポートのみにする。
 * - 取り込み（双方向）は最初はやらない。
 */
export const TOPIC_ONE_WAY_EXPORT_ONLY: ObsidianListExportFlowTopic = 'one-way-export-only';

/**
 * 推奨する MVP の進め方（順序）。
 *
 * 1. 現在の「1件コピー / ダウンロード」を安定維持する。
 * 2. 実装前に選択モードを設計する。
 * 3. メモ一覧に選択の入口を後で追加する。
 * 4. 個々のメモを後で選べるようにする。
 * 5. 選択したメモを一方向にエクスポートする。
 * 6. ZIP や Google Drive より先に、最も安全な出力から始める。
 * 7. 導線が固まってから ZIP や Google Drive を追加する。
 */
export const OBSIDIAN_LIST_EXPORT_FLOW_MVP_ORDER = [
  'Keep current single memo copy/download stable.',
  'Design selection mode before implementation.',
  'Add a memo list selection entry later.',
  'Allow selecting individual memos later.',
  'Export selected memos one-way.',
  'Start with the safest output option before ZIP or Google Drive.',
  'Add ZIP or Google Drive only after the flow is clear.',
] as const;

/**
 * 実装時の注意（必ず守る前提）。
 *
 * - Supabase の source of truth を変えない。
 * - 初期段階で双方向同期をしない。
 * - 既存の Obsidian ファイルを自動で上書きしない。
 * - ユーザー確認なしに複数のブラウザダウンロードを発火しない。
 * - iPhone / iPad が多数ダウンロードを扱えると仮定しない。
 * - このステップで ZIP 依存を追加しない。
 * - Google Drive へ黙ってアップロードしない。
 */
export const OBSIDIAN_LIST_EXPORT_FLOW_WARNINGS = [
  'Do not change Supabase source of truth.',
  'Do not implement two-way sync initially.',
  'Do not overwrite existing Obsidian files automatically.',
  'Do not trigger multiple browser downloads without user confirmation.',
  'Do not assume iPhone/iPad can handle many downloads.',
  'Do not add ZIP dependency in this step.',
  'Do not silently upload to Google Drive.',
] as const;
