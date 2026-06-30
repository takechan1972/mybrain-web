# Obsidian ストレージフロー レビュー（Phase 2.0）

> 目的：現在の Obsidian 関連の書き出し／保存フローを棚卸しし、将来の「実 Obsidian 保存」に向けた**安全な実装順序**を確定する。
> 本書はレビュー／設計メモであり、アプリのコード挙動は変更しない。関連：`obsidian-vault-export-design.md` / `google-drive-markdown-export-design.md`。

最終更新：2026-06-30 / 対象コミット：`2b0beaf`（Improve Obsidian Markdown output safety）

---

## 1. 現状サマリ

- メモの **source of truth は常に MyBrain/Supabase**。保存先（storage target）を何に選んでも、実保存は Supabase に行く（保存挙動は不変）。
- Obsidian へは **「Markdown を取り出す」一方向の書き出し**のみ提供（コピー／ダウンロード／ZIP／ローカルVaultフォルダ／Google Drive）。
- **Obsidian からの取り込み（双方向同期）や、保存と同時の自動 Vault 書き込みは未実装**。
- 保存先切り替えのための **seam（接続点）は用意済み**だが、まだ実保存には繋いでいない。

---

## 2. 既存ファイル／関数（実装済み）

### 保存アダプタ層（seam・足場）
- `lib/storage/memo-store.ts` — `MemoStore` インターフェース、`getMemoStore()`（target で分岐するが**全 target が Supabase 実装にフォールバック**）、`supabaseMemoStore`。
- `lib/storage/obsidian-local-memo-store.ts` / `obsidian-gdrive-memo-store.ts` — プレースホルダ。`createMemo`/`updateMemo` で Supabase 保存後に `createMemoMarkdownFile` を生成するが**書き出しは TODO**（`void markdownFile`）。
- `lib/storage/memo-storage-target.ts` — localStorage 永続化（`loadMemoStorageTarget`/`saveMemoStorageTarget`）＋ `savedMessageForTarget()`（保存後メッセージ）。
- ⚠️ 注意：**現在の実保存は `lib/memos.ts` の `createMemo` を直接呼んでおり、`getMemoStore()` 経由ではない**。seam はまだ UI から使われていない。

### Markdown 変換（純関数・共通）
- `lib/markdown/memo-markdown.ts` — `memoToMarkdown`（frontmatter＋本文、画像ありの時のみ `images:N`）／`markdownToMemo`（取り込み用パーサ）／`markdownToMemoInput`。
- `lib/markdown/memo-file-name.ts` — `createMemoMarkdownFileName`（Windows禁止文字・制御文字除去／予約名 `_` 前置／80字上限／空→`untitled-memo`）。
- `lib/markdown/memo-folder.ts` — `OBSIDIAN_MEMO_FOLDER='MyBrain/Memos'` ほかパス組み立て。
- `lib/markdown/memo-markdown-file.ts` — `createMemoMarkdownFile`（fileName/path/content をまとめる。**全書き出し経路の単一ソース**）。

### 書き出し経路（UI 接続済み）
- **コピー／ダウンロード**：`app/memos/[id]/page.tsx` と `components/DesktopMemos.tsx`（`createMemoMarkdownFile` + `downloadMarkdownFile`）。
- **ZIP 一括**：`lib/markdown/export-memos-zip.ts`（`exportMemosAsZip`、in-memory dedup）。
- **ローカル Vault フォルダ**：`lib/fs/file-system-access.ts`（`writeMemosToDirectory`）＋ハンドル永続化 `vault-handle-store.ts`／権限 `vault-permission.ts`／解決 `vault-directory-resolver.ts`。
- **Google Drive**：`lib/google/google-drive-export.ts`（`exportMemosToGoogleDrive`）＋ folders/files/upload/oauth ヘルパー群。

### 設定 UI
- `app/settings/page.tsx` — 保存先セレクタ（3択）＋各オプション説明＋「現在は安全のためすべて MyBrain にも保存」注記。

---

## 3. 未実装（今後の対象）

