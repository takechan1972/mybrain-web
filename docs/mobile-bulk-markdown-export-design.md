# モバイル 複数メモ一括 Markdown エクスポート ― 設計メモ

> **ステータス：✅ 実装済み（2026-07-09・OBS24）。** 本設計のとおり `app/history/page.tsx` の一括エクスポートパネルに「Google Driveへ書き出し」ボタンを追加した（Drive 構成済み環境のみ表示・既存 `exportMemosToGoogleDrive` を再利用・手動のみ・上書きしない）。本番QAは `docs/markdown-export-qa-checklist.md` のテスト9として実施する。
> 関連：`docs/google-drive-markdown-export-design.md`（Drive 書き出し設計）／`docs/markdown-export-qa-checklist.md`（QA 全8ケース Pass 済み）／`lib/google/google-drive-export.ts`／`lib/markdown/export-memos-zip.ts`。

---

## 機能名

**モバイル 複数メモ一括 Markdown エクスポート**（Mobile Bulk Markdown Export）

モバイルのメモ一覧（`app/history/page.tsx`）で選択した複数メモを、Google Drive の `MyBrain/Memos/` に個別の Markdown（`.md`）ファイルとして手動で書き出せるようにする。

---

## 現状整理（2026-07-09 時点）

複数メモの一括エクスポートは、すでに大部分が実装・QA済み（OBS22 で全8ケース Pass）。

| 一括エクスポート先 | デスクトップ | モバイル |
|---|---|---|
| ZIP ダウンロード | ✅ 実装済み | ✅ 実装済み |
| ローカルフォルダ（File System Access） | ✅ 実装済み（対応PCブラウザ） | ―（API 非対応のため対象外） |
| Google Drive（`MyBrain/Memos/`） | ✅ 実装済み | ❌ **未実装（今回のギャップ）** |

- モバイルの Google Drive 書き出しは現在「保存直後の1件ボタン」（OBS18）のみ。過去のメモをまとめて Drive に出す手段がない。
- 一括 Drive 書き出しの中核 `exportMemosToGoogleDrive`（`lib/google/google-drive-export.ts`）は UI 非依存で、デスクトップの複数選択からすでに呼ばれている。モバイルからの再利用に追加実装は不要。
- モバイルのメモ一覧には選択モード（`memoSelectMode` / `memoSelectedIds`）と一括エクスポートパネルがすでにあり、ZIP ボタンが接続済み。

## 提案（最小の次フェーズ）

モバイルの一括エクスポートパネルに **「Google Driveへ書き出し」ボタンを1つ追加**する。

1. 表示条件：Google Drive が構成済みの環境のみ（デスクトップと同じ判定を再利用）。
2. 押下時の流れ（デスクトップの `exportSelectedMemosToGoogleDrive` と同じ）：
   - 選択0件なら操作不可（ボタン disabled）。
   - 選択数が多い場合は先に警告（既存のしきい値を共有）。
   - 件数入りの確認ダイアログ →（未認可なら）Google 同意ポップアップ → アップロード → 成功/失敗件数をトーストで通知。
3. 書き出し先は `MyBrain/Memos/`。同名ファイルは上書きせず連番（`名前-2.md`）で新規作成（既存挙動）。
4. 文言はデスクトップに合わせた簡単な日本語（例：「選択した◯件のメモをGoogle Driveの MyBrain/Memos/ に書き出します。よろしいですか？」）。

UI 変更はボタン1つとパネル説明文の1行追記のみ。既存の ZIP ボタン・選択モード・メモ入力 UI は変えない。

## スコープ外（このフェーズでやらないこと）

- 逐次 `.md` ダウンロード（複数ファイルの連続ダウンロード）：iPhone/iPad Safari の制限により不採用（`lib/storage/obsidian-bulk-export-strategy.ts` の方針どおり）。
- モバイルのローカルフォルダ書き出し：File System Access API 非対応のため対象外。
- 保存時の自動 Drive 書き出し・バックグラウンド同期（OBS17 の方針どおり、手動のみ）。
- 双方向同期・Drive からの取り込み。
- Supabase スキーマ／RLS の変更。
- Google OAuth スコープの変更（既存の Drive スコープをそのまま使う）。
- Google カレンダー連携ロジックの変更。
- デスクトップ UI の変更。

## 実装時の想定ステップ（将来・1コミット規模）

1. `app/history/page.tsx` の一括エクスポートパネルに Drive ボタンを追加（Drive 構成済みのときのみ表示）。
2. デスクトップと同じく `exportMemosToGoogleDrive(targets)` を呼び、結果をトースト表示。
3. `npx tsc --noEmit` と `npm run build` を実行。
4. 本番でモバイル実機 QA（`docs/markdown-export-qa-checklist.md` にケース追加）。

## QA 観点（実装後に確認すること）

- 未ログインでは一覧自体に到達できない（既存のログインガード）。
- 選択0件でボタンが押せない。
- 確認ダイアログでキャンセルすると何も書き出されない。
- 書き出し後、元のメモは MyBrain に残る（削除・移動されない）。
- 同じメモを再度書き出すと `-2.md` の連番で作成され、上書きされない。
- ボタン操作なしに Drive へファイルが作られない（手動のみ）。
