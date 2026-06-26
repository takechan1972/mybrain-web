/**
 * Google Drive 接続画面の UI（設計メモ・ドキュメントのみ）。
 *
 * このファイルは「将来 Google Drive につなぐ画面をどう見せるか」を整理した内部ノートです。
 * - 実装はまだしない。runtime の副作用なし・ブラウザ API 呼び出しなし・OAuth/トークン処理なし。
 * - どこからも import しない（純粋なドキュメント置き場）。
 * - 現状の保存挙動は不変（MyBrain/Supabase が source of truth）。
 *
 * 関連設計メモ：
 * - google-drive-obsidian-export-strategy.ts（Drive エクスポートの方針）
 * - obsidian-list-export-flow-strategy.ts（一覧からの一括エクスポート導線）
 *
 * 各 UI トピックは定数として export しておき、将来実装時の参照・分岐キーに使えるようにする。
 */

/** Google Drive 接続画面の UI トピック識別子。 */
export type GoogleDriveConnectionUiTopic =
  | 'connection-entry'
  | 'consent-explanation'
  | 'permission-scope-explanation'
  | 'connect-button'
  | 'connection-status'
  | 'folder-selection-step'
  | 'disconnect-option'
  | 'mobile-friendly-layout';

/**
 * connection-entry：接続画面をどこから開くか。
 * - まずは設定画面の中から開ける入口を想定する。
 */
export const TOPIC_CONNECTION_ENTRY: GoogleDriveConnectionUiTopic = 'connection-entry';

/**
 * consent-explanation：なぜ Google Drive 接続が必要かを説明する。
 * - 「メモをDriveのObsidianフォルダに保存するため」など、目的をやさしく伝える。
 */
export const TOPIC_CONSENT_EXPLANATION: GoogleDriveConnectionUiTopic = 'consent-explanation';

/**
 * permission-scope-explanation：権限の範囲をやさしい言葉で説明する。
 * - 「選んだフォルダにだけ保存します」など、できること/できないことを明確にする。
 */
export const TOPIC_PERMISSION_SCOPE_EXPLANATION: GoogleDriveConnectionUiTopic = 'permission-scope-explanation';

/**
 * connect-button：将来の「Google Driveに接続」ボタン。
 * - ユーザーが押して初めて接続が始まる（黙ってつながない）。
 */
export const TOPIC_CONNECT_BUTTON: GoogleDriveConnectionUiTopic = 'connect-button';

/**
 * connection-status：接続状態の表示。
 * - 未接続 / 接続済み / エラー / 期限切れ の4状態をやさしく表示する。
 */
export const TOPIC_CONNECTION_STATUS: GoogleDriveConnectionUiTopic = 'connection-status';

/**
 * folder-selection-step：Obsidian エクスポート用フォルダを選ぶ／作る手順。
 * - 接続が動いてから表示する（接続前には出さない）。
 */
export const TOPIC_FOLDER_SELECTION_STEP: GoogleDriveConnectionUiTopic = 'folder-selection-step';

/**
 * disconnect-option：あとから接続を解除できるようにする。
 * - いつでも切断でき、状態が分かるようにする。
 */
export const TOPIC_DISCONNECT_OPTION: GoogleDriveConnectionUiTopic = 'disconnect-option';

/**
 * mobile-friendly-layout：スマホでも分かりやすい簡単なレイアウトにする。
 * - 文字は大きめ・手順は少なめ。10〜70歳が迷わないようにする。
 */
export const TOPIC_MOBILE_FRIENDLY_LAYOUT: GoogleDriveConnectionUiTopic = 'mobile-friendly-layout';

/**
 * 推奨する MVP の進め方（順序）。
 *
 * 1. 現在の手動コピー / ダウンロードを安定維持する。
 * 2. 設定に Google Drive 接続の入口を後で追加する。
 * 3. 接続前に、やさしい説明を表示する。
 * 4. 明示的な接続ボタンを後で追加する。
 * 5. 接続状態を表示する。
 * 6. 接続が動いてからフォルダ選択を追加する。
 * 7. 接続解除の選択肢を追加する。
 * 8. 接続とフォルダ選択が安定してからエクスポートを追加する。
 */
export const GOOGLE_DRIVE_CONNECTION_UI_MVP_ORDER = [
  'Keep current manual copy/download stable.',
  'Add a settings entry for Google Drive connection later.',
  'Show a simple explanation before connecting.',
  'Add explicit connect button later.',
  'Show connection status.',
  'Add folder selection only after connection works.',
  'Add disconnect option.',
  'Add export only after connection and folder selection are stable.',
] as const;

/**
 * 実装時の注意（必ず守る前提）。
 *
 * - Google Drive を黙ってつながない。
 * - 説明なしに広い権限を要求しない。
 * - ユーザー操作なしにファイルをアップロードしない。
 * - トークンを安全でない方法で保存しない。
 * - 最初は Google Drive を source of truth にしない。
 * - 最初のバージョンで双方向同期を実装しない。
 * - Supabase を source of truth として維持する。
 */
export const GOOGLE_DRIVE_CONNECTION_UI_WARNINGS = [
  'Do not connect Google Drive silently.',
  'Do not request broad permissions without explanation.',
  'Do not upload files without user action.',
  'Do not store tokens insecurely.',
  'Do not make Google Drive the source of truth at first.',
  'Do not implement two-way sync in the first version.',
  'Keep Supabase as source of truth.',
] as const;
