// 安全なUUID生成。
// crypto.randomUUID() は「セキュアコンテキスト」(HTTPS または localhost) でしか使えない。
// スマホから http://192.168.x.x:3000 のように LAN IP + HTTP でアクセスすると
// crypto.randomUUID が undefined になり「is not a function」で落ちる。
// そのためフォールバックを用意し、どの環境でも ID を生成できるようにする。
export function safeUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // getRandomValues は HTTP でも使える環境が多い → RFC4122 v4 形式を自前生成
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
      return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
    }
  } catch {
    // フォールバックへ
  }
  // 最終フォールバック（暗号強度は不要・ローカルIDのみ）
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
