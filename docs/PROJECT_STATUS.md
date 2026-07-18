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

### OBS33：OBS32 次フェーズ A（ヘルプ/設定への文言反映）— ✅完了（2026-07-11）

- OBS32 の次フェーズ案 A「ヘルプ/設定への文言反映」を実施した。OBS32 で「案」として残していたやさしい文言を、実際の設定 UI の説明テキストへ反映した（**表示テキストのみ**の変更）。
- 変更ファイル（copy/UI テキストのみ）：
  - `app/settings/page.tsx`（モバイル設定の「☁️ Google Drive 連携」セクションに、やさしい5項目の箇条書きを追加）。
  - `components/DesktopSettings.tsx`（デスクトップ設定「メモの保存先」の Google Drive 連携まわりに、同趣旨の4項目の箇条書きを追加）。
- 設定画面で利用者に伝わるようにした内容（非技術者向けのやさしい日本語）：
  - **MyBrain がメモの本体（正本・source of truth）**。
  - **Google Drive Markdown は書き出しコピー・参照用**。
  - **Google Drive のファイルは MyBrain に取り込まれない**（インポート機能なし）。
  - **自動の双方向同期はない**（書き出しは手動・MyBrain→Google Drive の一方向のみ）。
  - **参照メモは一時的**（画面を開いている間だけ・再読み込みで消える・保存されない）。
  - **AI 相談で参考にするのは、その場で読み込んだ参照メモだけ**。
- これは **copy/UI テキストのみ**の変更。アプリロジック・Supabase スキーマ・OAuth スコープ（`drive.file`）・Google Drive の挙動・API・ボタン・state は一切変更していない。インポートや双方向同期の実装もしていない（「ない」ことを説明しただけ）。
- `npx tsc --noEmit`・`npm run build` は成功。
- 検証メモ：設定画面はログイン必須（未ログイン時はログインへリダイレクト）のため、認証情報なしでの実画面レンダリングは取得していない。変更は既存の描画済みセクション内の静的テキストで、本番ビルドは成功している。
- 実装コミット：`496c46e fix: clarify drive markdown help text`（push 済み）。
- OBS32 次フェーズの残り（未着手）：B. モバイルへの参照・AI 拡張、C. 参照の使い勝手改善、D. 取り込み（インポート）機能の検討（要設計）、E. 検索の高度化（将来）。

### OBS34：Drive 参照メモ UX 改善の設計（OBS32 次フェーズ C の設計着手）— ✅設計完了・未実装（2026-07-11）

- OBS32 次フェーズ案 C「参照の使い勝手改善」の**調査・設計のみ**を実施した（この OBS34 ではアプリコード・UI を変更しない）。
- 新規追加：`docs/drive-reference-ux-improvement-design.md`。既存の Drive 参照メモ機能（デスクトップのみ・メモリのみ・保存しない）の UX 改善を、**表示だけ**の小さな MVP として設計。
- 調査対象（現状把握）：`components/DriveExportedFilesList.tsx`（一覧・プレビュー・参照追加）／`components/DesktopMemos.tsx`（`driveRefMemos` state・検索結果ブロック・AI 通知・上限 `DRIVE_REF_AI_MAX_ITEMS=5`／`DRIVE_REF_AI_MAX_CHARS=200`）。
- 特定した UX ペインポイント：P1 読み込み済み一覧が常時見えない／P2 個別解除が検索語依存／P3 一時性（保存されない・再読込で消える）が常時見えない／P4 AI に渡る先頭5件がどれか分からない／P5 上限（5件・約200字）が目立たない／P6 フローが分散。
- MVP 改善案（表示のみ）：①「読み込み中の Google Drive 参照メモ」トレイを検索語の有無に関係なく常時表示（件数・一時性警告・上限明示・各件「参照を解除」・「すべて解除」・先頭5件に「AIで使用」ラベル）／② AI 通知に実際に渡る先頭5件のタイトルを列挙／③「参照に追加」直後の案内に次の一歩を一言添える。やさしい日本語の文言草案・QA 草案（U1〜U11）付き。
- 変更しない境界：`driveRefMemos` は React state のみ・保存しない（永続化しない）／Google Drive の挙動・API・`drive.file` スコープ／AI 送信ロジック（`buildDriveReferenceBlock`・`askAssistant`・上限値・参照0件時の挙動不変）／モバイル UI／Supabase スキーマ／取り込み・双方向同期は実装しない。
- `npx tsc --noEmit`・`npm run build` は成功（ドキュメントのみのため挙動不変の確認）。
- 実装（MVP）は OBS34 とは別の独立タスクとして扱う（この OBS34 は設計ドキュメントのみ）。

