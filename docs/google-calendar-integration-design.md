# Google カレンダー連携 ― 設計メモ

> **ステータス：設計のみ（未実装）。** このドキュメントは実装前の方針整理であり、アプリコード・OAuth 変更・Calendar API 呼び出しは含まない。
> 関連：`docs/google-drive-markdown-export-design.md`（Drive 書き出し・OAuth 同意フロー）／`lib/reservations.ts`／`lib/types.ts`（Reservation）。

---

## 機能名

**Google カレンダー連携**（Google Calendar Integration）

MyBrain の予約／予定（Reservation）を、ユーザーの Google カレンダーにイベントとして書き出す。

---

## 目的

- MyBrain で管理する予定を、普段使いの **Google カレンダーにも反映**して、通知・他端末・他アプリ（スマホのカレンダー等）から見られるようにする。
- 「ハブアプリ」構想の一部：メモ＝Obsidian/Drive、予定＝Google カレンダー、というように **データを利用者のエコシステムに橋渡し**する。
- Supabase は引き続き source of truth。カレンダーは**一方向の書き出し先**。

## なぜ Google カレンダーが MyBrain に有用か

- 予定はメモと違い「時間」が主役で、リマインダー・端末通知・共有はカレンダーの得意分野。
- MyBrain に予定を入れるだけで Google カレンダーにも入れば、二重入力が要らない。
- スマホ標準カレンダーや他サービスと自然に連携できる。

## Google Drive 書き出しとの違い

| 観点 | Google Drive（実装済み） | Google カレンダー |
|---|---|---|
| 対象データ | メモ（Markdown ファイル） | 予定（イベント） |
| API | Drive REST（files） | Calendar REST（events） |
| 保存単位 | ファイル | イベント（開始/終了/終日を持つ） |
| 既存判定 | フォルダ内のファイル名検索 | 保存した event ID で参照 |
| スコープ | `drive.file` | `calendar.events`（候補） |
| 再編集 | 同名は連番で新規 | 同じ予定は event ID で更新/削除しうる |

OAuth 基盤（GIS トークンフロー・短命アクセストークン・メモリのみ）は **Drive と同じ考え方を踏襲**し、スコープだけ機能ごとに最小化する。

---

## MVP スコープ

1. ユーザーが Google アカウントで連携（OAuth 同意・Calendar スコープ）する導線。
2. MyBrain の1件の予定を、**ユーザーの主カレンダー（primary）にイベントとして作成**する。
3. 作成前に**確認ダイアログ**（予定タイトル・日時を明示）。
4. 作成したイベントの **event ID を MyBrain 側に控える**（あれば更新・削除に使う。保存場所は下記方針）。
5. 既に紐づく event ID があれば、更新／削除をイベントに反映できる（任意・段階導入）。
6. デスクトップ・モバイル双方で利用可能（Drive と同じ GIS フロー）。

## スコープ外（このフェーズでやらないこと）

- 双方向同期（Google カレンダーの変更を MyBrain に取り込む）。
- 自動・定期同期（バックグラウンド）。
- 繰り返し予定（RRULE）、ゲスト招待、会議リンク（Meet）、添付。
- 複数カレンダーの選択（MVP は primary 固定）。
- Google Drive / Sheets 連携（別機能）。
- Supabase スキーマ／保存挙動の変更。

---

## 必要な Google Calendar API

- **Google Calendar API**（REST v3）。
  - イベント作成：`POST /calendar/v3/calendars/{calendarId}/events`
  - イベント更新：`PUT/PATCH /calendar/v3/calendars/{calendarId}/events/{eventId}`
  - イベント削除：`DELETE /calendar/v3/calendars/{calendarId}/events/{eventId}`
  - `calendarId` は MVP では `primary`。

## 必要な OAuth スコープ候補

- `https://www.googleapis.com/auth/calendar.events` … イベントの読み書き（カレンダー設定自体は触らない）。
- （広い）`https://www.googleapis.com/auth/calendar` … カレンダー全体。**MVP では使わない**。
- 参考：作成のみに絞れる `calendar.events.owned` 等もあるが、更新/削除も視野に入れるなら `calendar.events` が扱いやすい。

## 推奨する最小スコープ

