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
