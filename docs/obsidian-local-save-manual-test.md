# Obsidian ローカル保存 手動テスト チェックリスト

MyBrain の「保存先 = obsidian-local」機能（ローカル Obsidian Vault への付加的な書き込み・上書き）を、
デスクトップブラウザで手動検証するためのチェックリスト。Google Drive・モバイル対応へ進む前の確認用。

- 対象：create-write（新規保存時の Vault 書き出し）／update-overwrite（更新時の既存ファイル上書き）
- 方針：MyBrain/Supabase が常に source of truth。Obsidian 書き込みは付加的・best-effort・非致命。

---

## テスト環境（前提）

- デスクトップ **Chrome または Edge**（File System Access API 対応）
- **localhost / 開発 URL**（File System Access API が有効なオリジン）
- MyBrain ログイン済み
- 設定：
  - **保存先 = obsidian-local**
  - **ローカル Obsidian Vault フォルダ接続済み**
- Vault 内に `MyBrain/Memos/`（無ければ create-write 時に自動生成）

---

## トースト/メッセージ リファレンス（デスクトップ 3 コンポーネント）

DesktopMemos / DesktopConsult / DesktopTranscribe で使用する文言：

- create 成功：`Obsidianにも保存しました`
- update 成功：`Obsidian側のメモも更新しました`
- update 一致なし：`MyBrainは更新しました。Obsidian側の既存メモは見つからなかったため、追加作成はしていません。`
- 未接続：`Obsidianフォルダ未設定です。設定からVaultフォルダを選んでください。`
- 非対応：`このブラウザではObsidianフォルダ保存に対応していません。`
- 権限：`Obsidianフォルダの許可が必要です。設定から再接続してください。`
- create 失敗：`MyBrainには保存済みです。Obsidian保存のみ失敗しました。`
- update 失敗：`MyBrainは更新済みです。Obsidian側の更新のみ失敗しました。`

---

## メモ詳細ページ（`/memos/[id]`）のメッセージ方針

メモ詳細ページはトースト非搭載のため、方針が異なる：

- **表示するのは `permission-denied` と `error` のみ**（更新パス）。
- `skipped` / `unsupported` / `updated` / `not-found` は**無表示**（モバイルのノイズ回避）。
- create パス（別メモとして保存）は**全 status 無表示**。

---

## テストケース（15 件）

### 1. 新規メモ create-write

- **手順**：DesktopMemos で新規メモ作成（タイトル＋本文）→保存
- **MyBrain 期待**：メモが保存され一覧に表示
- **Obsidian 期待**：`MyBrain/Memos/<タイトル>.md` が 1 件生成、frontmatter に `id` / `source: mybrain`
- **メッセージ期待**：`保存しました`（保存先文言）→ `Obsidianにも保存しました`
- **合否**：☐ Pass ☐ Fail

### 2. タイトル重複 create-write

- **手順**：テスト 1 と同じタイトルでもう 1 件作成→保存
- **MyBrain 期待**：別メモとして保存（別 id）
- **Obsidian 期待**：既存を上書きせず `<タイトル>-2.md` が新規生成
- **メッセージ期待**：`Obsidianにも保存しました`
- **合否**：☐ Pass ☐ Fail

### 3. 既存メモの update 上書き

- **手順**：テスト 1 のメモを開いて本文編集→保存（DesktopMemos または詳細）
- **MyBrain 期待**：本文更新
- **Obsidian 期待**：**同一ファイル**の中身が更新、新規ファイルは増えない
- **メッセージ期待**：DesktopMemos＝`Obsidian側のメモも更新しました`／詳細＝無表示
- **合否**：☐ Pass ☐ Fail

### 4. タイトル変更後の update

- **手順**：テスト 1 のメモのタイトルを変更→保存
- **MyBrain 期待**：タイトル更新
- **Obsidian 期待**：**ファイル名は元のまま**・中身（frontmatter title 含む）のみ更新、リネームされない
- **メッセージ期待**：DesktopMemos＝`Obsidian側のメモも更新しました`／詳細＝無表示
- **合否**：☐ Pass ☐ Fail

### 5. 一致 Obsidian ファイルが無いメモの update

- **手順**：Vault 接続前に作成したメモ（または Vault からその MD を削除）を更新保存
- **MyBrain 期待**：更新成功
- **Obsidian 期待**：**新規ファイルは作られない**
- **メッセージ期待**：DesktopMemos＝`MyBrainは更新しました。Obsidian側の既存メモは見つからなかったため、追加作成はしていません。`／詳細＝無表示
- **合否**：☐ Pass ☐ Fail

### 6. DesktopMemos AI 追記 update（`appendAi`）

- **手順**：DesktopMemos でメモ選択→AI 実行→「メモに追記」
- **MyBrain 期待**：元メモに AI 結果が追記更新
- **Obsidian 期待**：一致ファイルの中身が上書き更新（無ければ作成せず）
- **メッセージ期待**：`元メモに追記しました` →（一致時）`Obsidian側のメモも更新しました`
- **合否**：☐ Pass ☐ Fail

### 7. DesktopTranscribe AI 追記 update（`appendToOriginal`）

- **手順**：DesktopTranscribe で文字起こし保存→AI 要約/整理→「元メモに追記」
- **MyBrain 期待**：元メモに追記更新
- **Obsidian 期待**：一致ファイルの中身が上書き更新（無ければ作成せず）
- **メッセージ期待**：`元メモに追記しました` →（一致時）`Obsidian側のメモも更新しました`
- **合否**：☐ Pass ☐ Fail

### 8. メモ詳細 編集保存 update（`handleSave`）

