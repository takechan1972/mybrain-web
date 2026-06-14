import { NextResponse } from 'next/server';

// ローカルの Ollama へサーバ側から接続するため動的・Node ランタイムで実行
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ollama 接続テスト。
 * body: { endpoint: string }
 * → `${endpoint}/api/tags` を叩いて利用可能モデルを取得。
 */
export async function POST(request: Request) {
  try {
    const { endpoint } = (await request.json()) as { endpoint?: string };
    const base = (endpoint ?? 'http://localhost:11434').replace(/\/+$/, '');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${base}/api/tags`, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ ok: false }, { status: 200 });
    }
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = Array.isArray(data.models) ? data.models.map((m) => m.name) : [];
    return NextResponse.json({ ok: true, models });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
