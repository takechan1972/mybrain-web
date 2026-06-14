import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Supabase OAuth コールバックハンドラー。
 * Google / Apple 認証完了後にここへリダイレクトされ、
 * code を session に交換してからホームへ転送する。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  // プロバイダ側のエラー（ユーザーがキャンセルした場合など）
  const providerError = searchParams.get('error');
  const providerErrorDesc = searchParams.get('error_description');
  if (providerError) {
    console.error('[auth/callback] provider error:', providerError, providerErrorDesc);
    const desc = encodeURIComponent(providerErrorDesc ?? providerError);
    return NextResponse.redirect(`${origin}/login?error=oauth_failed&error_description=${desc}`);
  }

  if (!code) {
    console.error('[auth/callback] no code in callback URL. params:', Object.fromEntries(searchParams));
    return NextResponse.redirect(
      `${origin}/login?error=oauth_failed&error_description=${encodeURIComponent('code_missing')}`,
    );
  }

  console.log('[auth/callback] code received, exchanging for session...');

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    console.error('[auth/callback] Supabase client is null (env vars missing?)');
    return NextResponse.redirect(
      `${origin}/login?error=oauth_failed&error_description=${encodeURIComponent('supabase_not_configured')}`,
    );
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[auth/callback] exchangeCodeForSession error:', error.message, error);
    const desc = encodeURIComponent(error.message);
    return NextResponse.redirect(`${origin}/login?error=oauth_failed&error_description=${desc}`);
  }

  console.log('[auth/callback] session created, redirecting to', next);
  return NextResponse.redirect(`${origin}${next}`);
}
