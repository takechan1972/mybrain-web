# AIプラ Web版 再構成 設計書（ドラフト）

> 本フォルダ `AI_iphone_web` は現行 `AI_iphone`（Expoアプリ版）の複製です。
> **現行 `AI_iphone` は一切変更しません。** Web版の変更はすべて本フォルダ内で行います。
> 実装は本設計書の承認後に着手します。

---

## 1. 複製手順（実施済み・非破壊）

```powershell
# node_modules / .git / .expo / dist を除外して複製（原本は無変更）
robocopy "C:\Users\owner\Desktop\AI_iphone" "C:\Users\owner\Desktop\AI_iphone_web" /E /XD node_modules .git .expo dist
```

- 原本に戻したい場合：本フォルダを削除すれば現行アプリ版がそのまま残ります。
- 原本は Git 管理下（`.git` あり）なので、原本側の履歴も保全されています。

---

## 2. 現行構成（Expoアプリ版）

- フレームワーク：Expo SDK 56 / expo-router / React Native / react-native-web
- 画面：`src/app/`（index=ホーム, memos, reservations, consult=AI相談, chat=AIチャット, settings）
- データ：`src/store/app-data.tsx`（React Context + AsyncStorage、端末ローカル保存）
- 音声：`src/services/speech/`（Web Speech API / expo-speech-recognition）
- AI：`src/services/ai-client.ts`（日時/タイトル/メモ抽出・チャットプロンプト・Ollama対応）
- OCR：`src/services/ocr*.ts`（tesseract.js / Web）

---

## 3. ファイル分類（Web版での扱い）

### A. 再利用（ロジック・ほぼ移植可。RN依存だけ除去）
| 現行 | Web版での配置 |
|---|---|
| `services/ai-client.ts` の `parseScheduleDateTime` / `extractScheduleTitle` / `extractMemoFields` | `lib/parse/schedule.ts`, `lib/parse/memo-fields.ts`（純TS化） |
| `utils/auto-tags.ts`（generateAutoTags/mergeTags/suggestTags） | `lib/tags.ts` |
| `utils/tag-style.ts` | `lib/tag-style.ts` |
| `services/voice-input.ts`（splitTitleBody） | `lib/parse/voice-input.ts` |
| `services/ocr.web.ts`（tesseract.js） | `lib/ocr.ts` |
| `services/usage-limits.ts`（プラン上限ロジック） | `lib/usage-limits.ts`（保存先は Supabase へ） |
| `services/speech/web-speech.ts`（Web Speech API） | `hooks/useSpeech.ts` に移植 |

### B. 作り直し（RN UI → React/Next + Tailwind）
- `src/app/*.tsx`（全画面）→ Next.js App Router の `app/*/page.tsx`
- `components/*`（ThemedText/ThemedView/datetime-picker/voice-recorder/app-tabs）→ Web用コンポーネント
- `store/app-data.tsx`（Context+AsyncStorage）→ **Supabase データ層**（ユーザー別）＋ SWR/React Query

### C. 削除/不要（Expo・ネイティブ専用）
- `app.json` / `eas.json` / `expo-env.d.ts` / expo-router / NativeTabs
- `services/speech/native-speech*.ts`（expo-speech-recognition）
- `services/image-attach.ts`（expo-image-picker）→ `<input type="file" accept="image/*" capture>`
- `services/recording-cleanup.ts` / `components/voice-recorder.tsx`（expo-audio）
- `services/secure-api-keys.ts`（SecureStore）→ **APIキーはサーバ側のみ**
- `eas.json` 等ビルド設定、`scripts/`（必要なら後で移植）

### D. 新規（Web版で追加）
- Next.js（App Router, TypeScript, Tailwind）プロジェクト
- 認証（Supabase Auth：ログイン/サインアップ）
- `app/api/ai/route.ts`：**サーバ側でAI呼び出し（APIキー秘匿）**
- Supabase スキーマ（RLSでユーザー別アクセス制御）
- PWA 対応（将来：next-pwa / manifest）

