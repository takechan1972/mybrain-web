import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// 認証が必要なパス（未ログインは /login へ誘導）
// /admin は管理者専用。未ログインは /login へ、ログイン済みでも非管理者はページ側で弾く。
const PROTECTED_PREFIXES = ['/memos', '/reservations', '/consult', '/chat', '/history', '/settings', '/admin'];

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // ANON_KEY 優先、無ければ PUBLISHABLE_KEY（新形式）
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  let res = NextResponse.next({ request: req });

  // Supabase 未設定時は素通り（設定前でもアプリは起動できる）
  if (!url || !anonKey) return res;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;

  // 未ログインでトップ(/)に来たらランディング(/welcome)へ
  if (path === '/' && !user) {
    const welcomeUrl = req.nextUrl.clone();
    welcomeUrl.pathname = '/welcome';
    return NextResponse.redirect(welcomeUrl);
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  if (isProtected && !user) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
