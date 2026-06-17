import { NextResponse } from 'next/server';
import { isVercelServer } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 重いモデルでも待てるよう最大実行時間を延長
export const maxDuration = 300;

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
  // リモート環境では localhost の Ollama に到達できないため即エラーを返す
  if (isVercelServer()) {
    return NextResponse.json(
      { error: 'AIアシスト（Ollama）はPCローカル版専用です。' },
      { status: 200 },
    );
  }
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
    // 応答待ちを長めに（重いモデル対策）。4分。
    const timer = setTimeout(() => ctrl.abort(), 240000);
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
