# AIプラライト EAS Build プロファイル一覧

`eas.json` のビルドプロファイルと用途まとめ。

| プロファイル | APP_ENV | API_BASE_URL | プラン変更 | 配布 | 用途 |
|---|---|---|---|---|---|
| development | development | （未設定→localhost） | 可 | internal / dev client | ローカル開発（Metro接続） |
| **preview-dev** | development | https://aipla-api-test.onrender.com | **可** | internal / Android APK | **テスト用**。実機で free/basic/standard/pro の上限切替を確認 |
| **preview** | production | https://aipla-api-test.onrender.com | **ロック** | internal / Android APK | **販売候補**。一般ユーザーに近い挙動（プラン固定）を確認 |
| production | production | https://api.aipla.jp（仮） | ロック | store | 本番公開用。URL・規約・課金連携の確定後に使用 |

## 使い分け

- **preview-dev**：プラン切替テスト用。設定画面でプランを自由に変更でき、各プランの上限（音声入力/AIチャット/文字起こし/予約自動登録）の挙動を実機で確認できる。
- **preview**：販売前の最終確認用。プラン変更はロックされ、現在プランは契約情報に基づく表示になる（ユーザーが自分でPro等に変更できない）。
- **production**：本番ストア公開用。`EXPO_PUBLIC_API_BASE_URL` を本番URLに差し替え、規約/特商法/課金連携が整ってから使用する。

## ビルドコマンド

```bash
# プラン切替テスト（開発挙動・APK）
eas build --platform android --profile preview-dev

# 販売候補（プランロック・APK）
eas build --platform android --profile preview

# 本番（公開前にURL・規約・課金確定後）
eas build --platform android --profile production
eas build --platform ios --profile production
```

## 注意

- `EXPO_PUBLIC_*` はビルド時に埋め込まれる。値を変えたら再ビルドが必要。
- preview と preview-dev は同じテストAPI（onrender）を使用。違いは APP_ENV（プラン変更可否）のみ。
- preview-dev は内部テスト専用。一般配布・公開には使わない。
- production の API URL（api.aipla.jp）は仮。本番ドメイン確定後に差し替える。