### OBS35：Drive 参照メモ UX 可視化の改善（OBS34 設計の MVP 実装）— 🟡実装済み・本番QA待ち（2026-07-11）

- OBS34 で設計した「表示だけ」の UX MVP を実装した。デスクトップの Drive 参照メモを分かりやすく可視化する変更で、**表示（UI）のみ**。データの持ち方・AI 送信ロジックは一切変更していない。
- 変更ファイル：`components/DesktopMemos.tsx`（トレイ表示＋AI 通知の強化）／`components/DriveExportedFilesList.tsx`（参照追加後の案内文の一言追加）。
- 実装内容：
  - **常時表示トレイ**：`mode === 'list' && driveRefMemos.length > 0` のとき、検索語の有無に関係なくメモ一覧の上に「**読み込み中のGoogle Drive参照メモ（N件）**」を表示。
    - 読み込み件数（N件）を表示。
    - 一時性の警告：「**この参照メモは一時的です。再読み込みすると消えます。**」を常時表示。
    - 上限の明示：「**AI相談に使われるのは最大5件までです。**」
    - 読み込み済み参照メモのタイトル（無ければファイル名）を一覧表示。
    - 各件の解除ボタン：「**参照を解除**」（`removeDriveRef`）。
    - 全消しボタン：「**すべて解除**」（`clearDriveRefs`）。
  - **AI 利用ラベル**：先頭5件に「**AIで使用**」・6件目以降に「**AIには渡りません**」を付ける（`index < DRIVE_REF_AI_MAX_ITEMS` の表示判定のみ。`buildDriveReferenceBlock` の先頭5件と一致）。
  - **AI 通知の強化**：既存の「Google Drive参照 N件も参考にします（MyBrainには保存されません）」に加え、実際に渡る先頭5件のタイトルを「使うメモ：…」として列挙（`driveRefMemos.slice(0, 5)` の表示のみ）。
  - **参照追加後の案内（`DriveExportedFilesList`）**：成功メッセージに「読み込み中の一覧はメモ一覧の上に表示されます。」を追記（文言のみ）。
- 変更していないもの（境界を維持）：`driveRefMemos` は引き続き React state のみ・**保存しない**（永続化なし）／AI ペイロード構築（`buildDriveReferenceBlock`・`askAssistant`・最大5件／約200字ロジック・参照0件時の挙動不変）／Google Drive API・`drive.file` スコープ／認証／Supabase スキーマ／モバイル UI。新しい state は増やさず、既存の `removeDriveRef`／`clearDriveRefs`／`DRIVE_REF_AI_MAX_ITEMS` を使うだけ。
- `npx tsc --noEmit`・`npm run build` は成功。ルート読み込み時のコンソールエラーなし。
- 検証メモ：デスクトップのメモ画面はログイン必須で、参照トレイは Drive 参照を読み込んだとき（Google OAuth＋Drive 構成済み）に初めて表示される。認証情報なしでは対話的な確認（参照追加→トレイ表示→個別解除→全解除→6件目ラベル→AI 通知のタイトル列挙）ができないため、**本番QAは未実施**。実装は既存 state の表示のみで、本番ビルドは成功している。
- 実装コミット：`35dcadc feat: improve drive reference memo visibility`（push 済み）。
- 次の一歩：本番（デスクトップ・ログイン済み・Drive 構成済み）で OBS34 の QA 草案 U1〜U11 を実施し、結果を記録する。

### OBS35R：Drive 参照メモ UX 可視化改善の本番検証 — ✅完了（2026-07-11）

