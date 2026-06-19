// アプリのプラン判定（暫定）。
// 現時点では課金・プランシステムが未実装のため、全ユーザーを「無料プラン」として扱う。
// 実データ（Supabase 等）に接続する際は getPlan() の戻り値を差し替えるだけでよい。
// 例: const { data } = await sb.from('subscriptions')... → 'paid' / 'free' を返す。

export type Plan = 'free' | 'paid';

/** 現在のユーザープラン。実データ接続前の暫定値（無料固定）。 */
export function getPlan(): Plan {
  return 'free';
}

/** 有料プランかどうか。AI相談バーなど有料機能の出し分けに使う。 */
export function isPaidPlan(): boolean {
  return getPlan() === 'paid';
}
