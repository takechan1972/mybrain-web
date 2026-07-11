# PROJECT_STATUS — MyBrain WEB

> 実装状況の簡易メモ。完了した機能を簡潔に記録する。

## 管理コンソール

### チャットボットFAQ管理（chatbot_knowledge）— ✅ 完了（2026-06-23）

- 管理画面に「チャットボットFAQ管理」を実装。`chatbot_knowledge` から Q&A を一覧表示（category / question / answer / is_public / created_at）。未公開は「未公開」と表示。
- 公開/非公開トグルを実装（管理者の RLS update により反映）。
- 管理者ログインでライブ動作を確認済み（一覧表示・公開トグル・エラーなし）。
- コミット `b1f8cbd` を push 済み。

## 設定画面

### デスクトップ設定「テーマ」を準備中表示に — ✅ 完了（2026-07-04）

- 以前のテーマ切替は `app.theme` を localStorage に保存するだけで、画面（DOM・レイアウト・Tailwind・アプリ全体）には反映されていなかった。誤解を避けるため、実装まで操作不可にした。
- デスクトップ設定 ＞ アプリ設定 ＞ テーマ に「テーマ切替は現在準備中です。」と表示。
- ライト／ダークの切替（segmented control）を無効化し、クリックできないようにした（薄く表示）。
- 本番で確認済み：メッセージが表示され、ライト／ダークが押せないこと。これは本来の想定どおりの挙動（テーマ切替はまだ未実装のため）。
- 本格的なダークモード対応は、別の将来タスクとして扱う。
- コミット `ab1354a fix: mark theme setting as coming soon` を push 済み。

## Google カレンダー連携

### Googleカレンダー 読み取り表示 — ✅ 実装済み（2026-07-04）

- Googleカレンダーの予定を「読み取り専用」で表示する機能は実装済み・UI 接続済み。
- モバイル予約画面（`app/reservations/page.tsx`）に接続済み。
- デスクトップ予定画面（`components/DesktopSchedules.tsx`）に接続済み。
- 今日／明日／今週 の予定を表示できる。
- 挙動：読み取り専用・ユーザー操作起点・表示のみ（自動取得や書き込みはしない）。
- 取得結果は React state のみで保持する。
- 取得結果は Supabase に保存しない。
- 取得結果は localStorage に保存しない。
- MyBrain の予定への取り込み（import / 双方向同期）は、意図的にまだ実装していない。
- 将来の取り込み／同期は、別の独立タスクとして扱う。
- 詳細な本番検証ログ（CAL3R / CAL5R / CAL7R / CAL8R）は `docs/google-calendar-integration-design.md` を参照。

## Obsidian / Markdown 連携

### メモの保存先・Obsidian 書き出し — ✅ 現状（2026-07-04）

- メモの保存先設定（`mybrain.memo.storageTarget`）は localStorage に保存・読み込みする。
- メモ CRUD の source of truth は常に Supabase（MyBrain）。保存先を変えても CRUD 先は変わらない。
- `getMemoStore()` は保存先に応じてアダプタを切り替えるが、どのアダプタも CRUD の実体は Supabase。
- `obsidian-local`：保存フロー側（`lib/fs` ヘルパー）が追加的にローカル Vault へ Markdown（.md）を書き出す。
  - File System Access API を使い、Vault フォルダが認可済みのときだけ書き出す（メモ保存フローに接続済み）。
  - 未対応ブラウザ・未接続時は安全にスキップ（メモは Supabase に保存済みとして扱う）。
- Markdown のコピー／ダウンロード／ZIP 一括エクスポートは実装済み。
- `obsidian-gdrive`：保存時の自動 Drive 書き出しは未実装。Google Drive へは手動エクスポートのみ対応。
- 自動 Drive 書き出しや保存アダプタの統合は、別の独立タスクとして扱う。

### OBS14R：Obsidian-local Markdown 保存の本番検証 — ✅ 完了（2026-07-05）

- 保存先「Obsidian用Markdown」（obsidian-local）を本番で確認済み。
- MyBrain のメモが Obsidian（ローカル Vault）に正しく追加されることを確認した。
- MyBrain（Supabase）は引き続き source of truth。保存は変わらず Supabase に行われる。
- Obsidian-local の Markdown 書き出しは「付加的な保存」（Supabase 保存に追加して行う書き出し）である。
- 今回の確認により、ローカル Vault への Markdown 書き出し経路が実際に動作することを確認した。
- Google Drive への自動保存は、引き続き未実装。
- Google Drive への書き出しは、引き続き手動エクスポートのみ対応。
- モバイル Safari や File System Access API 非対応ブラウザでは、ローカル Vault への書き込みに対応していない場合がある。

### OBS16R：Google Drive 手動エクスポートの本番検証 — ✅完了（2026-07-05）

