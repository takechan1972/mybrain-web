/**
 * Google Drive 接続画面の日本語文言案（設計メモ・文言のみ）。
 *
 * このファイルは「将来の接続画面に表示する日本語コピー」を整理した内部ノートです。
 * - 文言（文字列定数）のみ。runtime の副作用なし・ブラウザ API 呼び出しなし・OAuth/トークン処理なし。
 * - どこからも import しない（純粋な文言の置き場）。
 * - 現状の保存挙動は不変（MyBrain/Supabase が source of truth）。
 *
 * 関連設計メモ：
 * - google-drive-connection-ui-strategy.ts（接続画面 UI のトピック）
 *
 * 文言方針：10〜70歳が分かるやさしい日本語。OAuth・トークンなどの専門用語は使わない。
 */

/** 接続状態のキー（UI 側の connection-status に対応）。 */
export type GoogleDriveConnectionStatusKey = 'not-connected' | 'connected' | 'error' | 'expired';

/** 接続状態ラベルの文言。 */
export const GOOGLE_DRIVE_CONNECTION_STATUS_COPY: Record<GoogleDriveConnectionStatusKey, string> = {
  'not-connected': '未接続',
  connected: '接続済み',
  error: '接続に失敗しました',
  expired: '接続の有効期限が切れました。もう一度接続してください。',
};

/** 接続画面の文言一式（文言のみ・実装なし）。 */
export const GOOGLE_DRIVE_CONNECTION_COPY = {
  /** 画面タイトル */
  screenTitle: 'Google Drive と接続',
  /** なぜ接続が必要かの説明 */
  connectionReason: 'メモを Google Drive の Obsidian フォルダに保存できるようにします。',
  /** 権限のやさしい説明 */
  permissionExplanation: '選んだフォルダに保存するために使います。他のファイルを勝手に変更しません。',
  /** 接続ボタンのラベル */
  connectButton: 'Google Drive に接続',
  /** 接続状態ラベル */
  status: GOOGLE_DRIVE_CONNECTION_STATUS_COPY,
  /** フォルダ選択の案内 */
  folderGuidance: '保存先のフォルダを選ぶか、新しく作成してください。',
  /** 接続解除ボタンのラベル */
  disconnectButton: '接続を解除',
  /** 接続解除の確認文 */
  disconnectConfirm: 'Google Drive の接続を解除しますか？',
  /** 準備中の補足（現在は手動ダウンロードが使える旨） */
  preparationNote: '※ 今はまだ準備中です。現在はObsidian用Markdownをダウンロードして使えます。',
} as const;

/**
 * 文言づくりのガイドライン（コピーを書くときに守ること）。
 *
 * - 文は短くする。
 * - 接続をお願いする前に、理由を説明する。
 * - ファイルが自動でアップロードされる、とは書かない。
 * - Google Drive がまだメインの保存先である、とは思わせない。
 * - 保存先のフォルダはユーザーが選ぶ、と分かるようにする。
 * - 現在の source of truth は Supabase / MyBrain のまま、という前提を保つ。
 */
export const GOOGLE_DRIVE_CONNECTION_COPY_GUIDELINES = [
  'Keep sentences short.',
  'Explain before asking the user to connect.',
  'Do not say files will be uploaded automatically.',
  'Do not imply Google Drive is the main storage yet.',
  'Make it clear that the user chooses the folder.',
  'Keep Supabase/MyBrain as the current source of truth.',
] as const;
