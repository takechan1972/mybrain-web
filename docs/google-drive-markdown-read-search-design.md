# Google Drive Markdown 読み取り・検索参照 ― 設計メモ（OBS25）

> **ステータス：Phase 1 実装済み・本番QA完了（2026-07-09・OBS26／OBS26R）／Phase 2・3 は未着手。**
> Phase 1（一覧のみ）を実装した：`lib/google/google-drive-read.ts`（`listDriveMarkdownFiles`・読み取り専用・フォルダ作成なし）＋デスクトップの一括エクスポートパネル内「エクスポート済み一覧」（`components/DriveExportedFilesList.tsx`）。本文読み取り（Phase 2）・AI/検索参照（Phase 3）は未実装。OAuth スコープは `drive.file` のまま変更なし。
> 関連：`docs/google-drive-markdown-export-design.md`（書き出し設計）／`docs/mobile-bulk-markdown-export-design.md`（OBS23/24）／`lib/google/`（Drive ヘルパー群）／`lib/markdown/memo-markdown.ts`（Markdown ⇄ メモ変換）／`lib/ai/consult-ollama.ts`（AI アシストのコンテキスト構築）。

---

## 機能名

**Google Drive Markdown 読み取り・検索参照**（Google Drive Markdown Read / Search Reference）

MyBrain が Google Drive の `MyBrain/Memos/` に書き出した Markdown ファイルを、あとから一覧・読み取りし、将来的に AI アシスト・検索の「参照データ」として使えるようにする。

## 目的

- これまでのフェーズで「MyBrain → Drive」への一方向エクスポートが完成した（OBS24R で全9 QAケース Pass）。次は「書き出した Markdown を読み返す」最小の入口を用意する。
- 読み取りは**参照のみ**。MyBrain（Supabase）は引き続き source of truth であり、Drive の Markdown は付加的なエクスポートコピーのまま変えない。

---

## 大前提：スコープと見える範囲（最重要の設計判断）

現在の OAuth スコープは `https://www.googleapis.com/auth/drive.file`（`lib/google/google-drive-oauth.ts` の `GOOGLE_DRIVE_SCOPE`）。

- `drive.file` は「**このアプリが作成（またはユーザーがこのアプリで開いた）ファイルだけ**」を一覧・読み取りできる。
- つまり **MyBrain 自身がエクスポートした Markdown は、スコープ変更なしで読み返せる**。
- 逆に、Obsidian や他アプリ・手動アップロードで `MyBrain/Memos/` に置かれたファイルは**見えない**。これは不具合ではなく `drive.file` の仕様であり、本設計では**許容する制限**とする。
- Drive 全体を読む `drive.readonly` への拡張は、同意画面の重み・審査・プライバシー面の影響が大きいため**採用しない**（スコープ変更禁止のルールどおり）。

この判断により、OBS25 は「MyBrain が自分で書き出したものを自分で読み返す」機能に限定される。

---

## 設計

### 1. Markdown ファイルの一覧取得

- 既存の `ensureDriveFolderPath`（`lib/google/google-drive-folders.ts`）で `MyBrain/Memos/` のフォルダ ID を解決する（無ければ「まだエクスポートがありません」扱い。読み取りのためにフォルダを新規作成しない）。
- `files.list`（既存 `findDriveFile` と同じエンドポイント・同じ認可ヘッダ）で、フォルダ直下の `.md` ファイルを取得する。
  - クエリ：`'<folderId>' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`
  - fields：`files(id, name, modifiedTime, size)`、`orderBy=modifiedTime desc`、`pageSize` は 100 程度＋`nextPageToken` 対応。
- トークンは既存の `requestGoogleDriveAccessToken()` をユーザー操作起点で取得し、**引数で持ち回るだけ・保存しない**（既存方針のまま）。
- 新ヘルパー案：`listDriveMarkdownFiles(accessToken, folderId)` を `lib/google/google-drive-read.ts`（新規）に置く。

### 2. 選択した Markdown 本文の読み取り

- `files.get`：`GET https://www.googleapis.com/drive/v3/files/<fileId>?alt=media` で本文テキストを取得する。
- 一覧から**ユーザーが選んだ 1 件だけ**読み取る（全件の自動一括読み込みはしない）。
- サイズ上限（例：1MB）を超えるファイルは読み込まず、「大きすぎるため表示できません」と案内する。
- 新ヘルパー案：`readDriveMarkdownFile(accessToken, fileId)`（同じく `google-drive-read.ts`）。

### 3. Markdown → メモ相当構造への変換

- **新規パーサは作らない。** 既存の `markdownToMemo(markdown): ParsedMemoMarkdown`（`lib/markdown/memo-markdown.ts`）をそのまま再利用する。
  - frontmatter（`id` / `title` / `tags` / `created` / `updated` / `source: mybrain`）＋本文を復元できる。エクスポートと同じモジュールなので往復の整合が保証される。
