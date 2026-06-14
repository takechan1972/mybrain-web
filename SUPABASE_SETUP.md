# Supabase 実接続 手順書（AIプラ Web版 / AI_iphone_web）

> 対象は複製フォルダ `AI_iphone_web` のみ。現行 `AI_iphone` は触りません。
> コード変更は不要。以下を上から順に実施してください。

---

## 1. Supabaseプロジェクト作成後の操作

### (A) URL と anon key の取得
1. https://supabase.com にログイン →「New project」で作成（リージョンは Tokyo 推奨）
2. 左メニュー **⚙ Project Settings → API**
3. ここに表示される値：
   - **Project URL** … `NEXT_PUBLIC_SUPABASE_URL` に使用（例：`https://abcdxyz.supabase.co`）
   - **Project API keys → `anon` `public`** … `NEXT_PUBLIC_SUPABASE_ANON_KEY` に使用
   - **Project API keys → `service_role` `secret`** … `SUPABASE_SERVICE_ROLE_KEY`（**サーバ専用・絶対に公開しない**。現状コードでは未使用）

### (B) テーブル作成（schema.sql の実行場所）
1. 左メニュー **SQL Editor** →「New query」
2. `AI_iphone_web/supabase/schema.sql` の中身を**全文コピペ**
3. 右下 **Run**（成功で profiles / memos / reservations と RLS ポリシーが作成される）
4. 左メニュー **Table Editor** で 3テーブルが出来ているか確認

### (C) メール確認OFF（テスト中の即ログイン用）
1. 左メニュー **Authentication → Sign In / Providers**（または **Providers → Email**）
2. **Email** プロバイダを開く
3. **「Confirm email」** のトグルを **OFF**（保存）
   - これで新規登録後すぐログインできます（本番では後でONに戻す）

### (D) .env.local への貼り付け
- `AI_iphone_web/.env.local` を開き、(A)の値を貼り付け → 保存 → **dev サーバを再起動**

---

## 2. .env.local 設定例

```
# 公開してよい鍵（ブラウザで使用）
NEXT_PUBLIC_SUPABASE_URL=https://あなたのID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi... (anon public キーをそのまま)

# サーバ専用（絶対にフロントに出さない／今はまだ未使用でも貼ってOK）
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi... (service_role secret キー)
```

- `NEXT_PUBLIC_` が付くものだけブラウザに渡ります（anon は公開前提なので問題なし）。
- `SUPABASE_SERVICE_ROLE_KEY` は `NEXT_PUBLIC_` を**付けない**（付けると漏洩します）。
- 値の前後に空白・引用符は不要。1行に1項目。
- **編集後は必ず `npm run dev` を再起動**（env はサーバ起動時に読み込まれます）。

---

## 3. 実接続後の確認手順（順番に）

```powershell
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
cd "C:\Users\owner\Desktop\AI_iphone_web"
npm run dev
```

1. ブラウザで **http://localhost:3000/login** を開く
2. メール＋パスワード（6文字以上）を入力 → **新規登録**
3. 同じ情報で **ログイン** → 自動で `/memos` へ
4. **＋ 新規** → タイトル・本文・タグを入れて **保存**
5. **一覧** に表示されることを確認
6. メモを開いて **編集** → 保存 → 反映を確認
7. メモを開いて **削除** → 一覧から消えるのを確認
8. `/login` で **ログアウト**
9. 別のメール（例：test2@example.com）で **新規登録＋ログイン**
10. `/memos` が**空**＝最初のユーザーのメモが**見えない**ことを確認（RLS成功）

> スマホ表示の確認：Chrome の DevTools（F12）→ デバイスツールバー（Ctrl+Shift+M）でiPhoneサイズに。

---

## 4. エラー別チェックポイント

| 症状 | 原因と対処 |
|---|---|
| **Invalid API key** | `.env.local` の URL / anon key の貼り間違い、または余分な空白。Project Settings → API から再コピー。**dev再起動**を忘れずに |
| **relation "memos" does not exist** | `schema.sql` を実行していない／別プロジェクトで実行した。SQL Editor で再実行し、Table Editor に memos があるか確認 |
| **permission denied for table memos** | RLS は有効だがポリシー未作成、または未ログイン状態でアクセス。`schema.sql` を再実行（ポリシーが作られる）。ログイン済みか確認 |
| **RLS policy error / new row violates row-level security** | insert 時の user_id が auth.uid() と不一致。schema は `user_id default auth.uid()` 済み。ログインしているか、トークン切れでないか確認（再ログイン） |
| **ログイン後に /memos に入れない（/loginへ戻される）** | env 未設定 or 反映前。`.env.local` を設定し **dev再起動**。ブラウザを Ctrl+Shift+R で再読込 |
| **メール確認が必要でログインできない** | 手順(C)の **Confirm email を OFF**。既存ユーザーは Authentication → Users から該当ユーザーを「Confirm」する |
| **画面に「Supabase が未設定です」** | `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` が空。設定して再起動 |
| **メモが保存されない/一覧が空のまま** | ブラウザ DevTools の Console / Network でエラー確認。401→未ログイン、403→RLS、404→テーブル無し |

---

## 5. 初心者向けチェックリスト

### A. Supabase 側
- [ ] プロジェクトを作成した
- [ ] Project Settings → API で URL をコピーした
- [ ] 同画面で anon public キーをコピーした
- [ ] （任意）service_role secret キーをコピーした
- [ ] SQL Editor に `supabase/schema.sql` を貼って Run し、成功した
- [ ] Table Editor に profiles / memos / reservations がある
- [ ] Authentication → Email の「Confirm email」を OFF にした

### B. アプリ側（.env.local）
- [ ] `NEXT_PUBLIC_SUPABASE_URL=` に URL を貼った
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY=` に anon key を貼った
- [ ] `SUPABASE_SERVICE_ROLE_KEY=` は付けても付けなくてもOK（付ける場合 `NEXT_PUBLIC_` を付けない）
- [ ] ファイルを保存した
- [ ] `npm run dev` を**再起動**した

### C. 動作確認
- [ ] http://localhost:3000/login が開ける
- [ ] 新規登録できた
- [ ] ログインできた（/memos に入れた）
- [ ] メモを作成できた
- [ ] 一覧に表示された
- [ ] 編集できた
- [ ] 削除できた
- [ ] ログアウトできた
- [ ] 別ユーザーを登録できた
- [ ] 別ユーザーでは最初のメモが**見えない**（RLS OK）

すべて [x] になれば Supabase 実接続は成功です。
詰まったら「どのチェック項目で」「画面/コンソールにどのエラーが出たか」を教えてください。
