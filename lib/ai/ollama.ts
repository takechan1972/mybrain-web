/**
 * Ollama（ローカル LLM）連携。
 *
 * - このPC上で動いている Ollama（既定 http://localhost:11434）を利用する。
 * - ブラウザからの直接アクセスは CORS の影響を受けるため、Next.js の
 *   サーバ API ルート（/api/ollama/*）を経由して呼び出す。
 * - APIキー不要。設定（endpoint / model / 有効化）は localStorage に保存。
 * - ローカル利用前提。Vercel 等のリモート環境では localhost に到達できないため
 *   接続テストは失敗する（仕様どおり）。
 */

export interface OllamaSettings {
  /** Ollama 連携を使うか */
  enabled: boolean;
  /** エンドポイント（既定: http://localhost:11434） */
  endpoint: string;
  /** 使用モデル（既定: qwen3.5:4b） */
  model: string;
}

/** 選択できるモデル（PCで確認済みのもの） */
export const OLLAMA_MODELS: { value: string; label: string }[] = [
  { value: 'qwen3.5:4b', label: 'qwen3.5:4b（標準・高速）' },
  { value: 'gemma4:12b', label: 'gemma4:12b（高精度）' },
  { value: 'qwen2.5:1.5b', label: 'qwen2.5:1.5b（軽量）' },
  { value: 'gemma4:e4b', label: 'gemma4:e4b' },
];

export const DEFAULT_OLLAMA_SETTINGS: OllamaSettings = {
  enabled: false,
  endpoint: 'http://localhost:11434',
  model: 'qwen3.5:4b',
};

const STORAGE_KEY = 'mybrain.ollama.settings';

export function loadOllamaSettings(): OllamaSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_OLLAMA_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OLLAMA_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<OllamaSettings>;
    return {
      enabled: Boolean(parsed.enabled),
      endpoint: typeof parsed.endpoint === 'string' && parsed.endpoint.trim() !== ''
        ? parsed.endpoint.trim()
        : DEFAULT_OLLAMA_SETTINGS.endpoint,
      model: typeof parsed.model === 'string' && parsed.model.trim() !== ''
        ? parsed.model.trim()
        : DEFAULT_OLLAMA_SETTINGS.model,
    };
  } catch {
    return { ...DEFAULT_OLLAMA_SETTINGS };
  }
}

export function saveOllamaSettings(s: OllamaSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/** 接続テスト：成功なら ok=true と利用可能モデル一覧を返す */
export async function testOllama(
  endpoint: string,
): Promise<{ ok: boolean; models: string[]; message: string }> {
  try {
    const res = await fetch('/api/ollama/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    const data = (await res.json()) as { ok?: boolean; models?: string[] };
    if (res.ok && data.ok) {
      return { ok: true, models: data.models ?? [], message: 'Ollama接続OK' };
    }
    return { ok: false, models: [], message: 'Ollamaが起動しているか確認してください' };
  } catch {
    return { ok: false, models: [], message: 'Ollamaが起動しているか確認してください' };
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** チャット形式で問い合わせ（/api/chat 経由）。本文（assistant の content）を返す。 */
export async function ollamaChat(
  messages: ChatMessage[],
  settings: OllamaSettings,
): Promise<string> {
  const res = await fetch('/api/ollama/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: settings.endpoint,
      model: settings.model,
      messages,
    }),
  });
  if (!res.ok) {
    throw new Error('Ollama への接続に失敗しました');
  }
  const data = (await res.json()) as { content?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return (data.content ?? '').trim();
}
