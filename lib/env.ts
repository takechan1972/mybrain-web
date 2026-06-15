/**
 * 実行環境の判定。
 *
 * Ollama（localhost:11434）と Whisper（ローカル Python）は PC ローカルでのみ動作する。
 * Vercel 等のリモート公開環境ではこれらに到達できないため、機能の表示/実行を切り替える。
 */

/** クライアント：今アクセスしているのがローカルPC（localhost / LAN）か */
export function isLocalHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h.endsWith('.local') ||
    /^192\.168\./.test(h) ||
    /^10\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/** サーバ：Vercel 上で動いているか（ローカル Python/Ollama に到達できない環境か） */
export function isVercelServer(): boolean {
  return Boolean(process.env.VERCEL) || process.env.VERCEL_ENV === 'production';
}
