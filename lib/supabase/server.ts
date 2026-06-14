import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Supabase サーバークライアント（Server Component / Route Handler 用）。
 * - anon key を使用（RLSでユーザー別にアクセス制御）
 * - SUPABASE_SERVICE_ROLE_KEY はここでは使わない（フロント配信物に含めない）
 * - env 未設定なら null
 */
export function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // ANON_KEY 優先、無ければ PUBLISHABLE_KEY（新形式）
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component からの set は不可（middleware/Route Handlerで反映されるため無視）
        }
      },
    },
  });
}