- OBS35 で実装した Drive 参照メモの UX 可視化改善（OBS34 設計の MVP）を、本番環境（ログイン済み PC ブラウザ・Google Drive 構成済み）でユーザーが確認した。**OBS34 QA 草案 U1〜U11 の全11ケース Pass**。
- 確認できたこと（QA チェックリストは `docs/drive-reference-ux-improvement-design.md` の7章）：
  - 参照を1件追加すると、検索語なしでも「読み込み中のGoogle Drive参照メモ」トレイがメモ一覧上部に表示され、件数が正しい（U1）。
  - トレイの「参照を解除」で対象1件だけ消え、他は残る（U2）。
  - 「すべて解除」で全部消え、トレイ自体が消える（U3）。
  - 一時性の警告「この参照メモは一時的です。再読み込みすると消えます。」が常時表示される（U4）。
  - 上限の説明「AI相談に使われるのは最大5件までです。」が表示され、先頭5件に「AIで使用」・6件目以降に「AIには渡りません」が付く（U5）。
  - AI 相談前の通知に、実際に渡る参照メモ名（先頭最大5件）が表示される（U6）。
  - 参照0件のとき、トレイ・AI通知ともに非表示（挙動不変）（U7）。
  - ページ再読み込みで参照メモが消える（保存されていない）（U8）。
  - 既存の Drive 一覧・プレビュー・検索結果ブロック・「参照中」バッジは引き続き動作する（U9）。
  - モバイル UI は変化しない（U10）。
  - `npx tsc --noEmit`・`npm run build` は成功（U11）。
- 取り込み（インポート）・双方向同期・参照メモの永続化が発生していないことも確認（読み込みは手動・メモリのみ・リロードで消える）。
- これで OBS32 次フェーズ C「参照の使い勝手改善」は、設計（OBS34）→実装（OBS35）→本番QA（OBS35R）まで完了。
- この作業（OBS35R）はドキュメントのみで、アプリコード・Supabase スキーマ・OAuth スコープ・Google Drive の挙動・モバイル UI は変更していない。
- 実装コミット：`35dcadc feat: improve drive reference memo visibility`（push 済み）。
- OBS32 次フェーズの残り（未着手）：B. モバイルへの参照・AI 拡張、D. 取り込み（インポート）機能の検討（要設計）、E. 検索の高度化（将来）。

### OBS36：モバイル Drive 参照メモ・AI 相談拡張の設計（OBS32 次フェーズ B の設計着手）— ✅設計完了・未実装（2026-07-12）

- OBS32 次フェーズ案 B「モバイルへの参照・AI 拡張」の**調査・設計のみ**を実施した（この OBS36 ではアプリコード・UI を変更しない）。
- 新規追加：`docs/mobile-drive-reference-ai-design.md`。デスクトップ専用の Drive 参照メモ（一覧・参照・トレイ・AI 参照）をモバイルへ広げる MVP 設計。
- 調査結果：モバイルは現在「書き出しのみ」（`/memos` 保存後ワンタップ・`/history` 一括書き出し）。AI 相談は `/consult`（`askOllamaConsult`＝`lib/ai/consult-ollama.ts`・保存済みメモ／予定を参照）。参照・読み返しはデスクトップ専用。
- **設計の決め手**：参照メモはメモリのみ・保存禁止のため、モバイルでルートをまたぐと state が消える。→ **MVP は `/consult` 1画面完結**とする（読み込み・トレイ・AI 相談を同じ画面に置く）。
- MVP 設計の骨子：
  - `/consult` に折りたたみ式「Google Driveのメモを参考にする」セクションを追加（Drive 構成済み・ログイン済みのときのみ表示・既定は閉じる）。
  - 中身：やさしい説明（一時性「画面を離れたり再読み込みすると消えます」・上限「AI相談に使われるのは最大5件までです」）→「一覧を確認」（タップ起点のみ・自動読み込みなし）→ 各行「参照に追加」→ 読み込み中トレイ（件数・「AIで使用」／「AIには渡りません」・「参照を解除」・「すべて解除」）→ 送信前通知（「Google Drive参照 N件も参考にします…」＋「使うメモ：…」）。
  - AI への渡し方：`askOllamaConsult` に**省略可能引数**で参照配列を追加（0件なら送信内容は従来と完全に同じ＝挙動不変）。上限・形式はデスクトップの `buildDriveReferenceBlock` と同一（最大5件・各約200字・別ブロック・出所明示）。相談履歴（localStorage）には参照メモを混ぜない。
  - 実装方針：`lib/google`・`markdownToMemo`・`DriveReferenceMemo` 型を再利用（新 Drive ロジックなし）。モバイル用の小さなパネルを新規（`DriveExportedFilesList` はデスクトップ専用スタイルのため共用しない＝デスクトップ無変更）。Phase M1（MVP）／M2（簡易プレビュー・任意）に分割。検索参照はモバイルに持ち込まない。
