# Obsidian Vault ローカルフォルダ直接書き出し ― 設計メモ

> **ステータス：設計のみ（未実装）。** このドキュメントは実装前の方針整理であり、アプリコードは含まない。
> 関連：`lib/markdown/export-memos-zip.ts`（`exportMemosAsZip`）／`lib/download/download-blob-file.ts`（`downloadBlobFile`）。
> 関連設計メモ：`lib/storage/obsidian-selection-ui-safety-strategy.ts`、`lib/storage/obsidian-clickable-checkbox-strategy.ts`。

---

## 機能名

**Obsidian Vault ローカルフォルダ直接書き出し**（Local Vault Direct Export）

選択したメモを、ユーザーが選んだローカルフォルダ（Obsidian Vault 配下など）へ、ZIP を介さずに `.md` ファイルとして直接書き出す。

---

## 目的

- 現状の書き出しは **ZIP ダウンロード**（`exportMemosAsZip` → `downloadBlobFile`）の一方向のみ。
- ZIP を解凍して Vault に置く手間をなくし、**選んだフォルダへ直接 `.md` を配置**できるようにする。
- 「ハブアプリ」構想（MyBrain が Obsidian 互換 Markdown を扱う）の第一歩として、ローカル Vault との橋渡しを用意する。
- Supabase は引き続き source of truth。Vault 書き出しは**コピーの一方向エクスポート**。

---

## MVP スコープ

1. デスクトップのメモ一覧（`components/DesktopMemos.tsx`）の選択モードに「フォルダへ書き出し」操作を追加。
2. `window.showDirectoryPicker()` でユーザーがフォルダを1回選ぶ。
3. 選択メモを既存の `createMemoMarkdownFile(memo)` で Markdown 化（生成ロジックは再利用・複製しない）。
4. 既定では選択フォルダ直下、もしくは `MyBrain/Memos/` サブフォルダに `.md` を作成。
5. **同名ファイルがある場合は上書きしない**（連番サフィックス or スキップ＋確認）。
6. 複数ファイル書き込み前に**件数を含む確認ダイアログ**を出す。
7. 結果（成功件数／スキップ件数／失敗件数）をトースト等で通知。
8. 非対応ブラウザでは操作を出さない／無効化し、**既存の ZIP 書き出しにフォールバック**。

---

## スコープ外（このフェーズでやらないこと）

- Google Drive 連携（別フェーズ）。
- 双方向同期（Vault → MyBrain の取り込み、競合解決）。
- 自動・定期書き出し（バックグラウンド同期）。
- モバイル（iOS/Android ブラウザ）での直接フォルダ書き出し。
- Vault 設定の永続保存（ハンドルの IndexedDB 保存）※MVP では毎回選択。後続で検討。
- Supabase スキーマ／保存挙動の変更。
- メモ入力 UI の変更。

---

## ブラウザ対応の考慮

- **File System Access API（`showDirectoryPicker`）は対応が限定的。**
  - 対応：Chromium 系デスクトップ（Chrome / Edge / Opera など）。
  - 非対応：Safari（デスクトップ／iOS）、Firefox、iOS/Android の主要ブラウザ全般。
- **機能検出必須**：`typeof window !== 'undefined' && 'showDirectoryPicker' in window` を確認してから UI を出す。
- 非対応時は直接書き出しの導線を隠し、**ZIP 書き出し（実装済み）を案内**する。
- セキュアコンテキスト（HTTPS または localhost）でのみ動作する点に注意。

---

## File System Access API 概要（このユースケースで使う範囲）

- `const dirHandle = await window.showDirectoryPicker()` … ディレクトリハンドルを取得（ユーザー操作起点でのみ呼べる）。
- `const sub = await dirHandle.getDirectoryHandle('Memos', { create: true })` … サブフォルダの取得／作成。
- `const exists = await dir.getFileHandle(name)` … 既存判定（無ければ例外）。**上書き回避の判定に使う**。
- `const fileHandle = await dir.getFileHandle(name, { create: true })` … ファイルハンドル取得／作成。
- `const w = await fileHandle.createWritable(); await w.write(content); await w.close()` … 書き込み。
- 権限：`dirHandle.queryPermission` / `requestPermission`（`{ mode: 'readwrite' }`）で読み書き許可を確認・要求。

---

## `showDirectoryPicker` 権限フロー

```
[フォルダへ書き出し] タップ（ユーザー操作起点）
   │
   ▼ window.showDirectoryPicker()  → OS のフォルダ選択ダイアログ
   │     （キャンセル時：AbortError → 何もしない）
   ▼ dirHandle 取得
   │
   ▼ queryPermission({ mode: 'readwrite' })
   │     'granted' → 続行
   │     'prompt'  → requestPermission({ mode: 'readwrite' }) で要求
   │     拒否      → 中止し、ZIP 書き出しを案内
   ▼ （MyBrain/Memos/ サブフォルダを create:true で確保）
   ▼ 件数つき確認ダイアログ → OK で書き込み開始
```