1. **保存と同時の自動 Obsidian 書き込み**（保存→即 Vault/Drive へ .md 出力）。プレースホルダ adapter の TODO 部分。
2. **実保存経路の seam 化**：UI を `lib/memos.ts` 直呼びから `getMemoStore()` 経由へ寄せる（まだ未接続）。
3. **Obsidian → MyBrain の取り込み**（`markdownToMemo` は用意済みだが取り込み UI/フローは無し）。
4. **双方向同期・競合解決**（更新/削除の反映、ID 突合、削除伝播）。
5. **画像の実体エクスポート**（現在は件数メモのみ。data URI 本体は未出力）。

---

## 4. 将来の保存ルート比較

| ルート | 現状 | ユーザー操作 | 主なリスク |
|---|---|---|---|
| MyBrain のみ | ✅ 稼働中 | 不要 | なし（現行） |
| Obsidian Markdown コピー/DL | ✅ 稼働中 | 手動でコピー/DL | なし（一方向・手動） |
| ローカル Vault フォルダ書き出し | ✅ 稼働中 | フォルダ選択＋権限許可 | ブラウザ対応依存（File System Access） |
| Google Drive 書き出し | ✅ 稼働中 | Google 認可（毎回トークン） | API 有効化・検索遅延で稀に同名 |
| 保存と同時の自動 Obsidian 保存 | ❌ 未実装 | フォルダ/Drive の常時許可 | 二重書き込み・整合性・失敗時の扱い |
| Obsidian → MyBrain 取り込み | ❌ 未実装 | ファイル選択 | パース失敗・上書き・重複作成 |

---

## 5. 推奨実装順序（安全優先）

- **Phase A（安全・小）**：プレースホルダ adapter の TODO に「保存後に**任意で**ローカル Vault へ書き出す」導線を足す。ただし**既定 off**・失敗しても保存は成功扱い（MyBrain が真実）。実保存経路は変えない。
- **Phase B（要ユーザー操作）**：保存先 `obsidian-local` 選択かつ Vault 接続済みのときだけ、保存直後に1件を自動書き出し（`writeMemoToDirectory` 再利用）。トーストで成否表示、失敗は非致命。
- **Phase C（要ユーザー操作）**：同様に `obsidian-gdrive` で Drive 自動書き出し（`exportMemosToGoogleDrive` の単件版）。
- **Phase D（慎重・後回し）**：`getMemoStore()` を実保存経路に正式採用（UI を直呼びから seam 経由へ）。回帰範囲が広いので独立フェーズで。
- **Phase E（リスク高・待ち）**：双方向同期・取り込み・削除伝播・画像実体エクスポート。整合性設計が必要。

---

## 6. リスク区分

### 安全に今できる（safe now）
- 設計/ドキュメント整備、Markdown 出力の細かな品質改善（純関数なので回帰小）。
- プレースホルダ adapter 内の「生成のみ・書き出さない」TODO の前進（実書き込みを伴わない範囲）。

### 可能だがユーザー操作が必要（possible but needs user action）
- ローカル Vault 自動書き出し（フォルダ選択＋権限）。
- Google Drive 自動書き出し（Google 認可・API 有効化）。
- → いずれも **MyBrain 保存を真実とし、Obsidian 書き出しは付加・失敗は非致命**にすること。

### リスクが高い・待つべき（risky / should wait）
- 実保存経路の seam 全面移行（`lib/memos.ts` 直呼びの置換）。
- 双方向同期・削除伝播・競合解決・画像実体エクスポート。
- → Supabase スキーマ／RLS は変更しない前提を維持。ID 突合・冪等性の設計が固まるまで着手しない。

---

## 7. 不変条件（このロードマップ全体の前提）

- Supabase スキーマ・RLS は変更しない。
- MyBrain/Supabase を source of truth とし、Obsidian 書き出しは**付加機能**。
- Obsidian 書き出しの失敗で**メモ保存自体を失敗させない**。
- 外部依存の追加・大規模リファクタを避け、フェーズを小さく保つ。