- 境界の明文化：MyBrain が正本／Drive は書き出しコピー・参照用のみ／取り込みなし／双方向同期なし／参照はメモリのみ・リロードで消える／AI が使うのは読み込んだ参照だけ（上限はデスクトップと同一）／デスクトップ挙動・OAuth スコープ（`drive.file`）・Supabase スキーマ・既存モバイル画面は変更しない。
- QA チェックリスト草案（M1〜M14）を設計ドキュメントに含めた。
- `npx tsc --noEmit`・`npm run build` は成功（ドキュメントのみのため挙動不変の確認）。
- 実装（Phase M1）は OBS36 とは別の独立タスクとして扱う（この OBS36 は設計ドキュメントのみ）。

### OBS37：モバイル `/consult` への Drive 参照メモ実装（OBS36 設計の Phase M1）— 🟡実装済み・本番QA待ち（2026-07-12）

- OBS36 設計の Phase M1 を実装した。モバイルの AI 相談（`/consult`）に、**1画面完結**の Google Drive 参照メモ MVP を追加した。
- 変更ファイル：
  - 新規：`components/MobileDriveReferencePanel.tsx`（モバイル用パネル。ダーク・ネオン・グラスの `/consult` UI に合わせた別コンポーネント。Drive ロジックは既存 `lib/google`・`markdownToMemo` を再利用）。
  - 更新：`app/consult/page.tsx`（パネル組み込み・送信前通知・`driveRefMemos` state・`send()` で参照を渡す）。
  - 更新：`lib/ai/consult-ollama.ts`（`askOllamaConsult` に省略可能引数 `driveRefs` を追加・`buildDriveReferenceBlock` をデスクトップと同一規則で追加・`DRIVE_REF_AI_MAX_ITEMS=5` を export）。
- 実装内容：
  - **折りたたみ式パネル**「Google Driveのメモを参考にする」（既定は閉じる。閉じていても参照があれば件数を表示）。
  - **一覧・読み込みフロー**：「一覧を確認」をタップしたときだけ Drive に問い合わせ（自動読み込みなし・OAuth はタップ起点・キャンセルは静かに戻る）→ 各行「参照に追加」（追加済みは「参照中」）。
  - **読み込み中トレイ**：「読み込み中のGoogle Drive参照メモ（N件）」＋件数表示。
  - 一時性の警告：「この参照メモは一時的です。再読み込みすると消えます。」
  - 上限の明示：「AI相談に使われるのは最大5件までです。」
  - **AI 利用ラベル**：先頭5件「AIで使用」／6件目以降「AIには渡りません」。
  - 1件解除「参照を解除」／全解除「すべて解除」。
  - **送信前通知**：「Google Drive参照 N件も参考にします（MyBrainには保存されません）」＋「使うメモ：…」（実際に渡る先頭最大5件のタイトル）。
  - **`askOllamaConsult` の省略可能引数**：未指定・0件なら送信内容は従来と完全に同じ（挙動不変）。1件以上なら最大5件・本文各約200字・タイトル60字・出所明示の別ブロックを user メッセージ末尾に追記し、system に「参照メモは補助」の1文を追加（デスクトップ Phase 3b と同一の値・形式）。