- ハンドルは MVP では保持しない（毎回選択）。後続で IndexedDB 永続化＋再許可フローを検討。

---

## フォルダ構造（案）

選択フォルダを Vault ルートとみなし、その下に配置：

```
<選択フォルダ>/
└─ MyBrain/
   └─ Memos/
      ├─ 買い物メモ.md
      ├─ 会議メモ.md
      └─ 無題のメモ.md
```

- パス／ファイル名は既存の `createMemoMarkdownFile`（`memo-folder.ts` の `MyBrain/Memos`、`memo-file-name.ts` のファイル名規則）に揃える。
- ZIP 書き出しと**同じ構造**にして、ZIP 経由でも直接でも結果が一致するようにする。

---

## 書き出しの挙動

1. 選択メモを `createMemoMarkdownFile` で `{ fileName, path, content }` 化。
2. `MyBrain/Memos/` を `getDirectoryHandle(..., { create: true })` で確保。
3. ファイルごとに：
   - 既存チェック（`getFileHandle(name)` の成否）。
   - 無ければ作成して書き込み。
   - あれば**上書きせず**、連番サフィックス（`名前-2.md`）で新規作成、またはスキップ（方針は実装時に確定。既定は連番で ZIP と整合）。
4. 進捗・結果（成功／スキップ／失敗の件数）を集計してトースト表示。
5. 失敗があっても処理は止めず、最後にまとめて報告。

---

## 安全ルール（必ず守る）

- **既存ファイルを黙って上書きしない**（連番回避 or スキップ＋通知）。
- **複数ファイルを書き込む前に、必ず件数つき確認**を出す。
- **Supabase を source of truth に保つ**（Vault はコピー先）。
- **一方向エクスポートのみ**（Vault からの読み込み・反映はしない）。
- ユーザー操作起点でのみフォルダ選択・書き込みを行う（自動実行しない）。
- 大量選択時は ZIP 書き出しと同様に時間がかかる旨を警告（しきい値は既存の 10 件に揃える）。

---

## デスクトップ限定であること

- File System Access API は Chromium 系デスクトップが前提。
- まずは `components/DesktopMemos.tsx` の選択モードにのみ導線を追加する。
- 非対応デスクトップブラウザ（Safari/Firefox）では導線を出さず ZIP にフォールバック。

---

## モバイルの制限

- iOS/Android の主要ブラウザは `showDirectoryPicker` 非対応。
- モバイル（`app/history` メモビュー）では**直接フォルダ書き出しを提供しない**。
- モバイルは引き続き **ZIP 書き出し（実装済み）** を使う。
- 将来、モバイルからの Vault 連携は Google Drive 等クラウド経由で検討（下記）。

---

## エラーハンドリング方針

| 事象 | 検出 | 対応 |
|---|---|---|
| 非対応ブラウザ | `'showDirectoryPicker' in window` が false | 導線を隠す／ZIP を案内 |
| ユーザーがフォルダ選択をキャンセル | `AbortError` | 何もしない（無音で終了） |
| 読み書き許可が得られない | `queryPermission`/`requestPermission` が granted 以外 | 中止し、ZIP を案内 |
| 個別ファイルの書き込み失敗 | `createWritable`/`write` の例外 | その1件を失敗計上し継続、最後に件数報告 |
| 既存ファイル衝突 | `getFileHandle(name)` が成功（存在） | 上書きせず連番 or スキップ |
| 想定外の例外 | try/catch 全体 | 失敗トースト（既存文言に揃える） |

---

## フォルダハンドルの永続化（IndexedDB）― 設計

> **ステータス：設計のみ（未実装）。** 現状は書き出しのたびに `showDirectoryPicker()` でフォルダを選び直している。

### なぜ永続化が有用か

- 現状は毎回フォルダ選択ダイアログが出るため、繰り返し書き出すユーザーには手間。
- 一度選んだ Vault フォルダを覚えておけば、次回以降は**確認 → 書き込み**だけで済む。
- 「ハブアプリ」として日常的に Vault へ書き出す体験に近づく。

### なぜ localStorage は不適切か

- `FileSystemDirectoryHandle` は**構造化クローン可能なオブジェクト**であり、文字列ではない。
- localStorage は**文字列しか保存できない**ため、ハンドルをそのまま保存できない（`JSON.stringify` してもフォルダ参照は復元できない）。
- パスを文字列で保存しても、File System Access API は**パス文字列から再アクセスできない**（ハンドル経由のみ）。

### なぜ IndexedDB が有力か

- IndexedDB は**構造化クローンでオブジェクトを保存**でき、`FileSystemDirectoryHandle` をそのまま `put` できる。
- 再訪時に `get` でハンドルを取り出し、**権限を再確認**してから使える。
- 仕様・主要実装（Chromium）でハンドルの IndexedDB 保存が想定されている。

### 保存するもの / 保存しないもの

