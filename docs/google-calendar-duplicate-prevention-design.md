# Google カレンダー イベントID保存・重複防止 ― 設計メモ

> **ステータス：設計のみ（未実装）。** 本ドキュメントは方針整理であり、アプリ挙動・UI・Supabase スキーマ・マイグレーションは一切変更しない。
> 関連：`docs/google-calendar-integration-design.md`（連携全体）／`lib/google/google-calendar-events.ts`（イベント作成）／`lib/google/google-calendar-export.ts`（書き出しオーケストレーション）／`lib/reservations.ts`（予定CRUD）。

---

## 背景・課題

現状、予定詳細から Google カレンダーへ1件書き出せる（実機確認済み）。ただし **重複防止が無い**：同じ予定を2回書き出すと、カレンダーに同じイベントが2件できる。
また、将来の **更新・削除** を反映するには「MyBrain の予定 ↔ 作成済みカレンダーイベント」の対応付けが必要。

---

## 現在の予定モデル（事実確認）

`Reservation`（`lib/types.ts`）と Supabase の `reservations` テーブル（`lib/reservations.ts` の `ReservationRow`）：

| 概念 | Reservation（TS） | reservations（DB列） | 備考 |
|---|---|---|---|
| ID | `id: string` | `id` | 主キー |
| 開始 | `startAt: number \| null` | `start_at` | epoch ms ↔ ISO |
| 終了 | `endAt: number \| null` | `end_at` | |
| 終日 | `allDay: boolean` | `all_day` | |
| 互換開始 | `scheduleAt: number \| null` | `schedule_at` | 旧カラム。原則 startAt と同値 |
| タイトル/内容 | `title` / `content` | `title` / `content` | |
| 通知 | `notificationEnabled` | `notification_enabled` | |
| 作成/更新 | `createdAt` / `updatedAt` | `created_at` / `updated_at` | |

- **外部ID（Google カレンダーの event ID）を保存する列は現状存在しない。**
- 一方、`createCalendarEvent`（`lib/google/google-calendar-events.ts`）は作成時に
  **`extendedProperties.private.mybrainReservationId = reservation.id`** を必ず埋めている。
  → これが「カレンダー側に MyBrain の予定IDを刻んでおく」既存の仕組みであり、Option C の土台になる。

---

## 重複防止のオプション

### Option A：`reservations` に `google_calendar_event_id` 列を追加

- 書き出し成功時に、返ってきた event ID を予定行に保存する。
- 次回書き出し時、その列が埋まっていれば「既に登録済み」と判断し、再作成しない（または更新に切替）。

| 観点 | 評価 |
|---|---|
| 安全性 | 中〜高（自前で確実に対応付け。ただし保存処理の整合が必要） |
| 複雑さ | 中（**Supabase スキーマ変更（列追加＋マイグレーション）**、保存ロジック追加） |
| スキーマ影響 | **あり**（列追加。RLS は既存の user 行ポリシーに従えば追加対応不要の見込み） |
| 将来の更新/削除 | ◎（event ID を直接持つので `events.patch`/`events.delete` が確実） |
| プライバシー | 中（Google の event ID を Supabase に保存。識別子のみで本文は持たない） |
| 信頼性 | 高（自前の対応表。ただしユーザーが Google 側で手動削除すると不整合 → 404 ハンドリング要） |

### Option B：別テーブルでマッピング管理

- 例：`reservation_calendar_links(reservation_id, provider, calendar_id, event_id, account_hint, created_at)`。
- 1予定が複数カレンダー/複数アカウントに対応する将来像に強い。

| 観点 | 評価 |
|---|---|
| 安全性 | 高 |
| 複雑さ | 高（**新テーブル＋RLS＋マイグレーション**、JOIN/管理コード） |
| スキーマ影響 | **大**（新テーブル） |
| 将来の更新/削除 | ◎（複数対応も含めて最も柔軟） |
| プライバシー | 中（同上。保存範囲を最小に保てば可） |
| 信頼性 | 高 |

### Option C：Google カレンダーを `extendedProperties.private.mybrainReservationId` で検索

- 書き出し前に `events.list` を `privateExtendedProperty=mybrainReservationId=<予定ID>` で検索。
- 既に存在すれば「登録済み」と扱い、再作成しない（将来は見つかった event を更新）。
- **Supabase には何も保存しない。** 対応付けはカレンダー側の extendedProperties が持つ。