- 手動の Google Drive エクスポートを本番で確認済み。
- MyBrain のメモが Google Drive へ正しく書き出されることを確認した。
- 書き出された Markdown ファイルは `MyBrain/Memos/` 配下に作成された。
- Google Drive への書き出しは、ユーザーが操作したときだけ実行される手動の挙動である。
- MyBrain（Supabase）は引き続き source of truth。
- Google Drive への書き出しは、MyBrain のメモ CRUD の挙動を変えない。
- 保存時に自動で Google Drive へ書き出す処理は、引き続き未実装。
- `writeSavedMemoToDriveIfEnabled` は、UI から呼び出されていないスキャフォールド（下地のヘルパー）のままである。
- 重複エクスポートも本番で確認済み（2026-07-05）。
  - 同じメモをもう一度エクスポートしても、既存の Markdown ファイルは上書きされない。
  - 代わりに `-2.md` のような連番付きのファイルが新しく作成される。
  - これにより、Google Drive エクスポートの重複回避（上書きしない）挙動を確認した。

### OBS17R：Google Drive 自動保存の設計方針 — 🟡調査完了・実装は保留（2026-07-05）

- Google Drive への「完全な無音の自動保存」は実装しない。
- 現在の GIS トークンフローでは、Google Drive への書き出しはユーザー操作起点のままにする。
  - GIS のトークン取得（同意ポップアップ）はユーザーのタップ操作が必要で、保存直後に自動では開けないため。
- MyBrain（Supabase）は引き続き source of truth。
- Google Drive への Markdown 書き出しは、引き続き「付加的な保存」（Supabase 保存に追加して行う書き出し）である。
- 既存の手動エクスポート（`exportMemosToGoogleDrive`）は引き続き有効であり、壊さない。
- `writeSavedMemoToDriveIfEnabled` は、UI から呼び出されていないスキャフォールド（下地のヘルパー）のままである。
- 将来実装する場合、最小の安全なステップはモバイル優先とする：
  - 保存先 `obsidian-gdrive` でメモを保存したあとに、ユーザーがタップする Drive 保存／書き出しボタンを表示する。
  - タップ時に Google Drive のトークンを取得する。
  - そのうえで `writeSavedMemoToDriveIfEnabled(memo, token)` を呼び出す。
- デスクトップ／詳細画面の保存フローは、別の独立した将来タスクとして扱う。

### OBS18R：モバイル Google Drive 保存ヘルパー接続の本番検証 — ✅完了（2026-07-05）

- 保存先 `obsidian-gdrive` のモバイル「保存後 Google Drive 書き出しボタン」を本番で確認済み。
- メモを保存したあとに、Google Drive 書き出しボタンが表示された。
- ボタンをタップすると、Google Drive の認可（同意）が正しく要求された。
- メモが Google Drive へ正しく書き出されたことを確認した。
- この導線は `requestGoogleDriveAccessToken()` と `writeSavedMemoToDriveIfEnabled(...)` を使う実装になった。
- これにより、`writeSavedMemoToDriveIfEnabled` はスキャフォールド（下地）ではなく、モバイルの保存後ボタンから実際に呼び出されるようになった。
- Google Drive への書き出しは、引き続きユーザー操作起点（ボタンのタップ時のみ）である。
- MyBrain（Supabase）は引き続き source of truth。
- デスクトップおよびメモ詳細画面の Google Drive 書き出しフローは、OBS18 では変更していない。

### OBS19R：Obsidian フォルダ接続ラベル改善の本番検証 — ✅完了（2026-07-05）

- デスクトップ設定 ＞ データ管理 ＞ Obsidian local を本番で確認済み。
- Vault 接続ボタンのラベルが `Obsidianフォルダを接続` になっていることを確認した（以前は `Vaultフォルダを選択`）。
- 接続中の状態表示が `接続中：Memos` と表示されることを確認した。
- `再接続` と `接続を解除` のボタンも引き続き表示されていることを確認した。
- 今回はラベル（文言）のみの UX 改善である。
- 接続／再接続／解除の挙動は変更していない。
- モバイル設定は変更していない。
- ファイルシステム系ヘルパー（`lib/fs`）は変更していない。

### OBS20R：モバイル保存先ヘルプ文言更新の本番検証 — ✅完了（2026-07-05）

- モバイル設定 ＞ メモの保存先 を本番で確認済み。
- Google Drive の古い `準備中` 表示が出なくなったことを確認した。
- Google Drive の Markdown 書き出しが「手動・ユーザー操作」として説明されていることを確認した。
- Google Drive への完全自動保存は行わないことが画面に明記されていることを確認した。
- MyBrain が本体（source of truth）の保存先であることが画面に明記されていることを確認した。
- Obsidian と Google Drive は追加の Markdown 保存であることが画面に明記されていることを確認した。
- スマホでは Markdown のコピー・ダウンロードが使え、フォルダ直接保存は対応 PC ブラウザ向けであることが画面に明記されていることを確認した。
- 今回は文言（コピー）のみの更新である。
- 実行ロジック・UI 構造・Google OAuth スコープ・Supabase スキーマ・RLS は変更していない。

