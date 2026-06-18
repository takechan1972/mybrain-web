'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';

/**
 * OAuth 完了後に戻ってくる callback URL を返す。
 *
 * OAuth はブラウザ起点のため、常に「いま実際にアクセスしている origin」
 * （window.location.origin）を使う。これで localhost / ngrok / 本番(Vercel)
 * いずれの環境でも、戻り先が現在のオリジンと一致し、PKCE の code_verifier
 * クッキー（同一オリジンに保存される）と整合する。
 * NEXT_PUBLIC_SITE_URL の取り違え（別オリジンや空文字）や ngrok URL の
 * ハードコードによる「別オリジンへ戻ってしまい code 交換に失敗 → /login へ戻る」
 * を防ぐ。成功後は callback 側で next（既定 "/"）へ転送する。
 *
 * 【必須・Supabase 側設定】Dashboard → Authentication → URL Configuration の
 * "Redirect URLs" に、利用する各オリジンの callback を許可しておくこと:
 *   - http://localhost:3000/auth/callback            (ローカル開発)
 *   - https://<現在のngrokサブドメイン>/auth/callback  (ngrok。毎回変わるため都度追加 or ワイルドカード)
 *   - https://<本番ドメイン>/auth/callback            (Vercel 本番)
 * 許可されていない origin の callback は Supabase が拒否し、code 交換が失敗する。
 */
function getOAuthRedirectUrl(): string {
  if (typeof window === 'undefined') return '/auth/callback?next=/';
  return `${window.location.origin}/auth/callback?next=/`;
}

// 宇宙背景に浮かぶガラスカード風（メモ／予定／履歴・ホームと統一）。
// 透明度を上げ（0.62→0.38）、blur を強めて背景がやわらかく透けつつ可読性を保つ。
const GLASS_CARD: React.CSSProperties = {
  background: 'rgba(12,16,38,0.38)',
  border: '1px solid rgba(130,165,255,0.30)',
  boxShadow: '0 0 26px rgba(99,102,241,0.16), 0 18px 50px rgba(0,0,0,0.42)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
};

/**
 * ログイン / 新規登録（Supabase Auth・メール＋パスワード）。
 * Welcome の「無料ではじめる」→ /login?mode=signup、「ログイン」→ /login。
 */