- frontmatter が無い・壊れている場合も `markdownToMemo` は安全に空値へフォールバックするため、ファイル名をタイトル代わりに表示する。
- 読み取った内容は **React state（メモリ）のみ**で保持する。Supabase・localStorage・IndexedDB には保存しない（Google カレンダー読み取り表示と同じ方針）。

### 4. AI 検索／AI アシストへの将来接続

- 既存の AI アシスト（`askOllamaConsult`）は、メモ配列から参照コンテキスト（最大20件・各200字）を組み立てて渡す構造になっている。
- Drive から読み取った `ParsedMemoMarkdown` はメモ相当の形（title / tags / body / 日時）なので、**将来はこの配列に「Drive 参照メモ」として追加で渡すだけ**で接続できる。AI 側のロジック変更は不要の見込み。
- 検索も同様：メモ一覧の既存クライアント検索（部分一致）と同じ関数を、読み込み済みの Drive メモに適用するだけにする。
- ベクトル検索・埋め込み・サーバ側インデックスは**このフェーズでは扱わない**（将来の別設計）。

### 5. スコープ外（このフェーズでやらないこと）

- Drive → MyBrain（Supabase）への**取り込み・インポート**（メモとして保存し直すこと）。
- 双方向同期・競合解決・Drive 側の編集の反映。
- 自動・定期・バックグラウンドでの読み込み（読み取りは常にユーザー操作起点）。
- OAuth スコープの変更（`drive.readonly` 等への拡張はしない）。
- 他アプリが置いたファイルの読み取り（`drive.file` では不可視。制限として明記する）。
- 埋め込み・ベクトル検索・全文インデックスの構築。
- Google カレンダー連携・Supabase スキーマ・メモ入力 UI の変更。

### 6. プライバシー・安全の境界

- アクセストークンは**短命・メモリのみ・保存しない**（既存の書き出しと同じ）。リフレッシュトークンは扱わない。
- 読み取った Markdown 本文は**画面表示と AI 参照のためのメモリ保持のみ**。Supabase・localStorage 等へ書き込まない。
- 読み取り専用：この機能から Drive のファイルを**変更・削除・移動しない**。
- AI アシストへ渡すのは、ユーザーが明示的に読み込んだファイルの内容だけ（黙って全ファイルを AI に送らない）。
- AI 送信先は既存の Ollama 設定に従う（この設計で送信先は増やさない）。
- 未ログインではメモ画面自体に到達できない（既存のログインガードのまま）。

### 7. Google Drive スコープの前提

- 使用スコープ：`drive.file`（現状のまま・変更しない）。
- `files.list` / `files.get?alt=media` は `drive.file` の範囲内で、**アプリ自身が作成したファイルに対して**利用できる。
- 追加の同意は不要（同じスコープなので、既存の同意ポップアップと同じ体験）。
- 制限の明記：MyBrain がエクスポートしたファイルだけが一覧に出る。Obsidian 等が置いたファイルは表示されない旨を UI の説明文（簡単な日本語）で伝える。

### 8. 実装フェーズ案（それぞれ独立の小タスク）

1. **Phase 1（一覧のみ）— ✅実装済み（2026-07-09・OBS26）**：`lib/google/google-drive-read.ts` に `listDriveMarkdownFiles` を追加し、デスクトップの一括エクスポートパネル内に「エクスポート済み一覧」を表示（ファイル名・更新日時のみ。ユーザー操作起点・読み取り専用・フォルダ作成なし）。
2. **Phase 2（1件プレビュー）**：`readDriveMarkdownFile` を追加し、一覧から選んだ 1 件を `markdownToMemo` で解析してプレビュー表示（タイトル・タグ・本文。メモリのみ）。
3. **Phase 3（AI/検索参照・任意）**：読み込み済みの Drive メモを、既存のクライアント検索と AI アシストの参照コンテキストに「Driveの参照」として追加できるようにする（ユーザーが明示的に選んだ場合のみ）。
- 各フェーズとも：実装後に `npx tsc --noEmit`・`npm run build`・本番QA（下のチェックリスト）を実施してから次へ進む。
- UI はまずデスクトップから着手し、モバイルは Phase ごとに別タスクとする（スマホ UI を壊さないため）。

### 9. QAチェックリスト草案（実装フェーズで正式化する）

