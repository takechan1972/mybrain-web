import { IS_PRODUCTION } from '@/config/api';

import { loadAiSettings, type AiPlanType } from './ai-settings';

/**
 * 契約プランの取得・編集可否。
 *
 * - 現在はローカル保存（AsyncStorage）の planType を参照する
 * - 将来は /account/plan のようなAPIから契約プランを取得する想定（差し替え可能に分離）
 *
 * プラン変更の可否：
 * - development: ユーザー（開発者）が自由に変更可（テスト用）
 * - production / preview: ロック（ユーザーは変更不可。契約情報に基づく）
 */

// プラン選択UIをユーザーが操作できるか（開発時のみ true）
export function isPlanEditable(): boolean {
  return !IS_PRODUCTION;
}

// 現在の契約プランを取得（将来はサーバー連携に差し替え）
export async function getCurrentPlan(): Promise<AiPlanType> {
  // TODO(将来): production では /account/plan から契約プランを取得する。
  // 例: const res = await fetch(`${base}/account/plan`); return res.plan;
  const settings = await loadAiSettings();
  return settings.planType;
}