### OBS21：Markdown エクスポート 手動QAチェックリスト — ✅追加（2026-07-08）

- `docs/markdown-export-qa-checklist.md` を追加した（ドキュメントのみ・アプリコード変更なし）。
- 対象：ログイン必須画面／モバイル・デスクトップの一括ZIP／単件Markdownダウンロード／フォルダ書き出し（対応PCブラウザのみ）／Google Drive 手動書き出し（構成済み環境のみ）。
- 「MyBrain が本体の保存先」「エクスポートは手動のみ（自動保存なし）」の確認項目とブラウザ制限の注意を含む。

### OBS22：Markdown エクスポート 手動QA 全8ケース完了 — ✅完了（2026-07-08）

- `docs/markdown-export-qa-checklist.md` の全8テストケースを本番環境で実施し、**すべて Pass（合格）** となった。
  1. ログイン必須画面（未ログインで `/history?view=memos` → ログイン画面へリダイレクト）
  2. モバイル 一括ZIPエクスポート
  3. デスクトップ 一括ZIPエクスポート
  4. メモ詳細 単件Markdownダウンロード（frontmatter 確認含む）
  5. フォルダへ書き出し（対応PCブラウザ）
  6. Google Drive 手動エクスポート（構成済み環境・同意フロー含む）
  7. MyBrain が本体の保存先であること（エクスポートで元メモは削除・移動されない）
  8. エクスポートが手動のみであること（ボタン操作なしに Obsidian・Google Drive へファイルは作成されない）
- 各実施記録の詳細は `docs/markdown-export-qa-checklist.md` の「実施記録」を参照。
- QA記録の最終コミット：`4425f66 docs: record google drive markdown export QA result`。
- この作業はドキュメントのみで、アプリロジック・Supabase スキーマ・OAuth スコープ・エクスポート挙動は変更していない。

### OBS23：モバイル一括Markdownエクスポート 設計メモ — 🟡設計のみ・実装は未着手（2026-07-09）

- `docs/mobile-bulk-markdown-export-design.md` を追加した（ドキュメントのみ・アプリコード変更なし）。
- 現状整理：複数メモの一括エクスポートは、デスクトップが ZIP／フォルダ／Google Drive の3経路、モバイルが ZIP のみ実装済み（OBS22 で QA 済み）。
- 残ギャップ：モバイルから過去の複数メモをまとめて Google Drive（`MyBrain/Memos/`）へ書き出す導線がない。
- 提案：モバイルの一括エクスポートパネルに「Google Driveへ書き出し」ボタンを1つ追加する（既存の `exportMemosToGoogleDrive` を再利用・手動のみ・上書きしない）。
- スコープ外：逐次 .md ダウンロード（iOS制限）・自動保存・双方向同期・Supabase スキーマ／OAuth スコープ／カレンダー連携／デスクトップ UI の変更。
- 実装は次の独立タスクとして扱う（このフェーズでは設計ドキュメントのみ）。

### OBS24：モバイル一括Google Driveエクスポート 実装 — 🟡実装済み・本番QA待ち（2026-07-09）

- OBS23 の設計どおり、モバイルのメモ一覧（`app/history/page.tsx`）の一括エクスポートパネルに「Google Driveへ書き出し」ボタンを追加した。
- 表示条件：Google Drive が構成済みの環境のみ（デスクトップと同じ `isGoogleDriveConfigured()` を再利用）。
- 押下時の流れはデスクトップの複数選択エクスポートと同じ：
  - 選択0件ではボタンが押せない（disabled）。
  - 10件以上選択時は先に警告ダイアログを出す（既存しきい値を共有）。
  - 件数入りの確認ダイアログ →（未認可なら）Google 同意ポップアップ → アップロード → 成功/失敗件数をトーストで通知。
- 中核は既存の `exportMemosToGoogleDrive`（`lib/google/google-drive-export.ts`）を再利用。新しい Drive ロジックは追加していない。
- 書き出し先は Drive の `MyBrain/Memos/`。同名ファイルは上書きせず連番（`名前-2.md`）で新規作成（既存挙動のまま）。
- 既存のモバイル ZIP 一括エクスポート・選択モード・メモ入力 UI は変更していない。デスクトップ UI も変更していない。
- Supabase スキーマ・RLS・Google OAuth スコープ・Google カレンダー連携は変更していない。
- `npx tsc --noEmit`・`npm run build` は成功。
- 本番QAは `docs/markdown-export-qa-checklist.md` に追加したテスト9（モバイル 一括Google Driveエクスポート）で実施する。

### OBS24R：モバイル一括Google Driveエクスポートの本番検証 — ✅完了（2026-07-09）