- **`https://www.googleapis.com/auth/calendar.events`** を採用。
  - 作成だけでなく、将来の更新・削除（event ID 紐づけ）まで同一スコープでまかなえる。
  - Drive の `drive.file` と同様、必要最小限に絞る。Drive と Calendar の**スコープは混ぜない**。

---

## MyBrain の予定 → Google カレンダー イベントの対応

MyBrain の `Reservation`（`lib/types.ts`）と Calendar イベントの対応：

| Reservation | 型 | Google Calendar event | 備考 |
|---|---|---|---|
| `title` | string | `summary` | 空なら「無題の予定」等のフォールバック |
| `content` | string | `description` | そのまま本文へ |
| `startAt` | epoch ms \| null | `start.dateTime` / `start.date` | 終日なら date、時間ありなら dateTime |
| `endAt` | epoch ms \| null | `end.dateTime` / `end.date` | 未設定時の既定は下記 |
| `allDay` | boolean | start/end を date or dateTime で切替 | 終日判定のキー |
| `scheduleAt` | epoch ms \| null | （`startAt` 未設定時のフォールバック） | 旧互換。原則 `startAt` と同値 |
| `id` | string | （`extendedProperties.private.mybrainId` 等に保持可） | 任意。MyBrain 予定との対応付け用 |
| 連携で得る `event.id` | string | — | MyBrain 側に控える（更新/削除用） |

### title / description / start / end / all-day の扱い

- **title**：`summary` に `title`（空ならフォールバック文言）。
- **description**：`description` に `content`。
- **start/end（時間あり）**：`start.dateTime` / `end.dateTime` に RFC3339（オフセット付き）。
- **start/end（終日）**：`start.date` / `end.date` に `YYYY-MM-DD`。
- **end が無い場合の既定**：
  - 時間あり：開始から一定（例 60 分）後を既定終了にする、または開始と同時刻で最小枠。
  - 終日：Google の終日は **end.date が翌日（排他的）** になる点に注意（1日予定なら end=start+1日）。

### タイムゾーンの扱い

- MyBrain は日時を **epoch ms** で保持。Calendar の `dateTime` には**オフセット付き RFC3339**（または `timeZone` フィールド）で渡す。
- MVP は**端末のローカルタイムゾーン**を基準にする。必要なら `start.timeZone` / `end.timeZone` に IANA 名（例 `Asia/Tokyo`）を併記。
- 終日（`date`）はタイムゾーン非依存の暦日として扱う。

### 終日イベントの扱い

- `allDay === true` → `start.date` / `end.date`（`YYYY-MM-DD`）。`end.date` は**排他的終了日**（1日なら開始＋1日）。
- `allDay === false` → `start.dateTime` / `end.dateTime`。

---

## 作成（create event）フロー

```
予定を「カレンダーへ書き出し」（ユーザー操作起点）
  → アクセストークン取得（GIS, calendar.events）
  → 確認ダイアログ（タイトル・日時を表示）
  → events.insert（primary）
  → 返ってきた event.id を MyBrain 側に控える（任意）
  → 成功/失敗をトーストで通知
```

## 更新（update event）フロー

```
紐づく event.id がある予定を更新
  → トークン取得
  → 確認ダイアログ
  → events.patch/update（primary, eventId）
  → 失敗時は通知（event が無ければ作成にフォールバックを検討）
```

## 削除（delete event）フロー

```
紐づく event.id がある予定を削除/解除
  → トークン取得
  → 確認ダイアログ
  → events.delete（primary, eventId）
  → MyBrain 側の event ID 参照をクリア
  → 404（既に無い）は成功扱い
```

## 競合・重複の扱い

- **重複作成の回避**：MyBrain 予定に **event ID を1つ持たせ**、既にあれば「新規作成」ではなく更新にする。
- event ID を保持しない MVP 段階では、同じ予定を2回書き出すと**カレンダーに2件できる**点をユーザーに明示（確認ダイアログで注意）。
- Google 側で先に削除された場合：更新は 404 → 作成にフォールバック or 通知。

---

## source of truth（正本）

- **MyBrain（Supabase）が source of truth。** Google カレンダーは**反映先（コピー）**。
- カレンダー側の編集は MVP では MyBrain に戻さない（双方向は将来）。

