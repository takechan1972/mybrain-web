import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Ollama チャット生成。
 * body: { endpoint: string, model: string, messages: ChatMessage[] }
 * → `${endpoint}/api/chat` を stream:false で呼び、assistant の本文を返す。
 */
export async function POST(request: Request) {
  try {
    const { endpoint, model, messages } = (await request.json()) as {
      endpoint?: string;
      model?: string;
      messages?: ChatMessage[];
    };

    const base = (endpoint ?? 'http://localhost:11434').replace(/\/+$/, '');
    if (!model || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'model と messages は必須です' }, { status: 400 });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Ollamaが起動しているか確認してください' },
        { status: 200 },
      );
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return NextResponse.json({ content: data.message?.content ?? '' });
  } catch {
    return NextResponse.json(
      { error: 'Ollamaが起動しているか確認してください' },
      { status: 200 },
    );
  }
}
