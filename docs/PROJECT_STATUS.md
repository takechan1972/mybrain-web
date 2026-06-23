# PROJECT_STATUS — MyBrain WEB

> 実装状況の簡易メモ。完了した機能を簡潔に記録する。

## 管理コンソール

### チャットボットFAQ管理（chatbot_knowledge）— ✅ 完了（2026-06-23）

- 管理画面に「チャットボットFAQ管理」を実装。`chatbot_knowledge` から Q&A を一覧表示（category / question / answer / is_public / created_at）。未公開は「未公開」と表示。
- 公開/非公開トグルを実装（管理者の RLS update により反映）。
- 管理者ログインでライブ動作を確認済み（一覧表示・公開トグル・エラーなし）。
- コミット `b1f8cbd` を push 済み。