- OBS24 で実装したモバイルの一括 Google Drive エクスポートを本番環境で確認済み（`docs/markdown-export-qa-checklist.md` テスト9 Pass）。
- モバイルのメモ一覧（一括エクスポートパネル）から複数メモを選択し、「Google Driveへ書き出し」で Google Drive への一括書き出しが動作することを確認した。
- これで Markdown エクスポートの手動QAは全9テストケースが Pass となった。
- Google Drive への書き出しは、引き続きユーザー操作起点（ボタンのタップ時のみ）の手動エクスポートである。
- MyBrain（Supabase）は引き続き source of truth。エクスポートで元のメモは削除・移動されない。
- この作業（OBS24R）はドキュメントのみで、アプリコード・Supabase スキーマ・OAuth スコープ・Google カレンダー連携は変更していない。
- 実装コミット：`28a3a89 feat: add mobile bulk Google Drive export for selected memos`（push 済み）。

### OBS25：Google Drive Markdown 読み取り・検索参照 設計メモ — 🟡設計のみ・実装は未着手（2026-07-09）

- `docs/google-drive-markdown-read-search-design.md` を追加した（ドキュメントのみ・アプリコード変更なし）。
- 目的：MyBrain が Drive の `MyBrain/Memos/` に書き出した Markdown を、あとから一覧・読み取りし、将来 AI アシスト・検索の参照データに使えるようにする。
- 最重要の設計判断：OAuth スコープは `drive.file` のまま変更しない。`drive.file` はアプリ自身が作成したファイルを読み返せるため、**MyBrain のエクスポート済み Markdown はスコープ変更なしで読める**。他アプリが置いたファイルは見えない（許容する制限として明記）。
- 解析は既存の `markdownToMemo`（`lib/markdown/memo-markdown.ts`）を再利用する（新パーサは作らない）。
- 読み取りは手動・読み取り専用・メモリのみ（Supabase・localStorage に保存しない）。MyBrain（Supabase）は引き続き source of truth。
- 実装フェーズ案：Phase 1（一覧のみ）→ Phase 2（1件プレビュー）→ Phase 3（AI/検索参照・任意）。各フェーズは独立の小タスク。
- スコープ外：Drive からの取り込み・双方向同期・自動読み込み・`drive.readonly` への拡張・ベクトル検索・カレンダー連携／スキーマ／メモ入力 UI の変更。
- QAチェックリスト草案（R1〜R10）を設計ドキュメントに含めた（実装フェーズで正式化する）。
- 実装は次の独立タスクとして扱う（このフェーズでは設計ドキュメントのみ）。

### OBS26：Google Drive エクスポート済み一覧（Phase 1・読み取り専用） — 🟡実装済み・本番QA待ち（2026-07-09）

- OBS25 設計の Phase 1（一覧のみ）を実装した。
- 新ヘルパー `lib/google/google-drive-read.ts`：
  - `listDriveMarkdownFiles(accessToken)`：Drive の `MyBrain/Memos/` 直下の `.md` ファイルの一覧メタデータ（id / name / modifiedTime / size）を新しい順で返す。本文はダウンロードしない。
  - `findDriveFolderPathReadOnly(...)`：既存の `findDriveFolder` を find のみで辿る読み取り専用のフォルダ解決。**フォルダが無くても作成しない**（空一覧を返す）。
  - `lib/google/index.ts` のバレルから再エクスポート。
- 新コンポーネント `components/DriveExportedFilesList.tsx`（デスクトップのみ）：
  - デスクトップのメモ一覧 ＞ 一括エクスポートパネル内に「エクスポート済み一覧」＋「一覧を確認」ボタンを追加（Drive 構成済みのときのみ表示）。
  - ボタンを押したときだけ Drive に問い合わせる（ユーザー操作起点・自動読み込みなし）。トークンは既存の `requestGoogleDriveAccessToken()` を再利用・保存しない。
  - 表示はファイル名と更新日時のみ。0件時は「Google Driveに書き出したMarkdownはまだありません。」、失敗時はやさしいエラーメッセージ。同意キャンセルは静かに元の状態へ戻す。
  - 取得結果は React state のみで保持（Supabase・localStorage に保存しない）。
- 読み取り専用：Drive のファイル・フォルダの作成・変更・削除は一切しない。
- 未実装のまま：本文読み取り（Phase 2）・AI/検索参照（Phase 3）・Supabase への取り込み。
- モバイル UI・メモ入力 UI・Supabase スキーマ・OAuth スコープ（`drive.file` のまま）・Google カレンダー連携は変更していない。
- `npx tsc --noEmit`・`npm run build` は成功。
- 本番QAは `docs/google-drive-markdown-read-search-design.md` の「OBS26 QA」（R1〜R3・R7・R9・R10）で実施する。

### OBS26R：Google Drive エクスポート済み一覧（Phase 1）の本番検証 — ✅完了（2026-07-09）