| 観点 | 評価 |
|---|---|
| 安全性 | 高（DB を触らない。最悪でも「重複が1件できる」だけで破壊的でない） |
| 複雑さ | 低〜中（`events.list` 呼び出し1つ追加。`createCalendarEvent` は既に ID を刻み済み） |
| スキーマ影響 | **なし**（Supabase 変更不要） |
| 将来の更新/削除 | ○（検索で event ID を得れば patch/delete 可能。毎回検索コストはかかる） |
| プライバシー | ◎（外部IDを自前DBに溜めない。連携をやめれば痕跡はカレンダー側のみ） |
| 信頼性 | 中〜高（同一アカウント内で有効。アカウントが違えば見つからない＝そのアカウントには未登録なので妥当） |

---

## 比較サマリ

| 基準 | A: 列追加 | B: 別テーブル | C: 拡張プロパティ検索 |
|---|---|---|---|
| Supabase スキーマ変更 | 要 | 要（新テーブル） | **不要** |
| 実装の重さ | 中 | 大 | **小〜中** |
| 重複防止 | ◎ | ◎ | ○〜◎ |
| 更新/削除の確実性 | ◎ | ◎ | ○（都度検索） |
| プライバシー（自前保存） | 中 | 中 | **◎（保存なし）** |
| 破壊リスク | 中（DB整合） | 中（DB整合） | **低** |
| 複数アカウント/カレンダー | △ | ◎ | △ |

---

## 推奨：MVP は Option C（拡張プロパティ検索）

**理由（＝最も安全だから）：**
1. **Supabase スキーマを変更しない**ので、マイグレーション失敗・RLS 事故・既存データ移行のリスクがゼロ。
2. **既存実装をそのまま活かせる**：`createCalendarEvent` が既に `mybrainReservationId` を刻んでいるため、追加は「書き出し前の `events.list` 検索」だけ。
3. **失敗が非破壊的**：検索が空振りしても最悪「重複が1件」できるだけで、データを壊さない。DB 不整合も起きない。
4. **プライバシー最良**：Google の event ID を自前 DB に溜めない。連携解除後の痕跡が残らない。
5. **同一スコープで完結**：`calendar.events` は読み書き両対応のため、新スコープ不要。

**Option C の使い方（実装時の流れ・設計のみ）：**
```
書き出し（ユーザー操作起点）
 → トークン取得（calendar.events）
 → events.list?privateExtendedProperty=mybrainReservationId={予定ID}
     見つかった → 「すでに登録済みです」と案内（再作成しない／将来は更新）
     見つからない → events.insert（既存どおり・mybrainReservationId を刻む）
 → 結果メッセージ
```

**Option A への移行条件：** 更新・削除を本格対応し、「毎回検索」のコストや遅延を避けたくなった段階で、`google_calendar_event_id` 列を追加して event ID をキャッシュする（C と併用も可：C を真実源、A を高速化キャッシュ）。**この段階で初めて Supabase スキーマ変更の方針確認を行う。**

---

## スコープ外（この設計フェーズで決めないこと/やらないこと）

- 実装（検索・重複判定・更新・削除）そのもの。
- Supabase スキーマ変更・マイグレーション。
- 一括書き出し、双方向同期、Google Sheets 連携。
- 複数カレンダー/複数アカウント対応（将来 Option B 検討時に）。

---

## 既知の注意点（実装時に必ず考慮）

- **アカウント差異**：`events.list` は「今認可したアカウント」の primary を検索する。別アカウントで作った重複は検出できない（が、そのアカウントには未登録なので作成は妥当）。
- **手動削除との不整合**：ユーザーが Google 側でイベントを消すと、A/B の保存IDは 404 になる（更新/削除時にハンドリング要）。C は都度検索なので自然に「無い＝作成」へ倒れる。
- **レート制限/遅延**：C は書き出しのたびに `events.list` を1回増やす。件数が増える将来は A のキャッシュ併用を検討。
- **ユーザー確認**：重複検出時も「すでに登録済みです。もう一度登録しますか？」のように、**勝手に二重作成しない／勝手に更新しない**ことを UI で明示する（既存の確認方針を踏襲）。

---

## このステップについて

- **本ステップはドキュメントのみ。** アプリ挙動・UI・Supabase スキーマ・マイグレーション・Calendar の更新/削除・重複防止の実装は一切行わない。
- 実装に進む場合は、まず Option C を「書き出し前の存在チェック（UI 非接続のヘルパー）」として小さく追加し、その後 UI（確認文言）へ接続する想定。