| # | ケース | 期待 |
|---|---|---|
| R1 | 一覧表示（構成済み・エクスポート済み） | `MyBrain/Memos/` の MyBrain がエクスポートした `.md` がファイル名・更新日時つきで一覧表示される |
| R2 | 一覧表示（エクスポート0件） | エラーにならず「まだエクスポートがありません」等のやさしい案内が出る |
| R3 | 未構成環境 | 読み取りUI自体が表示されない |
| R4 | 他アプリが置いたファイル | 一覧に表示されない（`drive.file` の仕様として説明文がある） |
| R5 | 1件プレビュー | 選んだファイルのタイトル・タグ・本文が正しく表示される（frontmatter 復元） |
| R6 | frontmatter 無しファイル | エラーにならず、ファイル名がタイトル代わりに表示される |
| R7 | 読み取り専用であること | 読み取り後も Drive のファイルは変更・削除されない |
| R8 | 保存しないこと | 読み取った内容が Supabase・localStorage に保存されない（リロードで消える） |
| R9 | 手動のみであること | ユーザー操作なしに Drive への読み取りリクエストが発生しない |
| R10 | 同意キャンセル | 同意ポップアップを閉じると何も読み込まれず、エラー表示も穏当 |

---

## OBS26 QA（Phase 1：一覧のみ）— 手動QAチェックリスト

Phase 1 の本番検証で確認するケース（上の草案 R1〜R10 のうち Phase 1 に該当するもの）。

| # | ケース | 期待 | 合否 |
|---|---|---|---|
| R1 | 一覧表示（構成済み・エクスポート済み） | デスクトップのメモ一覧 ＞ 一括エクスポートパネル ＞「エクスポート済み一覧」＞「一覧を確認」→（必要なら）Google 同意 → `MyBrain/Memos/` の `.md` がファイル名・更新日時つきで新しい順に表示される | ☑ Pass ☐ Fail（2026-07-09・OBS26R） |
| R2 | 一覧表示（エクスポート0件／フォルダなし） | エラーにならず「Google Driveに書き出したMarkdownはまだありません。」と表示される。**Drive にフォルダは作成されない** | ☑ Pass ☐ Fail（2026-07-09・OBS26R） |
| R3 | 未構成環境 | 「エクスポート済み一覧」の表示自体が出ない | ☐ Pass ☐ Fail（未実施：本番は Drive 構成済みのため未構成環境の確認は対象外。表示条件はコード上 `googleDriveConfigured` で制御） |
| R7 | 読み取り専用であること | 一覧を確認しても Drive のファイル・フォルダは変更・削除・作成されない | ☑ Pass ☐ Fail（2026-07-09・OBS26R。既存のエクスポート導線も引き続き動作することを確認） |
| R9 | 手動のみであること | 「一覧を確認」を押すまで Drive への読み取りリクエストが発生しない（画面表示だけでは同意ポップアップが出ない） | ☑ Pass ☐ Fail（2026-07-09・OBS26R） |
| R10 | 同意キャンセル | 同意ポップアップを閉じると何も読み込まれず、エラー表示も出ない（元の状態に戻る） | ☑ Pass ☐ Fail（2026-07-09・OBS26R） |

- R4（他アプリのファイル非表示）・R5・R6（本文プレビュー系）・R8 は Phase 2 以降で正式化する。
- モバイル UI は Phase 1 では変更していないため、モバイルの確認は不要。

### OBS26R 実施記録（2026-07-09）

- **テスト日**：2026-07-09
- **テスター**：オーナー（本人）
- **環境**：本番（デスクトップ・ログイン済み・Google Drive 連携構成済み）
- 確認できたこと：
  1. エクスポート済みの Markdown が、ファイル名・更新日時つきで一覧表示される（R1 Pass）。
  2. フォルダが無い／空の場合は「まだありません」の空表示になり、Drive にフォルダは作成されない（R2 Pass）。
  3. Google の同意ポップアップをキャンセルしても、分かりにくいエラーは出ず安全に元の状態へ戻る（R10 Pass）。
  4. 既存のエクスポート導線（ZIP／フォルダ／Google Drive 書き出し）は引き続き動作し、Drive のファイルは変更されない（R7 Pass）。
  5. Drive への読み取りリクエストは「一覧を確認」を押したときだけ発生する（R9 Pass）。
  6. Markdown の本文は表示されない（Phase 1 のスコープどおり。本文読み取りは Phase 2）。
- R3（未構成環境で読み取りUIが出ないこと）は、本番が構成済み環境のため今回の実施では対象外（未実施）。
- これにより Phase 1（一覧のみ）の本番QAを完了とする。

---

## まとめ（最重要ポイント）

- `drive.file` スコープのまま、**MyBrain が自分で書き出した Markdown を読み返す**機能に限定する（スコープ変更なし）。
- 一覧＝`files.list`、本文＝`files.get?alt=media`、解析＝**既存の `markdownToMemo` を再利用**（新パーサ不要）。
- 読み取りは手動・読み取り専用・メモリのみ。MyBrain（Supabase）が source of truth のまま。
- AI/検索への接続は、既存のメモ配列に「Drive 参照メモ」を足すだけの形にして、AI ロジック自体は変えない。