- **手順**：`/memos/[id]` を開き編集→保存
- **MyBrain 期待**：更新成功、編集モード解除
- **Obsidian 期待**：一致ファイルの中身のみ上書き
- **メッセージ期待**：成功・not-found・unsupported は**無表示**。permission-denied / error のみ赤テキスト表示
- **合否**：☐ Pass ☐ Fail

### 9. メモ詳細 AI 追記 update（`appendAiToMemo`）

- **手順**：`/memos/[id]` で AI 実行→「元メモに追記」
- **MyBrain 期待**：追記更新
- **Obsidian 期待**：一致ファイルの中身が上書き更新
- **メッセージ期待**：成功系は**無表示**。permission-denied / error のみ赤警告ボックス表示
- **合否**：☐ Pass ☐ Fail

### 10. メモ詳細 AI を別メモ保存 create-write（`saveAiAsSeparate`）

- **手順**：`/memos/[id]` で AI 実行→「別メモとして保存」
- **MyBrain 期待**：新規メモ作成→新メモページへ遷移
- **Obsidian 期待**：新規 `.md` が 1 件生成（遷移**前**に書き込み試行完了）
- **メッセージ期待**：**全 status 無表示**（このページの create パス方針）
- **合否**：☐ Pass ☐ Fail

### 11. 権限拒否（permission-denied）

- **手順**：Vault フォルダ権限を解除/失効させた状態で保存・更新
- **MyBrain 期待**：保存/更新は**成功**
- **Obsidian 期待**：書き込みなし（権限自動要求もしない）
- **メッセージ期待**：`Obsidianフォルダの許可が必要です。設定から再接続してください。`（詳細ページでも表示）
- **合否**：☐ Pass ☐ Fail

### 12. 保存先 mybrain（skipped）

- **手順**：設定で保存先を **mybrain** に戻し保存・更新
- **MyBrain 期待**：従来どおり保存/更新
- **Obsidian 期待**：書き込み一切なし
- **メッセージ期待**：Obsidian 系トーストは**出ない**（従来挙動のみ）
- **合否**：☐ Pass ☐ Fail

### 13. モバイル/非対応（unsupported）

- **手順**：モバイルブラウザ（または File System Access 非対応環境）で保存・更新
- **MyBrain 期待**：保存/更新成功
- **Obsidian 期待**：書き込み不可・無害
- **メッセージ期待**：メモ詳細は**無表示**（モバイルノイズ回避）／デスクトップコンポーネントのみ非対応トースト
- **合否**：☐ Pass ☐ Fail

### 14. 削除（delete）挙動不変

- **手順**：メモを削除（DesktopMemos・詳細ページ）
- **MyBrain 期待**：削除成功・一覧から消える
- **Obsidian 期待**：**Vault ファイルは削除されない**（Obsidian 削除は非対応・スコープ外）
- **メッセージ期待**：従来の削除メッセージのみ、Obsidian 系トーストなし
- **合否**：☐ Pass ☐ Fail

### 15. Google Drive エクスポート不変

- **手順**：DesktopMemos で選択メモを Google Drive へエクスポート
- **MyBrain 期待**：従来どおり動作
- **Obsidian 期待**：ローカル Vault 挙動に影響なし（独立パス）
- **メッセージ期待**：従来の Google Drive メッセージのみ
- **合否**：☐ Pass ☐ Fail

---

## スコープ外（このテストの対象外）

以下は本フェーズ群の Obsidian ローカル保存の対象外であり、挙動を変更していない：

- **削除の Obsidian 反映**（Vault ファイルの削除）
- **Google Drive 連携**（独立パス・未変更）
- **モバイルからの直接ローカル Vault 書き込み**（File System Access 非対応のため無効）
- **Obsidian → MyBrain インポート**（未実装）
- **双方向同期（bidirectional sync）**（未実装）

> 既知のトレードオフ：update-overwrite は MyBrain を source of truth として既存ファイルを上書きするため、
> Obsidian 側でユーザーが直接編集した内容は、次回の MyBrain 更新で上書きされうる。検出・マージは現スコープ外。

---

## 実機テスト結果

- **テスト日**：2026-07-01
- **環境**：
  - デスクトップブラウザ
  - 保存先 = Obsidian local
  - Vault フォルダ接続済み

### 実施フロー（確認済み）

- 設定 > データ管理で **Obsidian local を選択できた**。
- **Obsidian Vault フォルダ選択 UI が表示された**。
- **Vault フォルダの接続に成功した**。
- 新規メモ作成で `MyBrain/Memos/` 配下に **Markdown ファイルが1件生成された**。
- メモ更新で**同じ Markdown ファイルが更新された**（新規ファイルは増えなかった）。
- 更新時に **`-2.md` などの重複ファイルは作られなかった**。
- メモの**タイトル変更で追加の Markdown ファイルは作られず**、既存のファイル名が維持された。
- **AI 追記で同じ Markdown ファイルが更新された**（`-2.md` の重複は作られなかった）。

### 結果サマリ

| テスト | 結果 |
|---|---|
| 新規作成 | ✅ Pass |
| 本文更新 | ✅ Pass |
| タイトル変更 | ✅ Pass |
| AI 追記 | ✅ Pass |

### 備考

- MyBrain/Supabase が引き続き source of truth。
- Obsidian ローカル保存は付加的（best-effort・非致命）。
- 更新は frontmatter の `id` / `source` で一致した既存 Markdown ファイルを上書きする。
- タイトル変更では Obsidian のファイル名をリネームしない。
- 更新テストで重複ファイル（`-2.md`）は生成されなかった。