- OBS26 で実装した「エクスポート済み一覧」を、本番環境（デスクトップ・ログイン済み・Drive 構成済み）で確認済み。
- 確認できたこと（詳細は `docs/google-drive-markdown-read-search-design.md` の「OBS26R 実施記録」）：
  - エクスポート済み Markdown がファイル名・更新日時つきで一覧表示される（R1）。
  - フォルダなし／0件でも空表示になり、Drive にフォルダは作成されない（R2）。
  - 同意ポップアップのキャンセルは安全に元の状態へ戻る（R10）。
  - 既存のエクスポート導線は引き続き動作し、Drive のファイルは変更されない（R7）。
  - Drive への読み取りは「一覧を確認」を押したときだけ発生する（R9）。
  - Markdown 本文は表示されない（Phase 1 のスコープどおり）。
- R3（未構成環境で読み取りUIが出ないこと）は、本番が構成済みのため対象外（未実施）として記録した。
- これで Phase 1（一覧のみ）の本番QAは完了。次は Phase 2（1件プレビュー）を別の独立タスクとして扱う。
- この作業（OBS26R）はドキュメントのみで、アプリコード・Supabase スキーマ・OAuth スコープ・Google カレンダー連携は変更していない。
- 実装コミット：`dee94fe feat: add read-only google drive exported markdown list`（push 済み）。

### OBS27：Google Drive Markdown 1件プレビュー（Phase 2・読み取り専用） — 🟡実装済み・本番QA待ち（2026-07-09）

- OBS25 設計の Phase 2（1件プレビュー）を実装した。
- `lib/google/google-drive-read.ts` を拡張：
  - `readDriveMarkdownFile(accessToken, fileId)`：選んだ1件の Markdown 本文をテキストで読み取る（`files.get?alt=media`）。書き込み・変更・削除・フォルダ作成はしない。
  - `DRIVE_MARKDOWN_READ_MAX_BYTES`（1MB）：これを超えるファイルは読み込まない（設計のサイズ上限）。
- `components/DriveExportedFilesList.tsx` を拡張（デスクトップのみ）：
  - 一覧の各ファイルに「内容を確認」ボタンを追加。押したときだけトークン取得（既存パターン・保存しない）→本文読み取り→既存の `markdownToMemo` で解析→一覧の下にプレビュー表示。
  - プレビュー内容：タイトル（無ければファイル名）・タグ・作成/更新日時・本文。「閉じる」ボタンで閉じる。
  - frontmatter が無い場合はエラーにせず、本文をそのまま表示し「MyBrain形式の情報が見つからなかった」旨の注記を出す。
  - 状態表示：読み込み中「読み込み中...」／失敗「内容を読み込めませんでした。もう一度お試しください。」／1MB超「大きすぎるため表示できません」。同意キャンセルは静かに元へ戻す。
  - 読み取り専用：保存・取り込み・編集ボタンは置かない。本文は React state のみで保持（Supabase・localStorage に保存しない）。
- `DesktopMemos.tsx` の変更は不要（コンポーネント内で完結）。
- 未実装のまま：AI/検索参照（Phase 3）・Supabase への取り込み。
- モバイル UI・メモ入力 UI・Supabase スキーマ・OAuth スコープ（`drive.file` のまま）・Google カレンダー連携は変更していない。
- `npx tsc --noEmit`・`npm run build` は成功。
- 本番QAは `docs/google-drive-markdown-read-search-design.md` の「OBS27 QA」（R5・R6・R8・P1〜P3）で実施する。

### OBS27R：Google Drive Markdown 1件プレビュー（Phase 2）の本番検証 — ✅完了（2026-07-09）

- OBS27 で実装した1件プレビューを、本番環境（デスクトップ・ログイン済み・Drive 構成済み）で確認済み。全6ケース Pass。
- 確認できたこと（詳細は `docs/google-drive-markdown-read-search-design.md` の「OBS27R 実施記録」）：
  - プレビューにタイトル・タグ・作成/更新日時・本文が表示され、「閉じる」で正しく閉じる（R5）。
  - frontmatter 無しの Markdown は本文そのまま＋注記のフォールバック表示になる（R6）。
  - プレビューはメモリのみ。再読み込み後には何も残らず、保存・取り込み・編集ボタンは無い（R8）。
  - 読み込み中表示（P1）・失敗時のやさしいエラーメッセージ（P2）も動作する。
  - プレビュー後も Drive のファイルは変更されない（P3・読み取り専用）。
- これで OBS25 設計の Phase 1（一覧）・Phase 2（1件プレビュー）が実装・本番QAともに完了。残るは Phase 3（AI/検索参照・任意）のみで、別の独立タスクとして扱う。
- この作業（OBS27R）はドキュメントのみで、アプリコード・Supabase スキーマ・OAuth スコープ・Google カレンダー連携・モバイル UI は変更していない。
- 実装コミット：`8e92ea1 feat: add read-only google drive markdown preview`（push 済み）。

