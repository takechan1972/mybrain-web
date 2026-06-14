import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase の公開鍵を解決する。
 * 優先：NEXT_PUBLIC_SUPABASE_ANON_KEY → 無ければ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * （新形式の publishable key にも対応）。どちらも公開前提の鍵。
 * NEXT_PUBLIC_ なので静的参照で記述し、ビルド時にインライン化させる。
 */
export function getSupabasePublicKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    undefined
  );
}

export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabasePublicKey());
}

/**
 * Supabase ブラウザクライアント（接続準備）。
 * - サービスロールキー等の秘密はサーバ側のみ。ここでは公開鍵のみ。
 * - 未設定なら null。
 * - シングルトン：呼ぶたびに新規生成すると GoTrueClient が複数生成され、
 *   認証セッションの読み取りが不安定になる（保存時に user が取れない等）。
 *   同一インスタンスを使い回して認証状態を一貫させる。
 */
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  const url = getSupabaseUrl();
  const key = getSupabasePublicKey();
  if (!url || !key) return null;
  if (!browserClient) {
    browserClient = createBrowserClient(url, key);
  }
  return browserClient;
}