- 表示条件（設計への追加判断）：パネル・通知は **Drive 構成済み かつ Ollama 有効・ローカル環境**のときのみ表示。Ollama を使わない環境ではローカル回答エンジンが参照を使えないため、「参考にします」と表示して実際は使われない誤解を防ぐ。
- 境界（変更していないもの）：Supabase スキーマ／OAuth スコープ（`drive.file`）／Google Drive API の挙動／取り込み（インポート）なし／双方向同期なし／参照メモの永続化なし（React state のみ・再読み込みで消える）／**参照内容は相談履歴・localStorage・Supabase に保存しない**／デスクトップ挙動は無変更（`DesktopMemos.tsx`・`DriveExportedFilesList.tsx` は型 import のみ）。
- 検証：`npx tsc --noEmit`・`npm run build` は成功。ルート読み込み時のサーバー・コンソールエラーなし。**本番QAは未実施**（`/consult` はログイン必須＋Drive OAuth＋ローカル Ollama が必要なため）。
- 実装コミット：`845f698 feat: add mobile drive reference memos to consult`（push 済み）。
- 次の一歩：本番（ログイン済み・Drive 構成済み・ローカル Ollama・モバイル幅）で OBS36 の QA 草案 M1〜M14 を実施し、結果を OBS37R として記録する。

### OBS37R：モバイル `/consult` Drive 参照メモの本番QA — ✅クローズ（代替環境QA完了・2026-07-18）

- OBS37 実装の本番QA（OBS36 QA 草案 M1〜M14）を**スマホ実機の本番環境**で試みたが、**環境条件が成立せず保留**とする。
- 状況：
  - スマホ本番の設定画面で、Ollama は**ローカル専用**と表示され、「公開環境からは Ollama に接続できません」の説明が出ている。接続状態は**未接続**。
  - Ollama はユーザー PC の `localhost:11434` で動くローカル AI であり、スマホ本番（公開環境）からは到達できない。
  - OBS37 の表示条件は「Drive 構成済み **かつ** Ollama 有効」のため、Ollama 未接続のスマホ本番では `/consult` の Drive 参照セクション自体が表示されない。
- 判定：
  - **M1 はアプリ挙動としての Fail ではない**。表示条件「Ollama 有効」がスマホ本番で満たせないための**保留（blocked）**。
  - むしろ「Ollama 無効の環境では参照欄を出さない」という OBS37 の表示条件どおりに動いており、誤解防止（使われない参照を『参考にします』と見せない）の設計判断は本番でも機能している。
- 次の検証手段（どちらか）：
  1. **PC ローカル環境**（ログイン済み・Drive 構成済み・Ollama 起動済み）でブラウザをモバイル幅にして M1〜M14 を実施する。
  2. モバイルで Ollama 以外の AI（非ローカル）を使えるようにする**設計判断**を先に行い、その後にスマホ実機本番で QA する（この判断は別 OBS として扱う）。
- この作業（OBS37R）はドキュメントのみで、アプリコード・Supabase スキーマ・OAuth スコープ・Google Drive の挙動・モバイル UI は変更していない。chinese-friend-lesson にも触れていない。
- **クローズ記録（2026-07-18）**：本項は「**代替環境QA完了**」としてクローズした（当初記録の 🟠保留（環境条件未成立・2026-07-12）は上記のとおり歴史的記録として保持）。根拠：
  - OBS40（PC ローカル環境＋モバイル幅）で M3〜M11 が Pass。
  - M1 相当は M3・M11 の操作過程で確認済み。
  - M2 は Drive 未構成環境の確認項目のため、構成済み環境では対象外（OBS26R の R3 と同じ扱い）。
  - M12〜M14 はコード境界・Git 履歴・`npx tsc --noEmit`・`npm run build` の記録で確認済み。
  - 最後に残っていた M3 の OAuth キャンセル動作は、OBS42（未認証ブラウザ・2026-07-18）で Pass。
  - 留意点：スマホ実機「本番」での QA は、Ollama がローカル専用である限り実施できないまま（だからこその代替環境クローズ）。将来モバイルで非ローカル AI を使えるようにした場合の実機再QAは、別の新しい OBS として扱う。