### OBS28：Drive Markdown の検索・AI参照（Phase 3）詳細設計 — 🟡設計のみ・実装は未着手（2026-07-09）

- `docs/google-drive-markdown-read-search-design.md` に「Phase 3 詳細設計（OBS28）」セクションを追加した（ドキュメントのみ・アプリコード変更なし）。
- 目的：ユーザーが明示的に読み込んだ Drive Markdown を「Google Drive参照」として、既存のクライアント検索と AI アシストの参照データに使えるようにする（取り込み・インポートではない）。
- 最重要の設計判断：**参照メモは本体メモに一切混ぜない。** 一覧・件数・フォルダ・一括エクスポートの対象外とし、検索時のみ独立セクション「Google Drive参照の検索結果」に「Google Drive参照」バッジ付きで表示する。保持は React state のみ（画面を開いている間だけ・保存しない）。
- 読み込みは既存の「エクスポート済み一覧」に「参照に追加」ボタンを足すだけ（Phase 2 の `readDriveMarkdownFile`＋`markdownToMemo` を再利用・新しい Drive ロジックなし）。
- 実装は2段階に分ける：Phase 3a（検索参照のみ・AI非接続）→ 本番QA後に Phase 3b（デスクトップ AI アシスタントへ出所明示の参照ブロックを追加。「Google Drive参照 N件も参考にします」を表示して黙って混ぜない）。
- 最初の実装はデスクトップのみ。モバイル UI・consult（モバイル AIアシスト）は変更しない。
- スコープ外：Supabase／localStorage への保存・参照の永続化・自動読み込み・ベクトル検索・OAuth スコープ変更・カレンダー連携・参照メモの編集/削除/エクスポート。
- QAチェックリスト草案（S1〜S10）を設計ドキュメントに含めた。
- 実装（Phase 3a）は次の独立タスクとして扱う（このフェーズでは設計ドキュメントのみ）。

### OBS29：Drive Markdown 検索参照（Phase 3a・AI非接続） — 🟡実装済み・本番QA待ち（2026-07-09）

- OBS28 設計の Phase 3a（検索参照のみ・AI には接続しない）を実装した。デスクトップのみ。
- `components/DriveExportedFilesList.tsx` を拡張：
  - `DriveReferenceMemo` 型（fileId / fileName / title / body / tags / createdAt / updatedAt / hasFrontmatter）を export。
  - props `references` / `onReferenceChange` を追加（未指定なら参照機能は出さない＝後方互換）。
  - 一覧の各ファイルに「参照に追加」ボタンを追加。押すと既存の `readDriveMarkdownFile`＋`markdownToMemo` で読み込み（新しい Drive ロジックなし）、親 state に追加する。
  - fileId で重複判定：追加済みは「参照中」表示になり二度追加しない。追加/重複/サイズ超過/失敗はやさしい案内文を出す。同意キャンセルは静かに終える。
  - プレビューと参照追加で本文読み取りを共有する内部関数 `readAndParse` に集約（挙動は不変）。
- `components/DesktopMemos.tsx` を拡張：
  - `driveRefMemos` state を追加（メモリのみ・本体メモ `memos` とは別物・保存しない）。`DriveExportedFilesList` に `references`/`onReferenceChange` を渡す。
  - 参照メモの検索結果 `visibleRefs` を、本体の `visible` とは独立に算出（同じ検索語・部分一致）。本体の一覧・件数・フォルダ・お気に入り・一括選択には一切混ぜない。
  - メモ一覧の下に独立セクション「Google Drive参照の検索結果（N件）」を追加（参照メモがあり検索語があるときだけ表示）。各カードに「Google Drive参照」バッジ・「参照を解除」、ヘッダに「すべて解除」。「MyBrainには保存されない・画面を開いている間だけ」と明記。
- AI アシストには接続していない（Phase 3b で対応）。参照メモは AI コンテキストに含めない。
- モバイル UI・consult（モバイル AIアシスト）・メモ入力 UI・Supabase スキーマ・OAuth スコープ（`drive.file` のまま）・Google カレンダー連携は変更していない。
- `npx tsc --noEmit`・`npm run build` は成功。
- 本番QAは `docs/google-drive-markdown-read-search-design.md` の「OBS29 QA」（S1〜S7・S9・S10）で実施する。

### OBS29R：Drive Markdown 検索参照（Phase 3a）の本番検証 — ✅完了（2026-07-10）