export default function LoginPage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'error' | 'info'>('error');

  // クエリ(?mode=signup / ?error=oauth_failed)で初期状態を切替
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'signup') setMode('signup');
      if (params.get('error') === 'oauth_failed') {
        setMessageType('error');
        const desc = params.get('error_description');
        const detail = desc ? `（${decodeURIComponent(desc)}）` : '';
        setMessage(`ソーシャルログインに失敗しました。もう一度お試しください。${detail}`);
        console.error('[login] oauth_failed:', desc ?? '(no description)');
      }
    }
  }, []);

  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    sb.auth.getUser().then(({ data }) => {
      const user = data.user;
      if (!user) return;
      // Apple「メール非公開」選択時は email が undefined になるため id で代替表示
      setUserEmail(user.email ?? `（Apple IDでログイン中: ...${user.id.slice(-6)}）`);
    });
  }, []);

  async function handleSignUp() {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    setLoading(true);
    setMessage(null);
    const { data, error } = await sb.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setMessageType('error');
      setMessage(`新規登録に失敗しました：${error.message}`);
      return;
    }
    if (data.session) {
      setMessageType('info');
      setMessage('アカウントを作成しました。MyBrainへ移動します。');
    } else {
      setMessageType('info');
      setMessage('確認メールを送信しました。メール内のリンクを開いて登録を完了してください。');
    }
  }

  async function handleSignIn() {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    setLoading(true);
    setMessage(null);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setMessageType('error');
      setMessage(`ログインに失敗しました：${error.message}`);
      return;
    }
    router.push('/');
    router.refresh();
  }

  async function handleSignOut() {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    await sb.auth.signOut();
    setUserEmail(null);
    router.refresh();
  }

  async function handleOAuth(provider: 'google' | 'apple') {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    setOauthLoading(provider);
    setMessage(null);
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: getOAuthRedirectUrl() },
    });
    if (error) {
      console.error(`[login] signInWithOAuth(${provider}) error:`, error.message, error);
      setMessageType('error');
      setMessage(`${provider === 'google' ? 'Google' : 'Apple'}ログインに失敗しました：${error.message}`);
      setOauthLoading(null);
    }
    // 成功時はブラウザが OAuth プロバイダへリダイレクトするため setOauthLoading は戻さない
  }

  // 宇宙背景（haikei.png）＋暗オーバーレイ（ホーム／メモ／予定／履歴と統一）。
  // ログインはモバイル・PC共通ページのため lg:hidden は付けず、全サイズで暗ネオン背景にする。
  const Background = (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen"
        style={{
          backgroundColor: '#050716',
          backgroundImage: "url('/haikei.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen"
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,7,22,0.40) 0%, rgba(5,7,22,0.65) 45%, rgba(5,7,22,0.95) 100%)',
        }}
      />
    </>
  );

  // 共通ヘッダー（ネオン透過ロゴ・暗背景で視認できるホームと同じロゴ）
  const Header = (
    <div className="flex flex-col items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/mybrain-original-logo-transparent.png"
        alt="MYBRAIN マイブレイン"
        className="h-auto object-contain"
        style={{ width: 'clamp(148px, 42vw, 200px)', filter: 'drop-shadow(0 0 12px rgba(99,102,241,0.40))' }}
      />
    </div>
  );

  if (!configured) {
    return (
      <>
        {Background}
        <div
          className="relative z-10 flex min-h-[80vh] flex-col justify-center"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex flex-col gap-4 rounded-3xl p-6" style={GLASS_CARD}>
            {Header}
            <p
              className="rounded-2xl p-4 text-sm"
              style={{
                border: '1px solid rgba(242,213,138,0.4)',
                background: 'rgba(242,213,138,0.10)',
                color: '#f2d58a',
              }}>
              Supabase が未設定です。<code>.env.local</code> を設定して再起動してください。
            </p>
          </div>
        </div>
      </>
    );
  }

  // ログイン済み → 自動でホームへ（OAuth callback 後も含む）
  useEffect(() => {
    if (userEmail) router.replace('/');
  }, [userEmail, router]);

  const isSignup = mode === 'signup';

  return (
    <>
      {Background}
      <div
        className="relative z-10 flex min-h-[100dvh] flex-col justify-center"
        style={{
          paddingTop: 'calc(12px + env(safe-area-inset-top))',
          paddingBottom: 'calc(40px + env(safe-area-inset-bottom))',
        }}>
        <div className="flex flex-col gap-4 rounded-3xl p-5" style={GLASS_CARD}>
          {Header}

          <div className="text-center">
            <h1 className="text-[20px] font-bold" style={{ color: '#ffffff' }}>
              {isSignup ? '無料でアカウント作成' : 'おかえりなさい'}
            </h1>
            <p className="mt-1 text-sm" style={{ color: '#9fb0e0' }}>
              {isSignup
                ? 'メールアドレスだけで、すぐにはじめられます。'
                : 'メールアドレスでログインしてください。'}
            </p>
          </div>

          {/* セグメント切替（ログイン / 新規登録） */}
          <div
            className="flex rounded-full p-1"
            style={{ background: 'rgba(10,14,32,0.45)', border: '1px solid rgba(130,165,255,0.30)' }}>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setMessage(null);
              }}
              className="flex-1 rounded-full py-2.5 text-sm font-semibold transition active:scale-[0.98]"
              style={
                !isSignup
                  ? {
                      background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)',
                      color: '#fff',
                      boxShadow: '0 0 14px rgba(99,102,241,0.5)',
                    }
                  : { color: '#9fb0e0' }
              }>
              ログイン
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setMessage(null);
              }}
              className="flex-1 rounded-full py-2.5 text-sm font-semibold transition active:scale-[0.98]"
              style={
                isSignup
                  ? {
                      background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)',
                      color: '#fff',
                      boxShadow: '0 0 14px rgba(99,102,241,0.5)',
                    }
                  : { color: '#9fb0e0' }
              }>
              新規登録
            </button>
          </div>

          {/* 入力（メール / パスワード） */}
          <div className="flex flex-col gap-3">
            <input
              className="min-h-[48px] rounded-2xl px-4 py-3.5 text-[15px] text-white outline-none placeholder:text-[#7d89bd]"
              style={{ background: 'rgba(10,14,32,0.42)', border: '1px solid rgba(130,165,255,0.45)', caretColor: '#818cf8' }}
              type="email"
              autoComplete="email"
              placeholder="メールアドレス"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="min-h-[48px] rounded-2xl px-4 py-3.5 text-[15px] text-white outline-none placeholder:text-[#7d89bd]"
              style={{ background: 'rgba(10,14,32,0.42)', border: '1px solid rgba(130,165,255,0.45)', caretColor: '#818cf8' }}
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder="パスワード（6文字以上）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {message && (
            <p
              className="rounded-xl px-3 py-2.5 text-sm"
              style={
                messageType === 'error'
                  ? { background: 'rgba(224,85,85,0.15)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.35)' }
                  : { background: 'rgba(99,102,241,0.15)', color: '#c7d2fe', border: '1px solid rgba(99,102,241,0.35)' }
              }>
              {message}
            </p>
          )}

          {/* 主ボタン（メール） */}
          <button
            onClick={isSignup ? handleSignUp : handleSignIn}
            disabled={loading || oauthLoading !== null}
            className="min-h-[48px] rounded-2xl text-[15px] font-bold text-white active:scale-[0.98] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 8px 24px rgba(60,120,255,0.45)' }}>
            {loading ? '処理中…' : isSignup ? '無料ではじめる' : 'ログイン'}
          </button>

          {/* 区切り */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1" style={{ background: 'rgba(120,160,255,0.25)' }} />
            <span className="text-xs" style={{ color: '#8893c4' }}>
              または
            </span>
            <div className="h-px flex-1" style={{ background: 'rgba(120,160,255,0.25)' }} />
          </div>

          {/* Google ボタン（信頼感のある白ボタン・公式ロゴ。クリック挙動は既存のまま） */}
          <button
            type="button"
            onClick={() => handleOAuth('google')}
            disabled={loading || oauthLoading !== null}
            className="flex min-h-[48px] items-center justify-center gap-3 rounded-2xl bg-white text-[15px] font-semibold text-[#223A70] active:opacity-80 disabled:opacity-50"
            style={{ boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}>
            {oauthLoading === 'google' ? (
              <span className="text-[#8A94A6]">接続中…</span>
            ) : (
              <>
                {/* Google アイコン */}
                <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                {isSignup ? 'Googleで登録' : 'Googleでログイン'}
              </>
            )}
          </button>

          {/* Apple ボタン（未設定のため非活性・準備中表示） */}
          <button
            type="button"
            disabled
            aria-label="Appleログインは準備中です"
            className="flex min-h-[48px] cursor-not-allowed items-center justify-center gap-3 rounded-2xl text-[15px] font-semibold text-white opacity-40"
            style={{ background: 'rgba(40,44,60,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}>
            {/* Apple アイコン */}
            <svg width="18" height="22" viewBox="0 0 814 1000" aria-hidden="true" fill="currentColor">
              <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.5-155.5-127.4C46.7 790.7 0 663 0 541.8c0-207.2 135.4-316.6 269-316.6 71 0 130.6 46.5 174.6 46.5 42.9 0 110.5-49.3 193.5-49.3 31.2 0 108.2 2.6 168.5 81.5zm-126.7-254c34.8-41.3 60.1-98.8 60.1-156.3 0-8.1-.6-16.2-2-23.8-57.4 2.2-126.1 38.2-168 83.4-32.2 36.2-62.1 93.7-62.1 152.5 0 8.7 1.3 17.4 2 19.9 3.9.7 10.3 1.3 16.6 1.3 51.9 0 119.8-34.8 153.4-77z"/>
            </svg>
            {isSignup ? 'Appleで登録' : 'Appleでログイン'}
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px]">準備中</span>
          </button>

          {/* もう一方への切替リンク */}
          <p className="text-center text-sm" style={{ color: '#9fb0e0' }}>
            {isSignup ? 'すでにアカウントをお持ちの方は ' : 'アカウントをお持ちでない方は '}
            <button
              type="button"
              onClick={() => {
                setMode(isSignup ? 'login' : 'signup');
                setMessage(null);
              }}
              className="font-bold"
              style={{ color: '#9cc4ff' }}>
              {isSignup ? 'ログイン' : '無料で新規登録'}
            </button>
          </p>

          <p className="text-center text-xs" style={{ color: '#7a86b8' }}>
            データはユーザーごとに安全に保存されます。秘密鍵はサーバ側のみで扱います。
          </p>
        </div>
      </div>
    </>
  );
}