### OBS38：モバイル Drive 参照の「見つからない・理由が分からない」改善 — ✅完了・本番QA Pass（2026-07-12）

- OBS37R の保留を受けた調査で、2つの問題を特定し、最小の実装で解消した。
- **問題1：非表示の理由が分からない**。`/consult` の Drive 参照セクションは「Drive 構成済み かつ Ollama 有効・ローカル環境」のときのみ表示されるが、条件を満たさないと何の説明もなく消えるため、ユーザーには理由が分からなかった。
- **問題2：`/consult` への導線がない**。モバイルのメニュー「AI」は `/ai-assist`（AIアシスト管理）に遷移し、そこに見える「AIアシスト・メモ・予定・アシスト履歴」は設定トグルで遷移しない。`/consult` は「質問を入力して送信」しないと開けず、質問前に Drive 参照を準備する導線が実質なかった。
- 実装（2コミット・いずれも最小変更）：
  - `6f31b54 fix: explain mobile drive reference availability`：`app/consult/page.tsx`（+15行）。Drive 構成済みだが Ollama が使えないとき、パネルの位置に1行の説明を表示：「Google Driveのメモ参照は、ローカルAI（Ollama）接続時に使えます。現在はローカルAIが未接続のため表示していません。」（参照機能自体は有効化しない・パネルは出さない）。
  - `bbfb290 fix: add mobile link to consult screen`：`app/ai-assist/page.tsx`（+10行）。「AIに相談する」ブロックに説明文「Driveメモ参照を使う場合は、相談画面を開いてください。」とリンク「相談画面を開く →」（`/consult`）を追加。既存ボタン・空入力ヒントの挙動は無変更。
- 境界（変更していないもの）：AI ロジック／Supabase スキーマ／OAuth スコープ／Google Drive の挙動／デスクトップ UI／既存ボタン・トグルの挙動。
- 検証：`npx tsc --noEmit`・`npm run build` は両コミットとも成功。ローカルプレビュー（モバイル幅）でリンク・説明文の表示と `href="/consult"` を確認。
- **本番QA（スマホ実機・Pass）**：
  - `/ai-assist` の「相談画面を開く →」から相談画面（`/consult`）を開けた（画面タイトルは「AIアシスト」だが相談入力欄が表示され、相談画面として確認できた）。
  - Ollama 未接続の状態で、`/consult` に上記の1行説明が表示された。
- 残メモ：`/consult` の画面見出しも「AIアシスト」のため `/ai-assist` と区別しにくい（今回のQAでも確認に一手間かかった）。見出し文言の整理は必要になったら別 OBS として扱う。→ OBS39 で対応済み。
- OBS37R（M1〜M14 の本番QA）は引き続き保留。次の検証は PC ローカル環境（Ollama 起動済み）＋モバイル幅で実施する。

### OBS39：モバイル `/consult` 見出しの明確化 — ✅完了・本番QA Pass（2026-07-12）

- OBS38 の残メモへの対応。モバイルでは `/ai-assist`（AIアシスト管理）と `/consult` の見出しがどちらも「AIアシスト」に見え、どちらの画面にいるか分かりにくかった。
- 実装：`app/consult/page.tsx` のモバイル見出し（ロゴ下）を「AIアシスト」→「**AI相談**」に変更（実質1行・スタイル・位置は無変更）。
- サブタイトルの追加は見送り：「Drive参照メモをもとに相談できます」等を常時表示すると、Ollama 未接続環境では使えない機能をうたうことになり、OBS38 で防いだ誤解を再導入するため。既存の「※ AIの回答は保存されたデータをもとに生成されます。」で説明は足りると判断。
- 境界（変更していないもの）：デスクトップ `DesktopConsult` の見出し（PC はサイドバーから直接遷移でき混同が起きにくい）／`/ai-assist` の文言／ナビゲーション・AI ロジック・Drive 参照ロジック・Supabase スキーマ・OAuth スコープ。
- 検証：`npx tsc --noEmit`・`npm run build` は成功。
- **本番QA（スマホ実機・Pass）**：`/consult` の見出しが「AI相談」になり、`/ai-assist` の「AIアシスト管理」と区別しやすくなったことを確認。
- 実装コミット：`5cc2878 fix: clarify consult screen title`（push 済み）。
- OBS37R（M1〜M14 の本番QA）は引き続き保留。次の検証は PC ローカル環境（Ollama 起動済み）＋モバイル幅で実施する。