## 一方向 vs 双方向

- **MVP は一方向（MyBrain → Google カレンダー）**。
- 双方向（カレンダーの変更取り込み）はスコープ外（将来注記）。

## ユーザー確認のルール

- すべての作成・更新・削除は**ユーザー操作（クリック）起点**。自動・定期実行はしない。
- 書き込み前に**必ず確認ダイアログ**（対象予定のタイトル・日時を表示）。
- 黙ってイベントを作らない／消さない。

---

## トークンの扱い

- Drive と同じ **GIS トークンフロー**。アクセストークンは**短命・メモリのみ**、操作のたびにユーザー操作起点で取得。
- **リフレッシュトークンは要求も保存もしない。**
- localStorage / sessionStorage / IndexedDB / Cookie / Supabase に**トークンを保存しない**。

### 保存するもの

- 連携状態の最小フラグ（任意）。
- 予定に紐づく **Google Calendar event ID**（更新・削除のため。保存するなら Supabase の予定行 or ローカル参照。**保存方針は実装時に確定**し、スキーマ変更が必要なら別途設計）。

### 保存しないもの

- アクセストークン／リフレッシュトークン。
- クライアントシークレット。
- カレンダーの全イベントや個人情報の不要な複製。

> 注：event ID を Supabase に持たせる場合は**スキーマ追加**が必要なため、本 MVP の「スキーマ変更しない」方針と両立するなら、まずは **event ID をローカル（または extendedProperties 経由の照合）**で扱う案も検討する。確定は実装フェーズ。

---

## エラーハンドリング方針

| 事象 | 対応 |
|---|---|
| 未連携／スコープ未同意 | 書き出し導線を無効化し、連携を案内 |
| OAuth 同意キャンセル | 何もしない（無音で終了） |
| トークン失効（401） | トークン破棄→ユーザー操作で再取得 |
| 日時不正（start/end 欠落・end<start） | 書き込み前にバリデーションし、わかりやすく通知 |
| API/ネットワークエラー | 失敗として通知（複数件なら件数集計、Drive と同方針） |
| レート制限（429） | 間隔を空ける／件数が多い場合は警告 |
| event が見つからない（更新/削除時 404） | 削除は成功扱い、更新は作成へフォールバック検討 |
| 想定外の例外 | 失敗トースト（既存文言に揃える） |

---

## デスクトップ・モバイルの挙動

- OAuth は GIS トークンフローで**デスクトップ・モバイル双方**で動く（Drive と同じ）。
- まずは予約画面／予約詳細に「Google カレンダーへ書き出し」の単一導線を想定。
- 一覧からの一括書き出しは段階導入（Drive のメモ一括と同様、件数確認・大量警告を流用）。

## Google Drive 連携との関係

- OAuth 基盤（GIS・短命トークン・メモリのみ・確認必須・一方向）は**共通の考え方**。
- ただし**スコープは別**（`drive.file` と `calendar.events` を混在させない）。
- 宛先非依存の共通部分（確認・トースト・件数集計）は再利用しうる。

## Google Sheets 連携との関係

- Sheets 連携（表形式エクスポート等）は**別機能・別スコープ**。
- 予定 → カレンダー、メモ → Drive、と**データ種別ごとに最小スコープ**で連携する方針。

---

## 将来の双方向同期について（注記のみ）

- 本フェーズおよびカレンダー連携は**一方向（MyBrain → Google カレンダー）**に限定。
- 双方向（カレンダーの編集・削除を MyBrain に取り込む）は、競合解決・更新時刻比較・削除伝播など別途設計が必要で、**現時点ではスコープ外**。
- 双方向に進む場合も、Supabase を source of truth とする前提を崩さない設計から検討する。

---

## このステップについて

- **本ステップはドキュメントのみ。** OAuth 変更・Calendar API 呼び出し・依存追加・UI 変更・Supabase 変更は行わない。
- 実装は別フェーズで、まず「Calendar 設定/接続状態の最小ヘルパー（UI 非接続）」→「イベント作成ヘルパー（UI 非接続）」→「予約画面への接続」と、Drive と同じ段階的な進め方を想定。