- **保存する**：選択された Vault ルートの `FileSystemDirectoryHandle` 1件（＋任意で表示用の `name`、最終利用時刻）。
- **保存しない**：
  - メモ本文・Markdown・ファイルの中身（Supabase が source of truth。Vault はコピー先）。
  - 絶対パスやユーザーのファイルシステム構造（ハンドル以外の位置情報は持たない）。
  - 認証情報・トークンの類（ローカル FS には不要）。

### 権限の再確認フロー

保存したハンドルは、**再訪時にそのまま書き込める保証はない**（ブラウザは権限を保持しないことがある）。使用前に必ず確認する：

```
保存済みハンドルを IndexedDB から取得
   │
   ▼ queryPermission({ mode: 'readwrite' })
   │     'granted' → そのまま使用
   │     'prompt'  → requestPermission({ mode: 'readwrite' }) で再要求（ユーザー操作起点）
   │                   granted → 使用 / それ以外 → 中止
   │     'denied'  → 使用不可（下記）
   ▼ 書き込みは従来どおり：件数確認 → writeMemosToDirectory
```

- `requestPermission` は**ユーザー操作（クリック）起点**でのみ呼べる。バックグラウンドでの自動再許可はしない。

### 権限が拒否された場合

- 保存ハンドルは使わず、**フォルダ未接続の状態に戻す**（または再選択を促す）。
- ユーザーには「フォルダへのアクセスが許可されていません。もう一度フォルダを選んでください」とやさしく案内（エラーで止めない）。
- いつでも `pickDirectory()` で選び直せる導線を残す。

### フォルダが移動／削除された場合

- 書き込み時に `NotFoundError` 等の例外が出うる。
- その場合は保存ハンドルを破棄し、**再選択を促す**。処理は安全に中断し、失敗として通知する。
- 既存の「失敗は件数＋タイトルで通知」方針に揃える。

### ユーザーに見える安全ルール

- **ユーザー操作なしに書き込まない**（永続化後も、書き込みは必ずクリック起点）。
- **複数ファイルを書き込む前に必ず確認**を出す（件数つき・`MyBrain/Memos/` 明記）。
- 大量選択時の警告（しきい値10）も従来どおり適用。
- 既存ファイルは黙って上書きしない（連番回避）。
- Supabase を source of truth に保つ／一方向エクスポートのみ。

### リセット / 接続解除の挙動

- 設定等に「フォルダの接続を解除」を用意する想定：IndexedDB の保存ハンドルを削除し、未接続状態に戻す。
- 解除後は次回書き出し時に再度フォルダ選択から始まる。
- 解除は**ローカルの参照を消すだけ**で、Vault 内の既存ファイルや Supabase のデータには一切触れない。

### デスクトップ限定のスコープ

- 永続化も File System Access API 前提のため **Chromium 系デスクトップのみ**。
- 接続・再許可の導線は `components/DesktopMemos.tsx`（または設定画面）にのみ追加する。

### モバイルは ZIP にフォールバック

- モバイルは `showDirectoryPicker` 非対応のため、**永続化対象外**。
- モバイルは引き続き **ZIP 書き出し（実装済み）** を使う。

### MVP スコープ（永続化）

1. IndexedDB に Vault ルートのハンドル1件を保存／取得／削除する小さなヘルパー（UI 非接続）。
2. 使用前に `queryPermission` →（必要なら）`requestPermission` を通す再許可ヘルパー。
3. デスクトップ書き出し時：保存ハンドルがあり権限 granted なら選択を省略、無ければ従来どおり `pickDirectory()`。
4. 接続解除（保存ハンドル削除）の導線。
5. いずれも上記の安全ルールを維持。

### スコープ外（永続化フェーズ）

- 複数 Vault の保存・切替（MVP は1件のみ）。
- 自動・定期書き出し（バックグラウンド同期）。
- Google Drive のトークン永続化（別フェーズ）。
- 双方向同期。

---

## 将来の Google Drive との関係

- Vault 書き出しのコア（Markdown 化・重複名回避・件数確認・安全ルール）は **書き出し先に依存しない共通部分**として再利用する。
- 書き出し先（ローカル FS / Google Drive）を**アダプタとして差し替え可能**な形に寄せる：
  - ローカル：File System Access API。
  - Drive：OAuth ＋ Drive API（別フェーズ）。
- `exportMemosAsZip` / `createMemoMarkdownFile` と同じく、宛先非依存のロジックは `lib/` 配下に集約する方針。

---

## 将来の双方向同期について（注記のみ）

- 本フェーズおよび Vault 直接書き出しは**一方向（MyBrain → Vault）**に限定。
- 双方向同期（Vault の編集を MyBrain に取り込む）は、競合解決・更新時刻比較・削除の扱いなど別途設計が必要で、**現時点ではスコープ外**。
- 双方向に進む場合も、Supabase を source of truth とする前提を崩さない設計から検討する。
