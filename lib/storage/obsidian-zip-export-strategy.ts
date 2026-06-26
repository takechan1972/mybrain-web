/**
 * 複数メモ一括エクスポートにおける ZIP 依存の採否（設計メモ・ドキュメントのみ）。
 *
 * このファイルは「複数メモをまとめて出すとき ZIP を使うか／使わないか」を判断するための内部ノートです。
 * - 実装はまだしない。runtime の副作用なし・ブラウザ API 呼び出しなし・依存追加なし。
 * - どこからも import しない（純粋なドキュメント置き場）。
 * - 現状の保存挙動は不変（MyBrain/Supabase が source of truth）。
 *
 * 各候補は定数として export しておき、将来の判断・分岐キーに使えるようにする。
 */

/** ZIP 戦略の識別子。 */
export type ObsidianZipExportStrategy =
  | 'no-zip-current'
  | 'sequential-md-downloads'
  | 'zip-with-small-library'
  | 'server-side-zip'
  | 'drive-folder-export-instead';

/**
 * no-zip-current：現在の「1件コピー / ダウンロード」を維持する（ZIP なし）。
 * - 追加依存なし・全環境で安定。当面の基本線。
 */
export const STRATEGY_NO_ZIP_CURRENT: ObsidianZipExportStrategy = 'no-zip-current';

/**
 * sequential-md-downloads：複数の .md ファイルを1件ずつダウンロードする。
 * - 追加依存なしで一括化に近いことができる。
 * - iPhone / iPad の Safari は連続ダウンロードに制限があり、件数が多いと扱いにくい。
 */
export const STRATEGY_SEQUENTIAL_MD_DOWNLOADS: ObsidianZipExportStrategy = 'sequential-md-downloads';

/**
 * zip-with-small-library：将来、軽量なクライアント側 ZIP ライブラリを使う。
 * - まとめて1ファイルで渡せて扱いやすい。
 * - ただしバンドルサイズ・依存方針のレビューが前提（このメモでは入れない）。
 */
export const STRATEGY_ZIP_WITH_SMALL_LIBRARY: ObsidianZipExportStrategy = 'zip-with-small-library';

/**
 * server-side-zip：将来、サーバ側で ZIP を生成する。
 * - クライアント側 ZIP が重い／不安定な場合の代替。
 * - サーバ処理・転送コストが増えるため、必要になってから検討する。
 */
export const STRATEGY_SERVER_SIDE_ZIP: ObsidianZipExportStrategy = 'server-side-zip';

/**
 * drive-folder-export-instead：将来、ZIP を避けて Google Drive フォルダへ出力する。
 * - Drive へ直接出す場合、ZIP にまとめるより個別ファイルのフォルダ出力が自然なことが多い。
 * - Google Drive エクスポートの設計メモ側と合わせて検討する。
 */
export const STRATEGY_DRIVE_FOLDER_EXPORT_INSTEAD: ObsidianZipExportStrategy = 'drive-folder-export-instead';

/**
 * 推奨する MVP の進め方（順序）。
 *
 * 1. 現在の「1件コピー / ダウンロード」を安定維持する。
 * 2. 次の一手では ZIP 依存を入れない。
 * 3. 一括エクスポート実装の前に、メモ選択 UI を設計する。
 * 4. 多数のファイルが必要になったら、依存レビューのうえ ZIP を検討する。
 * 5. Google Drive エクスポートでは、ZIP よりフォルダ出力の方が適することがある。
 * 6. サーバ側 ZIP は、クライアント側 ZIP が重い／不安定になった場合のみ検討する。
 */
export const OBSIDIAN_ZIP_EXPORT_MVP_ORDER = [
  'Keep current single memo copy/download stable.',
  'Avoid ZIP dependency in the next immediate step.',
  'Design memo selection UI before implementing bulk export.',
  'If many files are needed, consider ZIP after dependency review.',
  'For Google Drive export, folder export may be better than ZIP.',
  'Server-side ZIP should be considered only if client-side ZIP becomes heavy or unreliable.',
] as const;

/**
 * 実装時の注意（必ず守る前提）。
 *
 * - バンドルサイズをレビューせずに ZIP 依存を追加しない。
 * - 上限なしに巨大な ZIP をブラウザで生成しない。
 * - iPhone / iPad のブラウザのダウンロード挙動には制限がある点を考慮する。
 * - 既存ファイルの自動上書きを避ける。
 * - まずは一方向エクスポートにする。
 * - Supabase を source of truth として維持する。
 */
export const OBSIDIAN_ZIP_EXPORT_WARNINGS = [
  'Do not add ZIP dependency without reviewing bundle size.',
  'Do not generate very large ZIP files in the browser without limits.',
  'iPhone/iPad browser download behavior may be limited.',
  'Avoid automatic overwrites.',
  'Keep export one-way first.',
  'Keep Supabase as source of truth.',
] as const;