### OBS41：モバイル `/consult` スマホ本番表示QA — ✅完了・Pass（2026-07-15）

- OBS38・OBS39 反映後のモバイル `/consult` を、スマホ実機の本番環境で確認した（記録のみ・アプリコード変更なし）。
- 確認結果（すべて Pass）：
  - `/consult` の見出しは「**AI相談**」と表示されている（OBS39 の変更どおり）。
  - Ollama 未接続時は「Google Driveのメモを参考にする」欄が表示されない（OBS37 の表示条件どおり）。
  - 案内文「Google Driveのメモ参照は、ローカルAI（Ollama）接続時に使えます。現在はローカルAIが未接続のため表示していません。」が正常に表示されている（OBS38 の変更どおり）。
  - 入力欄・かんたん相談ボタン・空状態表示に文字切れ・レイアウト崩れなし。
- **スマホ表示QAは Pass**。
- この作業（OBS41）はドキュメントのみで、アプリコード・UI・設定・Supabase スキーマは変更していない。
- OBS37R（M1〜M14 の本番QA）と OBS40（PC ローカル環境での代替QA）は引き続き別タスクとして扱う。

### OBS40：モバイル `/consult` Drive 参照メモの代替QA（PC ローカル＋モバイル幅）— ✅完了・M3〜M11 Pass（M3 の OAuth キャンセルのみ未実施・2026-07-17）

- OBS37R がスマホ本番で環境条件未成立（Ollama 未接続）のため保留となっていた OBS36 QA 草案 M1〜M14 のうち、残り項目 M3〜M11 を **PC ローカル環境＋モバイル幅**で実施した（代替QA）。
- 実施方法：ユーザーが普段使用している Chrome を操作し、Claude Code が手順を1項目ずつ案内する方式（2026-07-14 の方針＝案C のとおり）。
- 実施環境：
  - 開発サーバー：`C:\Users\owner\Desktop\AI_iphone_web` から `npm run dev`（Next.js 14.2.15・ポート3000・1プロセスのみ・HTTP 200 応答確認済み）。
  - Ollama 起動済み（gemma4:12b／qwen2.5:1.5b／qwen3.5:4b／gemma4:e4b）。
  - 設定画面の「Ollama（ローカルAI）」トグル ON（`1c5dd4e` で追加したトグル）。
  - Google ログイン済み・Google Drive 構成済み（`NEXT_PUBLIC_GOOGLE_DRIVE_ENABLED=true`）。
  - Chrome 開発者ツールでモバイル幅 375×812。
- 結果（実画面QA）：
  - **M3：主要動作 Pass**。「Google Driveのメモを参考にする」を展開しただけでは一覧は自動表示されず、「一覧を確認」をタップした後にのみ Drive の Markdown 一覧（ファイル名・更新日時・「参照に追加」）が表示された。**ただし OAuth 許可画面のキャンセル動作のみ未実施**（ブラウザが既に Google 認証済みのため許可画面自体が出なかった）。
  - **M4：Pass**。「参照に追加」でトレイに追加され、件数・タイトルが正しい。追加済みファイルは一覧側で「参照中」表示となり、重複追加はできない。2件目追加で件数が2に更新された。
  - **M5：Pass**。「この参照メモは一時的です。画面を離れたり再読み込みすると消えます。」と「AI相談に使われるのは最大5件までです。」が文字切れなく常時表示された。
  - **M6：Pass**。「参照を解除」で選択した1件だけが消え（2→1件）、残りは表示され続け、解除したファイルは一覧側で「参照に追加」に戻った。「すべて解除」で全件が消え、トレイ自体も消えた。
  - **M7：Pass**。6件追加で件数表示は6件、先頭5件に「AIで使用」・6件目に「AIには渡りません」が付いた。文字切れ・レイアウト崩れなし。
  - **M8：Pass**。質問入力欄の上に「Google Drive参照 6件も参考にします（MyBrainには保存されません）」が表示され、「使うメモ：」には先頭5件のタイトルのみが列挙された（6件目は含まれない）。
  - **M9：Pass**。先頭5件のメモにしか書いていない内容の質問に対し、AI 回答が正常に返り、そのメモ固有の情報が反映された。
  - **M10：Pass**。「すべて解除」で参照0件にするとトレイ・送信前通知の両方が消え、質問送信は従来どおり成功。回答に Drive 参照メモ固有の内容は混入しなかった。
  - **M11：Pass**。参照1件の状態で再読み込みするとトレイ・送信前通知が消え、セクションは既定の閉じた状態に戻った。別画面へ遷移して `/consult` に戻った場合も同様に消えた。相談履歴には質問と AI 回答テキストのみが残り、参照メモのタイトル・本文・参照ブロックは保存されていない（AI 回答に参照内容が反映されたテキストが残るのは想定どおり）。