- OBS29 で実装した Drive Markdown 検索参照（Phase 3a・AI非接続）を、本番環境（デスクトップ・ログイン済み・Drive 構成済み）で確認済み。全9ケース Pass。
- 確認できたこと（詳細は `docs/google-drive-markdown-read-search-design.md` の「OBS29R 実施記録」）：
  - エクスポート済み一覧の「参照に追加」で Drive Markdown を参照メモとして追加できる（S1）。
  - 追加済みファイルは「参照中」表示になり、二度追加されない（S2）。
  - 参照メモは検索時のみ独立セクション「Google Drive参照の検索結果」に表示される（S3）。
  - 参照メモの検索結果に「Google Drive参照」バッジが付く（S4）。
  - 「参照を解除」で1件ずつ外せる（S5）。
  - 「すべて解除」で全参照メモを一括で外せる（S6）。
  - 参照メモは本体メモの一覧・件数・フォルダ・お気に入り・一括選択・一括エクスポートに混ざらない（S7）。
  - Phase 3a では AI アシストは Drive 参照に接続していない（S9）。
  - 既存のメモ保存・ZIP エクスポート・Drive エクスポート・一覧・プレビューは引き続き動作する（S10）。
- これで OBS25 設計の Phase 1（一覧）・Phase 2（1件プレビュー）・Phase 3a（検索参照）が実装・本番QAともに完了。残るは Phase 3b（AI参照）のみで、別の独立タスクとして扱う。
- この作業（OBS29R）はドキュメントのみで、アプリコード・Supabase スキーマ・OAuth スコープ・Google カレンダー連携・モバイル UI は変更していない。
- 実装コミット：`3f8e3d7 feat: add drive markdown reference memos to desktop search`（push 済み）。

### OBS30：Drive 参照メモの AI コンテキスト設計（Phase 3b・設計のみ） — 🟡設計のみ・実装は未着手（2026-07-10）

- `docs/google-drive-markdown-read-search-design.md` に「Phase 3b 詳細設計（OBS30）」セクションを追加した（ドキュメントのみ・アプリコード変更なし）。
- 目的：Phase 3a（検索参照・OBS29R 済み）に続く最小の安全なステップとして、ユーザーが明示的に読み込んだ Drive 参照メモを、デスクトップ AI アシストの参照コンテキストに**出所を明示して**渡す設計を確定する（取り込み・インポートではない）。
- 最重要の設計判断：
  - 接続先はデスクトップの `askAssistant`（自由質問）のみ。参照は `DesktopMemos` 内の既存 `driveRefMemos` を、送信直前に**別見出し・別ブロック**で user メッセージ末尾に足すだけ（新しい Drive ロジック・新 state を増やさない）。本体メモの本文には混ぜない。
  - モバイル AI アシスト（`app/consult`／`lib/ai/consult-ollama.ts`）は**変更しない**。要約・整理（`runMemoAi`）も対象外。
  - 上限：参照は最大5件・1件あたり本文約200字（既存 `buildContext` と同基準）。渡すのは今メモリにある参照だけ（自動読み込み・過去分復元・Drive 再問い合わせなし）。
  - 送信前に「Google Drive参照 N件も参考にします（MyBrainには保存されません）」を画面表示（黙って混ぜない）。
- スコープ外：Supabase／localStorage への保存・参照の永続化・ベクトル検索・OAuth スコープ変更・カレンダー連携・スキーマ変更・モバイル UI 変更・AI 送信先の追加。
- QAチェックリスト草案（T1〜T11）を設計ドキュメントに含めた。
- MyBrain（Supabase）は引き続き source of truth。OAuth スコープは `drive.file` のまま。
- `npx tsc --noEmit`・`npm run build` は成功（ドキュメントのみのため挙動不変の確認）。
- 実装（Phase 3b）は次の独立タスクとして扱う（このフェーズでは設計ドキュメントのみ）。

### OBS31：Drive 参照メモの AI コンテキスト接続（Phase 3b・実装） — 🟡実装済み・本番QA待ち（2026-07-10）

- OBS30 設計の Phase 3b を実装した。デスクトップの**自由質問 AI アシスト**（`askAssistant`）だけに、読み込み済み Drive 参照メモを出所明示の別ブロックで接続した。
- `components/DesktopMemos.tsx` のみ変更：
  - モジュール関数 `buildDriveReferenceBlock(refs)` を追加。読み込み済み `driveRefMemos` を「Google Drive参照メモ（MyBrain本体ではありません…）」見出しの別ブロック文字列へ整形する。
  - 上限：`DRIVE_REF_AI_MAX_ITEMS = 5`（件数）・`DRIVE_REF_AI_MAX_CHARS = 200`（本文/件）・`DRIVE_REF_AI_MAX_TITLE = 60`（タイトル）。タイトル・タグがあれば含める。参照0件なら空文字。
  - `askAssistant` は、参照ブロックが空でなければ user メッセージ末尾に**別ブロックとして追記**（本体メモ本文には混ぜない）。参照があるときだけ system プロンプトに1文追加（参照は補助・主根拠は本体メモ）。参照0件のときは送信内容が**従来と完全に同じ**（挙動不変）。
  - ユーザーに見えている質問文は書き換えない。`ollamaChat` の呼び出し形・送信先は不変。
  - UI：AIアシスタント入力の上に、`driveRefMemos.length > 0` のときだけ「Google Drive参照 N件も参考にします（MyBrainには保存されません）」を表示（Nは実送信件数＝最大5）。
