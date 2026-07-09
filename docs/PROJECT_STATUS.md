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