- 関連項目の扱い（2026-07-14 の照合どおり）：
  - M1 相当（Drive 構成済み・ログイン済みでセクションが**既定で閉じた状態**で表示される）は、M3・M11 の操作過程で確認された。
  - M2 は Drive 未構成環境の確認項目のため、今回の構成済み環境では対象外（OBS26R の R3 と同じ扱い）。
  - M12〜M14 はコード境界・Git 履歴・`npx tsc --noEmit`・`npm run build` の記録で確認済み。
- 残項目・次の判断：
  - **M3 の OAuth キャンセル動作のみ未実施**。確認する場合は未認証ブラウザ（シークレットウィンドウ等）で別途実施する。→ OBS42 で実施済み・Pass（2026-07-18）。
  - OBS37R を「代替環境QA完了」としてクローズするかの判断は、OAuth キャンセル項目の扱いを決めた上で行う（別途判断）。→ OBS42 の Pass を受け、OBS37R は「代替環境QA完了」としてクローズ（2026-07-18）。
- この作業（OBS40）は QA と記録のみで、アプリコード・Supabase スキーマ・OAuth スコープ・Google Drive の挙動は変更していない。chinese-friend-lesson にも触れていない。

### OBS42：モバイル `/consult` Drive 参照 M3 OAuthキャンセルの追補QA（未認証ブラウザ）— ✅完了・Pass（2026-07-18）

- OBS40 で唯一未実施だった **M3 の OAuth キャンセル動作**を、未認証ブラウザで実施した（QA記録のみ・アプリコード変更なし）。
- 実施環境：
  - ローカル開発サーバー：`http://localhost:3000`。
  - Chrome シークレットウィンドウ（未認証ブラウザ）。
  - MyBrain ログインはメール／パスワードで実施。
  - 設定画面の「Ollama（ローカルAI）」トグル ON・接続テスト Pass。
  - モバイル幅 375×812・対象画面 `/consult`。
- 実施手順：
  1. 「Google Driveのメモを参考にする」を展開。
  2. 「一覧を確認」をタップ。
  3. Google OAuth の認証フローをキャンセル（閉じる）。
  4. MyBrain の相談画面に戻る。
- 結果（**Pass**）：
  - 画面は静かに元の状態へ戻った。
  - ランタイムエラーなし・エラーループなし・UI 崩れなし。
  - Google Drive のファイル一覧は表示されなかった。
  - 「一覧を確認」は再度タップできる状態のまま残った（リトライ可能）。
  - 設計どおりの挙動（「キャンセルは静かに戻る」）を確認した。
- これで OBS36 QA 草案 M1〜M14 のすべての項目に決着がつき、**OBS37R は「代替環境QA完了」としてクローズ**した（OBS37R のクローズ記録を参照）。
- この作業（OBS42）はドキュメントのみで、アプリコード・Supabase スキーマ・OAuth スコープ・Google Drive の挙動・モバイル UI は変更していない。chinese-friend-lesson にも触れていない。