---

## 4. Next.js 構成案

```
AI_iphone_web/            # 将来 ai-plura-web へリネーム可
  app/
    layout.tsx            # 全体レイアウト（モバイル最優先・下タブ）
    page.tsx              # ホーム（メモ/予定/AI相談/AIチャットの4ボタン）
    login/page.tsx        # ログイン（Supabase Auth）
    memos/page.tsx        # メモ管理（音声/手入力/画像/OCR）
    reservations/page.tsx # 予定管理（音声/日時抽出）
    consult/page.tsx      # AI相談（メモ・予定を参照）
    chat/page.tsx         # AIチャット（参照なし）
    api/
      ai/route.ts         # AI呼び出し（サーバ側・キー秘匿）
  components/
    ui/                   # Button, Card, Modal, Chip など（Tailwind）
    VoiceInput.tsx        # Web Speech API（無音自動再開つき）
    DateTimePicker.tsx
    ImageAttach.tsx       # ファイル選択/カメラ
    BottomTabs.tsx
  lib/
    supabase/client.ts    # ブラウザ用クライアント
    supabase/server.ts    # サーバ用（RLS / セッション）
    parse/schedule.ts     # 日時・タイトル抽出（移植）
    parse/memo-fields.ts  # メモのタイトル/内容抽出（移植）
    tags.ts               # 自動タグ（移植）
    ocr.ts                # tesseract.js
    usage-limits.ts
  hooks/
    useSpeech.ts          # 音声認識（メモ・予定で共通利用）
    useMemos.ts / useReservations.ts / useChat.ts  # Supabase + SWR
  types/
  middleware.ts           # 未ログインはログインへ誘導
  next.config.js
  tailwind.config.js
  .env.local              # SUPABASE_URL / ANON_KEY（公開可） + AIキー（サーバ専用）
```

### Supabase テーブル（RLS：`user_id = auth.uid()`）
- `profiles(id, plan, created_at)`
- `memos(id, user_id, title, body, tags text[], summary, ocr_text, images jsonb, date_at, created_at, updated_at)`
- `reservations(id, user_id, title, content, schedule_at timestamptz, notification_enabled bool, created_at, updated_at)`
- `chat_messages(id, user_id, kind text /* 'consult' | 'chat' */, role text, text, ref_titles text[], created_at)`

### AI相談のデータ参照フロー（キー秘匿）
1. クライアント → `POST /api/ai`（質問文・kind）
2. サーバ：Supabase からそのユーザーの memos / reservations を取得（kind=consult のときのみ）
3. サーバ：プロンプト構築 → AIプロバイダ（OpenAI/Anthropic/Gemini/Ollama）へ**サーバ側のキー**で送信
4. サーバ → クライアントへ回答テキスト（APIキーはフロントに出ない）
- AIチャット（kind=chat）はメモ・予定を参照しない（現行仕様を踏襲）

---

## 5. 実装フェーズ（承認後）
- **P1**：Next.js雛形＋Tailwind＋Supabase Auth（ログイン）＋メモCRUD（モバイルUI）
- **P2**：予定管理＋音声入力（Web Speech・日時/タイトル抽出移植）
- **P3**：AI相談 / AIチャット（`/api/ai` 経由・メモ/予定参照）
- **P4**：画像添付＋OCR、利用上限、PWA、（将来）有料プラン/サブスク

---

## 6. 重要な前提（厳守）
- スマホ表示最優先（モバイルファースト Tailwind）
- ログイン必須・Supabaseでユーザー別保存（RLS）
- **APIキーはフロントに出さない**（`/api/ai` のサーバ側のみ）
- 将来：有料プラン・サブスク・PWA に拡張できる構成
- 現行 `AI_iphone` は不変・いつでも復帰可能