- 触っていない（境界を維持）：モバイル AI アシスト（consult）・`lib/ai/consult-ollama.ts`・要約/整理（`runMemoAi`）・Supabase スキーマ／保存・localStorage への参照保存・OAuth スコープ（`drive.file`）・Google カレンダー・Drive への書き込み・モバイル UI。
- MyBrain（Supabase）は引き続き source of truth。参照はメモリのみ・リロードで消える。
- `npx tsc --noEmit`・`npm run build` は成功。
- 本番QAは `docs/google-drive-markdown-read-search-design.md` の「OBS31 QA」（T1〜T12）で実施する。

### OBS31R：Drive 参照メモの AI コンテキスト接続（Phase 3b）の本番検証 — ✅完了（2026-07-10）

- OBS31 で実装した Drive 参照メモの AI コンテキスト接続（Phase 3b）を、本番環境（デスクトップ・ログイン済み・Drive 構成済み・ローカル Ollama 接続）で確認済み。全12ケース Pass。
- 確認できたこと（詳細は `docs/google-drive-markdown-read-search-design.md` の「OBS31R 実施記録」）：
  - Drive 参照メモを読み込むと「Google Drive参照 N件も参考にします（MyBrainには保存されません）」が表示される（T1）。
  - 参照を「すべて解除」すると通知が消える（T2）。
  - AI が読み込み済みの参照メモ内容を参考に回答できる（T3）。
  - 入力欄に見えている質問文は書き換わらない（T4）。
  - AI に渡る参照は先頭5件まで（T5）。
  - 1件あたり本文は約200字までに切られて渡る（T6）。
  - 参照は「Google Drive参照メモ」として本体メモ（MyBrain本体）と別枠で渡り、本文に混ざらない（T7）。
  - 参照0件のときデスクトップ AI の挙動は従来と同じ（T8）。
  - モバイル consult は変更なし（T9）。
  - 要約・整理 AI は変更なし（T10）。
  - 参照は Supabase に保存されず、リロードで消える（T11）。
  - 既存のメモ保存・Drive 一覧・Drive プレビュー・Drive 参照検索・ZIP エクスポート・Drive エクスポートは引き続き動作する（T12）。
- これで OBS25 設計の Phase 1（一覧）・Phase 2（1件プレビュー）・Phase 3a（検索参照）・Phase 3b（AI参照）が実装・本番QAともにすべて完了。
- この作業（OBS31R）はドキュメントのみで、アプリコード・Supabase スキーマ・OAuth スコープ・Google カレンダー連携・モバイル UI は変更していない。
- 実装コミット：`12c1db4 feat: add drive reference memos to desktop AI context`（push 済み）。

### OBS32：Google Drive Markdown 連携の完了サマリ・ユーザーガイド — ✅追加（2026-07-10）

- OBS25 の Google Drive Markdown 連携（書き出し→一覧→プレビュー→検索参照→AI 参照）が全フェーズ完了したことを受け、まとめドキュメントを整備した（ドキュメントのみ・アプリコード／UI 変更なし）。
- 新規追加：`docs/google-drive-markdown-user-guide.md`（10〜70代向けのやさしいユーザーガイド）。
  - 完成した機能・いまできること・理解しておくべき4原則・設定/ヘルプ向け文言案（FAQ含む）・制限・次フェーズ案。
- `docs/google-drive-markdown-read-search-design.md` に「完了サマリ（OBS32）」セクションを追加（フェーズ別の実装/QA・コード対応表、原則、制限、次フェーズ案）。
- ユーザーが理解しておくべき原則を明文化：
  - **MyBrain本体が正本**（source of truth）。
  - **Google Drive Markdown は書き出しコピー・参照用**（取り込み・双方向同期なし）。
  - **参照メモは保存されない**（画面を開いている間だけ・リロードで消える）。
  - **AI 相談に使えるのは読み込んだ参照メモのみ**（最大5件・各約200字・送信前に画面通知）。
- 設定・ヘルプ向けのやさしい文言は「案」として記録（この OBS32 では実際の UI は変更しない）。
- 次フェーズ案（すべて未着手）：A. ヘルプ/設定への文言反映、B. モバイルへの参照・AI 拡張、C. 参照の使い勝手改善、D. 取り込み（インポート）機能の検討（要設計）、E. 検索の高度化（将来）。
- 変更していないもの：アプリコード・UI・Supabase スキーマ・OAuth スコープ（`drive.file`）・Google カレンダー連携・モバイル UI。
- `npx tsc --noEmit`・`npm run build` は成功（ドキュメントのみのため挙動不変の確認）。
