import { Platform } from 'react-native';

import { aiUrl, MSG_NOT_CONFIGURED } from '@/config/api';
import { buildMockChatReply } from './ai-providers';
import type {
  AiConnectionMode,
  AiProvider,
  AiSettings,
  AiTaskProviderSettings,
} from './ai-settings';
import { hasApiKey, type ApiKeyProvider } from './secure-api-keys';
import { mockSummarizeText } from './voice-memo';
import type { Memo, Reservation } from '../store/app-data';
import { suggestTags } from '../utils/auto-tags';

/**
 * AI クライアント（プラン / 接続方式に応じた処理分岐の土台）。
 *
 * 今回は本接続・課金・APIキー保存は行わない。
 * connectionMode（≒プラン）に応じて、
 *   - mock         : 簡易 mock を返す
 *   - backend       : 運営API へ POST する土台（未設定なら案内）
 *   - user-api-key  : BYOK（SecureStore 対応後に有効化予定）
 *   - local         : ローカルAI へ POST する土台（未設定なら案内）
 *   - custom        : Custom API へ POST する土台（未設定なら案内）
 * を返す。すべて例外安全（アプリが落ちない）。
 */

export interface AiClientResult {
  ok: boolean;
  text: string;
}

function trimOrEmpty(s?: string): string {
  return (s ?? '').trim();
}

// fetch の土台。失敗してもアプリを落とさず結果を返す。
async function postJson(endpoint: string, body: unknown): Promise<AiClientResult> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, text: `接続に失敗しました（HTTP ${res.status}）。設定を確認してください。` };
    }
    const data: unknown = await res.json().catch(() => null);
    const text =
      data && typeof data === 'object' && typeof (data as { text?: unknown }).text === 'string'
        ? (data as { text: string }).text
        : 'APIから応答を受け取りました（接続土台）。';
    return { ok: true, text };
  } catch {
    return { ok: false, text: 'APIに接続できませんでした。ネットワークやエンドポイント設定をご確認ください。' };
  }
}

// ── 運営API 共通 POST（backend / local / custom 用） ─────────────────────────

export interface BackendResult {
  ok: boolean;
  data?: unknown;
  message?: string;
}

const BACKEND_TIMEOUT_MS = 15000;

/**
 * 運営API（または local/custom エンドポイント）へ JSON を POST する共通処理。
 * - タイムアウト 15 秒
 * - HTTP エラー / JSON parse エラー / 想定外を安全に処理
 * - throw せず BackendResult を返す（呼び出し元で mock フォールバック可能）
 */
export async function postToBackendAi(endpoint: string, payload: unknown): Promise<BackendResult> {
  const url = trimOrEmpty(endpoint);
  if (url.length === 0) {
    return { ok: false, message: '運営APIエンドポイントが未設定です' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, message: '運営APIに接続できませんでした' };
    }
    try {
      const data: unknown = await res.json();
      return { ok: true, data };
    } catch {
      return { ok: false, message: '運営APIのレスポンス形式が正しくありません' };
    }
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, message: '運営APIへの接続がタイムアウトしました' };
    }
    return { ok: false, message: '運営APIに接続できませんでした' };
  }
}

type RemoteMode = 'backend' | 'local' | 'custom';

// AIプロバイダー → SecureStore のキー種別
function toApiKeyProvider(provider: AiProvider): ApiKeyProvider {
  if (provider === 'openai' || provider === 'anthropic' || provider === 'gemini') return provider;
  return 'custom';
}

// BYOK（user-api-key）の状態メッセージ（本接続はまだ行わない）
export async function byokStatusMessage(provider: AiProvider): Promise<string> {
  if (Platform.OS === 'web') {
    return 'Web版では安全性のためBYOK APIキーは使用できません';
  }
  const has = await hasApiKey(toApiKeyProvider(provider));
  return has
    ? 'BYOK APIキーは保存済みです。本接続は今後対応予定です'
    : 'BYOK APIキーが保存されていません';
}

function endpointNotSetMessage(mode: RemoteMode): string {
  return mode === 'backend'
    ? MSG_NOT_CONFIGURED
    : mode === 'local'
      ? 'ローカルAIエンドポイントが未設定です'
      : 'Custom APIエンドポイントが未設定です';
}

// 共通ペイロードを生成して POST
async function callBackend(
  task: AiTaskProviderSettings | undefined,
  settings: AiSettings,
  mode: RemoteMode,
  endpoint: string,
  taskName: string,
  input: unknown,
): Promise<BackendResult> {
  const payload = {
    task: taskName,
    provider: task?.provider ?? settings.selectedProvider ?? 'mock',
    model: trimOrEmpty(task?.model) || trimOrEmpty(settings.selectedModel),
    language: settings.transcriptionLanguage ?? 'ja-JP',
    input,
    metadata: {
      app: 'ai-iphone',
      planType: settings.planType,
      connectionMode: mode,
      timestamp: new Date().toISOString(),
    },
  };
  return postToBackendAi(endpoint, payload);
}

function asObject(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

// レート上限メッセージ判定
export function isRateLimitMessage(message: string | undefined): boolean {
  if (!message) return false;
  return (
    message.includes('利用回数が上限に達しました') ||
    message.includes('上限に達しました') ||
    message.includes('rate_limited')
  );
}

// backend エンベロープ { ok, data?, message? } を展開
function unwrapEnvelope(raw: unknown): {
  ok: boolean;
  data: Record<string, unknown> | null;
  message?: string;
} {
  const env = asObject(raw);
  if (!env) return { ok: false, data: null };
  const ok = env.ok !== false; // ok 欠落時は true 扱い
  const data = asObject(env.data);
  const message = typeof env.message === 'string' ? env.message : undefined;
  return { ok, data, message };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * 機能別設定（task）と全体設定から、実際に使う接続方式とエンドポイントを解決する。
 * - task が無効/未設定なら mock にフォールバック
 * - task.endpoint が空なら、全体設定の対応エンドポイントにフォールバック
 */
function resolveConnection(
  task: AiTaskProviderSettings | undefined,
  settings: AiSettings,
): { mode: AiConnectionMode; endpoint: string; model: string } {
  if (!task || !task.enabled) {
    return { mode: 'mock', endpoint: '', model: '' };
  }
  const mode = task.connectionMode;
  let endpoint = trimOrEmpty(task.endpoint);
  if (endpoint.length === 0) {
    if (mode === 'backend') endpoint = trimOrEmpty(settings.backendEndpoint);
    else if (mode === 'local') endpoint = trimOrEmpty(settings.localEndpoint);
    else if (mode === 'custom') endpoint = trimOrEmpty(settings.customApiEndpoint);
  }
  // backend は接続先を中央設定（環境変数/開発用）から補完する。
  // 設定画面の接続先（settings.backendEndpoint）があればそれを優先（override）。
  if (mode === 'backend') {
    const r = aiUrl(endpoint.length > 0 ? endpoint : settings.backendEndpoint);
    endpoint = r.url ?? '';
  }
  return { mode, endpoint, model: trimOrEmpty(task.model) || trimOrEmpty(settings.selectedModel) };
}

/**
 * 解決済みの接続方式に応じてタスクを実行。本接続はまだ行わず、土台と安全な案内を返す。
 */
async function runTask(
  taskLabel: string,
  input: string,
  task: AiTaskProviderSettings | undefined,
  settings: AiSettings,
  mockResult: () => string,
): Promise<AiClientResult> {
  const safeInput = (input ?? '').toString();
  const { mode, endpoint, model } = resolveConnection(task, settings);

  switch (mode) {
    case 'mock':
      return { ok: true, text: mockResult() };

    case 'backend': {
      // standard / pro 共通。
      // TODO: pro は将来、利用量上限を standard と分けて制御する。
      if (endpoint.length === 0) return { ok: false, text: MSG_NOT_CONFIGURED };
      return postJson(endpoint, { task: taskLabel, input: safeInput, model });
    }

    case 'user-api-key':
      // BYOK は SecureStore 対応後に有効化予定（今回は本接続しない）。
      return {
        ok: false,
        text: 'BYOK接続はSecureStore対応後に有効化予定です。現在は簡易AIをご利用ください。',
      };

    case 'local':
      if (endpoint.length === 0) return { ok: false, text: 'ローカルAIエンドポイントが未設定です。' };
      return postJson(endpoint, { task: taskLabel, input: safeInput, model });

    case 'custom':
      if (endpoint.length === 0) return { ok: false, text: 'Custom APIエンドポイントが未設定です。' };
      return postJson(endpoint, { task: taskLabel, input: safeInput, model });

    default:
      // 想定外でも mock にフォールバック（落とさない）。
      return { ok: true, text: mockResult() };
  }
}

// ── 個別タスク関数（各機能別設定を参照。無ければ mock にフォールバック） ───────

export async function summarizeText(input: string, settings: AiSettings): Promise<AiClientResult> {
  return runTask('summary', input, settings.summarySettings, settings, () =>
    mockSummarizeText(input ?? ''),
  );
}

// ── 構造化された要約（メモ登録用） ──────────────────────────────────────────

export interface SummaryResult {
  title: string;
  summary: string;
  bulletPoints: string[];
  actionItems?: string[];
  message?: string;
  rateLimited?: boolean;
}

// テキストから簡易にポイントを抽出（mock。先頭の文を最大3つ）
function buildBulletPoints(text: string): string[] {
  return text
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);
}

// アクションらしき文を簡易抽出（mock）
function buildActionItems(text: string): string[] {
  const keywords = ['準備', '確認', '対応', '連絡', '予約', '予定', '締切'];
  return text
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && keywords.some((k) => s.includes(k)))
    .slice(0, 3);
}

/**
 * 文字起こしテキストを要約し、メモ登録に使いやすい構造化結果を返す。
 * summarySettings を参照（無効/mock/未設定は安全に mock 要約へフォールバック）。
 */
function mockSummaryResult(text: string, message?: string): SummaryResult {
  const summary = mockSummarizeText(text);
  return {
    title: `AI要約：${summary.slice(0, 30)}`,
    summary,
    bulletPoints: buildBulletPoints(text),
    actionItems: buildActionItems(text),
    message,
  };
}

export async function summarizeMemo(input: string, settings: AiSettings): Promise<SummaryResult> {
  const text = (input ?? '').toString().trim();
  if (text.length === 0) {
    return { title: '', summary: '', bulletPoints: [], message: '要約する文字がありません' };
  }

  const task = settings.summarySettings;

  // 無効時は mock 要約にフォールバック（落とさない）
  if (task && task.enabled === false) {
    return mockSummaryResult(text, '要約AIが無効です。簡易要約で処理します');
  }

  const { mode, endpoint } = resolveConnection(task, settings);

  if (mode === 'mock') return mockSummaryResult(text);
  if (mode === 'user-api-key') {
    return mockSummaryResult(text, 'BYOK接続はSecureStore対応後に有効化予定です');
  }

  // backend / local / custom：実 POST
  if (endpoint.length === 0) {
    return mockSummaryResult(text, endpointNotSetMessage(mode));
  }
  const res = await callBackend(task, settings, mode, endpoint, 'summary', {
    text,
    source: 'memo',
    format: 'memo',
  });
  if (!res.ok) {
    return mockSummaryResult(text, `${res.message ?? '運営APIに接続できませんでした'}（簡易要約で処理しました）`);
  }
  const env = unwrapEnvelope(res.data);
  if (!env.ok) {
    // 上限到達は mock せず上限案内を返す
    if (isRateLimitMessage(env.message)) {
      return { title: '', summary: '', bulletPoints: [], message: env.message, rateLimited: true };
    }
    return mockSummaryResult(text, `${env.message ?? '運営APIでエラーが発生しました'}（簡易要約で処理しました）`);
  }
  const obj = env.data;
  if (!obj || typeof obj.summary !== 'string') {
    return mockSummaryResult(text, '運営APIのレスポンス形式が正しくありません（簡易要約で処理しました）');
  }
  const summary = obj.summary;
  return {
    title: typeof obj.title === 'string' && obj.title ? obj.title : `AI要約：${summary.slice(0, 30)}`,
    summary,
    bulletPoints: asStringArray(obj.bulletPoints).length > 0 ? asStringArray(obj.bulletPoints) : buildBulletPoints(text),
    actionItems: asStringArray(obj.actionItems),
    message: typeof obj.message === 'string' ? obj.message : '運営APIに接続しました',
  };
}

// 要約結果をメモ本文テキストに整形（元の文字起こしも保持）
export function formatSummaryForMemo(
  result: SummaryResult,
  transcript: string,
): { title: string; body: string } {
  const parts: string[] = [];
  parts.push('【要約】', result.summary || '(なし)');
  if (result.bulletPoints.length > 0) {
    parts.push('', '【ポイント】', ...result.bulletPoints.map((p) => `・${p}`));
  }
  if (result.actionItems && result.actionItems.length > 0) {
    parts.push('', '【アクション】', ...result.actionItems.map((a) => `・${a}`));
  }
  const t = (transcript ?? '').trim();
  if (t.length > 0) {
    parts.push('', '【元のテキスト】', t);
  }
  return { title: result.title || 'AI要約', body: parts.join('\n') };
}

// ── チャット（chatSettings 参照・履歴/メモ/予定コンテキスト対応） ─────────────

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}
export interface ChatMemoRef {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt?: string;
}
export interface ChatScheduleRef {
  id: string;
  title: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  description?: string;
}
export interface ChatRequest {
  message: string;
  history?: ChatHistoryItem[];
  memos?: ChatMemoRef[];
  schedules?: ChatScheduleRef[];
}

// 送信量の上限（プライバシー配慮・データ量制限）
const MAX_HISTORY = 10;
const MAX_MEMOS = 5;
const MAX_SCHEDULES = 5;

export interface ChatResult {
  reply: string;
  message?: string;
  provider?: string;
  model?: string;
  rateLimited?: boolean;
}

const MOCK_CHAT_FALLBACK =
  '現在は簡易AIで動作しています。入力内容を確認しました。実際のAI接続後は、メモや予定を参照した回答ができるようになります。';

// 構造化リクエストから mock 参照用の Memo / Reservation 風オブジェクトを復元
function mockChatReply(req: ChatRequest): string {
  const memos = (req.memos ?? []).map(
    (m): Memo => ({
      id: m.id,
      title: m.title,
      body: m.content,
      tags: m.tags ?? [],
      pinned: false,
      source: 'manual',
      createdAt: 0,
      updatedAt: 0,
    }),
  );
  const reservations = (req.schedules ?? []).map(
    (s): Reservation => ({
      id: s.id,
      name: s.title,
      datetime: [s.date ?? '', s.startTime ?? ''].filter((v) => v.length > 0).join(' '),
      content: s.description ?? '',
      note: '',
      createdAt: 0,
      updatedAt: 0,
    }),
  );

  const base =
    memos.length > 0 || reservations.length > 0
      ? buildMockChatReply(req.message, memos, reservations)
      : MOCK_CHAT_FALLBACK;

  // history / memos / schedules を考慮した旨を簡易に併記（要件8）
  const notes: string[] = [];
  if ((req.history ?? []).length > 0) notes.push('これまでの会話も踏まえて回答します。');
  if (memos.length > 0) notes.push('関連するメモを確認しました。');
  if (reservations.length > 0) notes.push('直近の予定を確認しました。');
  return notes.length > 0 ? `${base}\n\n${notes.join(' ')}` : base;
}

// 送信前にサイズを安全に切り詰める
function clampRequest(req: ChatRequest): ChatRequest {
  return {
    message: (req.message ?? '').toString(),
    history: (req.history ?? []).filter((h) => h.content.trim().length > 0).slice(-MAX_HISTORY),
    memos: (req.memos ?? []).slice(0, MAX_MEMOS).map((m) => ({
      ...m,
      content: (m.content ?? '').slice(0, 500),
    })),
    schedules: (req.schedules ?? []).slice(0, MAX_SCHEDULES),
  };
}

// メモ・予定の参照情報を含めた Ollama 用プロンプトを生成
function buildOllamaPrompt(req: ChatRequest): string {
  const parts: string[] = [];
  // 役割と回答ルール（逆質問・追加質問を抑制し、回答を完結させる）
  parts.push('あなたはAIプラのアシスタントです。');
  parts.push('以下の【ユーザー質問】に、日本語で簡潔かつ完結に回答してください。');
  parts.push('回答ルール:');
  parts.push('- 参考情報（メモ・予約）があれば活用し、丸写しせず必要な部分だけ要約して使う。');
  parts.push('- 参考情報が不足していても、わかる範囲で回答を完結させる。');
  parts.push('- 「教えてください」「情報が不足しています」などの逆質問・追加質問はしない。');
  parts.push('- 「ここからも〜」のような誘導文や定型の締めくくりは付けない。');
  parts.push('- 回答本文のみを出力する。');

  parts.push(`\n【ユーザー質問】\n${req.message}`);

  const memos = req.memos ?? [];
  if (memos.length > 0) {
    parts.push('\n【参考メモ】');
    for (const m of memos.slice(0, 5)) {
      const body = (m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const tags = (m.tags ?? []).length > 0 ? `（タグ: ${m.tags.join(', ')}）` : '';
      parts.push(`- ${m.title || '無題'}${tags}: ${body}`);
    }
  }

  const schedules = req.schedules ?? [];
  if (schedules.length > 0) {
    parts.push('\n【参考予約】');
    for (const s of schedules.slice(0, 5)) {
      const when = [s.date ?? '', s.startTime ?? ''].filter((v) => v.length > 0).join(' ');
      const desc = (s.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      parts.push(`- ${when} ${s.title}${desc ? `: ${desc}` : ''}`);
    }
  }

  // 直近の会話履歴（軽量・文脈用）
  const history = req.history ?? [];
  if (history.length > 0) {
    parts.push('\n【これまでの会話】');
    for (const h of history.slice(-6)) {
      parts.push(`${h.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${h.content}`);
    }
  }

  parts.push('\n上記の参考情報を利用して、追加質問はせず回答を完結してください。');
  parts.push('\n【回答】');
  return parts.join('\n');
}

/**
 * Ollama /api/generate へ POST してチャット応答を返す。
 * - body: { model, prompt, stream:false }
 * - 例外安全。接続失敗時は「ローカルAIに接続できませんでした」
 */
async function ollamaChat(
  endpoint: string,
  model: string,
  req: ChatRequest,
  provider: AiProvider,
): Promise<ChatResult> {
  const base = normalizeOllamaBase(endpoint);
  const url = `${base}/api/generate`;
  const prompt = buildOllamaPrompt(req);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        // localモードのみ：回答の暴走・逸脱を抑制
        options: { temperature: 0.3 },
        // 不要な締め文・逆質問の開始語で生成を打ち切る
        stop: ['これからも', '教えてください', '追加情報', 'ここから', '情報が不足しています'],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        reply: mockChatReply(req),
        message: `ローカルAIに接続できませんでした（HTTP ${res.status}）（簡易応答で処理しました）`,
        provider,
        model,
      };
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      return {
        reply: mockChatReply(req),
        message: 'ローカルAIの応答を解析できませんでした（簡易応答で処理しました）',
        provider,
        model,
      };
    }
    const obj = asObject(data);
    const reply = obj && typeof obj.response === 'string' ? obj.response.trim() : '';
    if (reply.length === 0) {
      return {
        reply: mockChatReply(req),
        message: 'ローカルAIから有効な応答が得られませんでした（簡易応答で処理しました）',
        provider,
        model,
      };
    }
    return { reply, message: 'ローカルAI（Ollama）で回答しました', provider, model };
  } catch (e) {
    clearTimeout(timer);
    const webCors =
      Platform.OS === 'web'
        ? 'ブラウザからローカルAIへ直接接続できません（CORS）。OLLAMA_ORIGINS の許可、またはLAN IP設定が必要です。'
        : '';
    return {
      reply: mockChatReply(req),
      message: `ローカルAIに接続できませんでした${webCors ? `\n${webCors}` : ''}（簡易応答で処理しました）`,
      provider,
      model,
    };
  }
}

/**
 * AIチャット応答を返す。chatSettings を参照し、
 * 無効/mock/未設定/未対応は安全に mock チャットへフォールバックする。
 * history / memos / schedules は optional（未指定は空配列）。
 */
export async function chatWithAi(
  request: ChatRequest,
  settings: AiSettings,
): Promise<ChatResult> {
  const req = clampRequest(request);
  const task = settings.chatSettings;
  let { mode, endpoint, model } = resolveConnection(task, settings);
  // グローバルのAI利用方式が local で、機能別チャットが未設定(mock)なら Ollama を使う
  // （運営API/backend・custom の挙動は変更しない）
  if (mode === 'mock' && settings.connectionMode === 'local') {
    mode = 'local';
    endpoint = trimOrEmpty(settings.localEndpoint);
    model = trimOrEmpty(settings.selectedModel);
  }
  const provider = task?.provider ?? 'mock';

  // 無効時：mock にフォールバック
  if (task && task.enabled === false) {
    return {
      reply: mockChatReply(req),
      message: 'チャットAIが無効です。簡易応答で処理します',
      provider,
      model,
    };
  }

  try {
    switch (mode) {
      case 'mock':
        return { reply: mockChatReply(req), provider, model };

      case 'user-api-key':
        return {
          reply: mockChatReply(req),
          message: await byokStatusMessage(task?.provider ?? 'mock'),
          provider,
          model,
        };

      case 'local': {
        // ローカルAI（Ollama）：/api/generate を使用。メモ・予定参照をプロンプトに含める
        if (endpoint.length === 0) {
          return { reply: mockChatReply(req), message: 'ローカルAIエンドポイントが未設定です', provider, model };
        }
        const useModel = model || trimOrEmpty(settings.selectedModel);
        if (useModel.length === 0) {
          return { reply: mockChatReply(req), message: 'モデル名が未設定です（例: qwen2.5:1.5b）', provider, model };
        }
        return ollamaChat(endpoint, useModel, req, provider);
      }

      case 'backend':
      case 'custom': {
        if (endpoint.length === 0) {
          return { reply: mockChatReply(req), message: endpointNotSetMessage(mode), provider, model };
        }
        const res = await callBackend(task, settings, mode, endpoint, 'chat', {
          message: req.message,
          history: req.history ?? [],
          memos: req.memos ?? [],
          schedules: req.schedules ?? [],
        });
        if (!res.ok) {
          return {
            reply: mockChatReply(req),
            message: `${res.message ?? '運営APIに接続できませんでした'}（簡易応答で処理しました）`,
            provider,
            model,
          };
        }
        const env = unwrapEnvelope(res.data);
        if (!env.ok) {
          // 上限到達は mock せず上限案内
          if (isRateLimitMessage(env.message)) {
            return { reply: '', message: env.message, provider, model, rateLimited: true };
          }
          return {
            reply: mockChatReply(req),
            message: `${env.message ?? '運営APIでエラーが発生しました'}（簡易応答で処理しました）`,
            provider,
            model,
          };
        }
        const obj = env.data;
        if (!obj || typeof obj.reply !== 'string') {
          return {
            reply: mockChatReply(req),
            message: '運営APIのレスポンス形式が正しくありません（簡易応答で処理しました）',
            provider,
            model,
          };
        }
        return {
          reply: obj.reply,
          message: typeof obj.message === 'string' ? obj.message : '運営APIに接続しました',
          provider: typeof obj.provider === 'string' ? obj.provider : provider,
          model: typeof obj.model === 'string' ? obj.model : model,
        };
      }

      default:
        return { reply: mockChatReply(req), provider, model };
    }
  } catch {
    return {
      reply: mockChatReply(req),
      message: 'AI応答を取得できませんでした。簡易応答で処理します。',
      provider,
      model,
    };
  }
}

export async function extractScheduleFromText(
  input: string,
  settings: AiSettings,
): Promise<AiClientResult> {
  return runTask('scheduleExtraction', input, settings.scheduleExtractionSettings, settings, () => {
    const text = (input ?? '').toString();
    return text.trim().length === 0
      ? '（mock）抽出対象のテキストがありません。'
      : '（mock）予定候補を抽出しました（土台）。';
  });
}

// ── 予定抽出（scheduleExtractionSettings 参照・構造化結果） ───────────────────

export interface ScheduleCandidate {
  title: string;
  date?: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  description?: string;
  location?: string;
  confidence?: number;
}

export interface ScheduleExtractionResult {
  schedules: ScheduleCandidate[];
  message?: string;
  rateLimited?: boolean;
}

function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const WEEKDAY_MAP: Record<string, number> = {
  日: 0,
  月: 1,
  火: 2,
  水: 3,
  木: 4,
  金: 5,
  土: 6,
};

// セグメントから日付（YYYY-MM-DD）を推定
function parseDateFromText(seg: string): string | undefined {
  const now = new Date();
  if (seg.includes('明後日')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return ymdLocal(d);
  }
  if (seg.includes('明日')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return ymdLocal(d);
  }
  if (seg.includes('今日') || seg.includes('本日')) {
    return ymdLocal(now);
  }
  // M月D日
  const md = seg.match(/(\d{1,2})月(\d{1,2})日/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${now.getFullYear()}-${p(month)}-${p(day)}`;
    }
  }
  // (来週)?(月〜日)曜
  const wd = seg.match(/(来週)?\s*([日月火水木金土])曜/);
  if (wd) {
    const target = WEEKDAY_MAP[wd[2]];
    const nextWeek = Boolean(wd[1]);
    const d = new Date(now);
    let diff = (target - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // 同じ曜日は次の同曜日
    if (nextWeek) diff += 7;
    d.setDate(d.getDate() + diff);
    return ymdLocal(d);
  }
  if (seg.includes('来週')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return ymdLocal(d);
  }
  return undefined;
}

// セグメントから時刻（開始・終了 HH:mm）を推定
function parseTimeFromText(seg: string): { startTime?: string; endTime?: string } {
  const toHHmm = (hourStr: string, minStr: string | undefined, pm: boolean): string => {
    let h = Number(hourStr);
    if (pm && h < 12) h += 12;
    const m = minStr ? Number(minStr) : 0;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}`;
  };

  // 範囲: H時(半|M分)? から H時(半|M分)?
  const range = seg.match(
    /(午前|午後)?\s*(\d{1,2})時(半|(\d{1,2})分)?\s*(?:から|〜|~|-)\s*(午前|午後)?\s*(\d{1,2})時(半|(\d{1,2})分)?/,
  );
  if (range) {
    const sMin = range[3] === '半' ? '30' : range[4];
    const eMin = range[7] === '半' ? '30' : range[8];
    return {
      startTime: toHHmm(range[2], sMin, range[1] === '午後'),
      endTime: toHHmm(range[6], eMin, range[5] === '午後'),
    };
  }
  // 単一: (午前|午後)? HH:mm
  const hhmm = seg.match(/(午前|午後)?\s*(\d{1,2}):(\d{2})/);
  if (hhmm) {
    return { startTime: toHHmm(hhmm[2], hhmm[3], hhmm[1] === '午後') };
  }
  // 単一: (午前|午後)? H時(半|M分)?
  const single = seg.match(/(午前|午後)?\s*(\d{1,2})時(半|(\d{1,2})分)?/);
  if (single) {
    const min = single[3] === '半' ? '30' : single[4];
    return { startTime: toHHmm(single[2], min, single[1] === '午後') };
  }
  return {};
}

/**
 * 音声テキストから予定の日時を抽出し、予定の datetime 形式に整形する。
 * 既存の日本語日時パーサ（parseDateFromText / parseTimeFromText）を再利用。
 * - 日付・時刻のどちらも取れない場合は ok:false を返す
 * - 形式: "YYYY-MM-DD HH:mm" / "YYYY-MM-DD HH:mm-HH:mm"（予定の保存形式に合わせる）
 */
export function parseScheduleDateTime(text: string): { ok: boolean; datetime: string } {
  const seg = (text ?? '').toString();
  const date = parseDateFromText(seg);
  const { startTime, endTime } = parseTimeFromText(seg);
  if (!date && !startTime) return { ok: false, datetime: '' };
  const parts = [date ?? '', startTime ?? ''].filter((s) => s.length > 0).join(' ');
  const datetime = endTime ? `${parts}-${endTime}` : parts;
  return { ok: true, datetime: datetime.trim() };
}

const SCHEDULE_KEYWORDS = [
  '打ち合わせ',
  '打合せ',
  '会議',
  'ミーティング',
  '面談',
  '訪問',
  '来店',
  '病院',
  '電話',
  '資料',
  '予約',
  '予定',
  '締切',
  'アポ',
  'ランチ',
];

// セグメントから簡易タイトルを作る（日時表現を除去）
function makeScheduleTitle(seg: string): string {
  const cleaned = seg
    .replace(/(来週|今週|再来週)?\s*[日月火水木金土]曜日?/g, '')
    .replace(/明後日|明日|今日|本日|来週|今週|再来週/g, '')
    .replace(/\d{1,2}月\d{1,2}日/g, '')
    .replace(/(午前|午後)?\s*\d{1,2}時(半|\d{1,2}分)?(\s*(から|〜|~|-)\s*(午前|午後)?\s*\d{1,2}時(半|\d{1,2}分)?)?/g, '')
    .replace(/(午前|午後)?\s*\d{1,2}:\d{2}/g, '')
    .replace(/(に|から|まで)/g, '')
    // 先頭に残る助詞・記号（の/へ/と/を/は/が や 句読点・空白）を除去
    .replace(/^[のへとをはが、,。．\s　]+/u, '')
    // 末尾の句読点・空白を除去
    .replace(/[、,。．\s　]+$/u, '')
    .trim();
  return cleaned.length > 0 ? cleaned : seg.trim();
}

/**
 * 音声文（1文）から予定タイトルを抽出する（日時表現・先頭助詞を除去）。
 * 例: 「明日の15時に歯医者」→「歯医者」 / 「6月20日14時に商品の納品」→「商品の納品」
 */
export function extractScheduleTitle(text: string): string {
  return makeScheduleTitle((text ?? '').toString().trim());
}

function mockExtractSchedules(text: string): ScheduleCandidate[] {
  const segments = text
    .split(/[。\n、]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const results: ScheduleCandidate[] = [];
  for (const seg of segments) {
    const date = parseDateFromText(seg);
    const { startTime, endTime } = parseTimeFromText(seg);
    const hasKeyword = SCHEDULE_KEYWORDS.some((k) => seg.includes(k));
    if (date || startTime || hasKeyword) {
      let confidence = 0.4;
      if (date) confidence += 0.3;
      if (startTime) confidence += 0.2;
      if (hasKeyword) confidence += 0.1;
      results.push({
        title: makeScheduleTitle(seg),
        date,
        startTime,
        endTime,
        confidence: Math.min(1, Math.round(confidence * 100) / 100),
      });
    }
  }
  return results;
}

/**
 * テキストから予定候補を抽出する。
 * scheduleExtractionSettings を参照（無効/mock/未設定/未対応は安全にフォールバック）。
 */
export async function extractSchedules(
  input: string,
  settings: AiSettings,
): Promise<ScheduleExtractionResult> {
  const text = (input ?? '').toString().trim();
  if (text.length === 0) {
    return { schedules: [], message: '予定抽出する文字がありません' };
  }

  const task = settings.scheduleExtractionSettings;

  // 無効時：mock 抽出にフォールバック
  if (task && task.enabled === false) {
    return {
      schedules: mockExtractSchedules(text),
      message: '予定抽出AIが無効です。mock抽出で処理します',
    };
  }

  const { mode, endpoint } = resolveConnection(task, settings);

  if (mode === 'user-api-key') {
    return {
      schedules: mockExtractSchedules(text),
      message: 'BYOK接続はSecureStore対応後に有効化予定です',
    };
  }

  if (mode === 'backend' || mode === 'local' || mode === 'custom') {
    if (endpoint.length === 0) {
      return { schedules: mockExtractSchedules(text), message: endpointNotSetMessage(mode) };
    }
    const res = await callBackend(task, settings, mode, endpoint, 'scheduleExtraction', {
      text,
      timezone: 'Asia/Tokyo',
    });
    if (!res.ok) {
      return {
        schedules: mockExtractSchedules(text),
        message: `${res.message ?? '運営APIに接続できませんでした'}（簡易抽出で処理しました）`,
      };
    }
    const env = unwrapEnvelope(res.data);
    if (!env.ok) {
      if (isRateLimitMessage(env.message)) {
        return { schedules: [], message: env.message, rateLimited: true };
      }
      return {
        schedules: mockExtractSchedules(text),
        message: `${env.message ?? '運営APIでエラーが発生しました'}（簡易抽出で処理しました）`,
      };
    }
    const obj = env.data;
    const rawSchedules = obj && Array.isArray(obj.schedules) ? obj.schedules : null;
    if (!rawSchedules) {
      return {
        schedules: mockExtractSchedules(text),
        message: '運営APIのレスポンス形式が正しくありません（簡易抽出で処理しました）',
      };
    }
    const schedules: ScheduleCandidate[] = rawSchedules.map((item) => {
      const s = asObject(item) ?? {};
      return {
        title: typeof s.title === 'string' ? s.title : '予定',
        date: typeof s.date === 'string' ? s.date : undefined,
        startTime: typeof s.startTime === 'string' ? s.startTime : undefined,
        endTime: typeof s.endTime === 'string' ? s.endTime : undefined,
        description: typeof s.description === 'string' ? s.description : undefined,
        location: typeof s.location === 'string' ? s.location : undefined,
        confidence: typeof s.confidence === 'number' ? s.confidence : undefined,
      };
    });
    return {
      schedules,
      message: typeof obj?.message === 'string' ? obj.message : '運営APIに接続しました',
    };
  }

  // mock
  const schedules = mockExtractSchedules(text);
  return {
    schedules,
    message: schedules.length === 0 ? '予定候補が見つかりませんでした' : undefined,
  };
}

// ── メモ分類（memoClassificationSettings 参照・構造化結果） ───────────────────

export interface MemoClassificationResult {
  category: string;
  tags: string[];
  priority?: 'low' | 'normal' | 'high';
  summary?: string;
  message?: string;
  rateLimited?: boolean;
}

const CATEGORY_RULES: { category: string; keywords: string[] }[] = [
  { category: '仕事', keywords: ['打ち合わせ', '打合せ', '会議', '資料', '仕事', '商談', 'プロジェクト', 'ミーティング'] },
  { category: '健康', keywords: ['病院', '体調', '薬', '健康', '通院', '診察'] },
  { category: '買い物', keywords: ['買う', '注文', '支払い', '購入', '買い物'] },
  { category: '予定', keywords: ['予定', '明日', '来週', '何時', '日時', '時から'] },
  { category: 'アイデア', keywords: ['アイデア', '思いついた', '企画', '改善'] },
  { category: '相談', keywords: ['悩み', '相談', '不安'] },
  { category: '学習', keywords: ['勉強', '学習', '講座'] },
  { category: '人間関係', keywords: ['家族', '友人', '友達', '人間関係'] },
];

const PRIORITY_HIGH = ['重要', '至急', '急ぎ', '締切', '今日中', 'やばい'];

function mockClassify(text: string): MemoClassificationResult {
  let category = 'その他';
  const matchedKeywords: string[] = [];
  for (const rule of CATEGORY_RULES) {
    const hits = rule.keywords.filter((k) => text.includes(k));
    if (hits.length > 0) {
      if (category === 'その他') category = rule.category;
      matchedKeywords.push(...hits);
    }
  }

  // タグ：マッチしたキーワード＋優先度語＋既存の自動タグ判定（重複排除）
  const tagSet: string[] = [];
  const pushTag = (t: string) => {
    if (t.length > 0 && !tagSet.includes(t)) tagSet.push(t);
  };
  matchedKeywords.forEach(pushTag);
  PRIORITY_HIGH.forEach((k) => {
    if (text.includes(k)) pushTag(k);
  });
  suggestTags(text).forEach(pushTag);

  const priority: MemoClassificationResult['priority'] = PRIORITY_HIGH.some((k) =>
    text.includes(k),
  )
    ? 'high'
    : 'normal';

  return {
    category,
    tags: tagSet.slice(0, 6),
    priority,
    summary: mockSummarizeText(text),
  };
}

/**
 * メモ内容を分類しタグ候補を返す。
 * memoClassificationSettings を参照（無効/mock/未設定/未対応は安全にフォールバック）。
 */
export async function classifyMemo(
  input: string,
  settings: AiSettings,
): Promise<MemoClassificationResult> {
  const text = (input ?? '').toString().trim();
  if (text.length === 0) {
    return { category: 'その他', tags: [], message: '分類する文字がありません' };
  }

  const task = settings.memoClassificationSettings;

  if (task && task.enabled === false) {
    return { ...mockClassify(text), message: 'メモ分類AIが無効です。簡易分類で処理します' };
  }

  const { mode, endpoint } = resolveConnection(task, settings);

  if (mode === 'user-api-key') {
    return { ...mockClassify(text), message: 'BYOK接続はSecureStore対応後に有効化予定です' };
  }

  if (mode === 'backend' || mode === 'local' || mode === 'custom') {
    if (endpoint.length === 0) {
      return { ...mockClassify(text), message: endpointNotSetMessage(mode) };
    }
    const res = await callBackend(task, settings, mode, endpoint, 'memoClassification', { text });
    if (!res.ok) {
      return {
        ...mockClassify(text),
        message: `${res.message ?? '運営APIに接続できませんでした'}（簡易分類で処理しました）`,
      };
    }
    const env = unwrapEnvelope(res.data);
    if (!env.ok) {
      if (isRateLimitMessage(env.message)) {
        return { category: 'その他', tags: [], message: env.message, rateLimited: true };
      }
      return {
        ...mockClassify(text),
        message: `${env.message ?? '運営APIでエラーが発生しました'}（簡易分類で処理しました）`,
      };
    }
    const obj = env.data;
    if (!obj || typeof obj.category !== 'string') {
      return {
        ...mockClassify(text),
        message: '運営APIのレスポンス形式が正しくありません（簡易分類で処理しました）',
      };
    }
    const priority =
      obj.priority === 'low' || obj.priority === 'normal' || obj.priority === 'high'
        ? obj.priority
        : undefined;
    return {
      category: obj.category,
      tags: asStringArray(obj.tags),
      priority,
      summary: typeof obj.summary === 'string' ? obj.summary : undefined,
      message: typeof obj.message === 'string' ? obj.message : '運営APIに接続しました',
    };
  }

  return mockClassify(text);
}

// ── クライアント生成 ────────────────────────────────────────────────────────

export interface AiClient {
  summarizeText: (input: string) => Promise<AiClientResult>;
  chatWithAi: (request: ChatRequest) => Promise<ChatResult>;
  extractScheduleFromText: (input: string) => Promise<AiClientResult>;
  classifyMemo: (input: string) => Promise<MemoClassificationResult>;
}

export function createAiClient(settings: AiSettings): AiClient {
  return {
    summarizeText: (input) => summarizeText(input, settings),
    chatWithAi: (request) => chatWithAi(request, settings),
    extractScheduleFromText: (input) => extractScheduleFromText(input, settings),
    classifyMemo: (input) => classifyMemo(input, settings),
  };
}

// ── 接続テスト（実接続はせず、設定内容に応じた安全な案内を返す） ──────────────

export function testAiConnection(settings: AiSettings): string {
  switch (settings.connectionMode) {
    case 'mock':
      return 'mock方式です。AI接続なしで動作確認できます。';
    case 'backend': {
      const endpoint = trimOrEmpty(settings.backendEndpoint);
      return endpoint.length === 0
        ? '運営APIエンドポイントが未設定です。'
        : `運営API設定OK（${endpoint}）。実接続は今後対応予定です。`;
    }
    case 'user-api-key':
      return 'BYOK接続はSecureStore対応後に有効化予定です。';
    case 'local': {
      const endpoint = trimOrEmpty(settings.localEndpoint);
      return endpoint.length === 0
        ? 'ローカルAIエンドポイントが未設定です。'
        : `ローカルAI設定OK（${endpoint}）。実接続は今後対応予定です。`;
    }
    case 'custom': {
      const endpoint = trimOrEmpty(settings.customApiEndpoint);
      return endpoint.length === 0
        ? 'Custom APIエンドポイントが未設定です。'
        : `Custom API設定OK（${endpoint}）。実接続は今後対応予定です。`;
    }
    default:
      return 'mock方式にフォールバックします。';
  }
}

// 実接続テスト（backend/local/custom は endpoint へテスト POST する）
function connectionTestPayload(settings: AiSettings) {
  return {
    task: 'connectionTest',
    provider: 'mock',
    model: '',
    language: settings.transcriptionLanguage ?? 'ja-JP',
    input: { message: 'connection test' },
    metadata: { app: 'ai-iphone', timestamp: new Date().toISOString() },
  };
}

async function testRemote(mode: RemoteMode, endpoint: string, settings: AiSettings): Promise<string> {
  if (endpoint.length === 0) return endpointNotSetMessage(mode);
  const res = await postToBackendAi(endpoint, connectionTestPayload(settings));
  if (res.ok) {
    const env = unwrapEnvelope(res.data);
    if (!env.ok && isRateLimitMessage(env.message)) {
      return '運営APIには接続できましたが、利用上限に達しています。';
    }
    return `運営APIに接続できました\nendpoint: ${endpoint}\ntask: connectionTest`;
  }
  return [
    res.message ?? '運営APIに接続できませんでした',
    'endpointを確認してください',
    '実機の場合はPCのLAN IPを使ってください',
    'Windowsファイアウォールでポート8787が許可されているか確認してください',
  ].join('\n');
}

// ── Ollama（ローカルAI）接続テスト ───────────────────────────────────────────

// 末尾スラッシュ・/api/* を除いて origin を取り出す
function normalizeOllamaBase(endpoint: string): string {
  let url = endpoint.trim().replace(/\/+$/, '');
  url = url.replace(/\/api(\/.*)?$/, ''); // .../api や .../api/generate を除去
  return url;
}

/**
 * Ollama へ GET /api/tags してモデル一覧を確認する接続テスト。
 * - モデル指定があり一覧に存在 → 接続成功＆モデル確認
 * - 一覧にモデルが無い → 接続はできたがモデル未検出
 * - 取得失敗 → 接続不可（Web の CORS は専用案内）
 * 例外安全（throw しない）。
 */
export async function testOllamaConnection(endpoint: string, model: string): Promise<string> {
  const base = normalizeOllamaBase(endpoint);
  if (base.length === 0) return 'ローカルAIエンドポイントが未設定です。';

  const url = `${base}/api/tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return `Ollamaに接続できませんでした（HTTP ${res.status}）。エンドポイントをご確認ください。`;
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      return 'Ollamaの応答を解析できませんでした。エンドポイントをご確認ください。';
    }
    const obj = asObject(data);
    const models = obj && Array.isArray(obj.models) ? obj.models : [];
    const names = models
      .map((m) => {
        const mo = asObject(m);
        return mo && typeof mo.name === 'string' ? mo.name : '';
      })
      .filter((n) => n.length > 0);

    const wanted = trimOrEmpty(model);
    if (wanted.length > 0) {
      // 完全一致、または ":latest" 省略・前方一致を許容
      const found = names.some(
        (n) => n === wanted || n === `${wanted}:latest` || n.split(':')[0] === wanted.split(':')[0],
      );
      if (found) {
        return `Ollamaに接続できました。モデル「${wanted}」が利用可能です（モデル数: ${names.length}）。`;
      }
      return `Ollamaには接続できましたが、指定モデル「${wanted}」が見つかりません。\n利用可能: ${names.slice(0, 10).join(', ') || '（なし）'}`;
    }
    return `Ollamaに接続できました（利用可能モデル数: ${names.length}）。\n${names.slice(0, 10).join(', ')}`;
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === 'AbortError') {
      return 'Ollamaへの接続がタイムアウトしました。エンドポイントをご確認ください。';
    }
    // Web のブラウザからの別オリジン fetch は CORS で失敗しやすい
    if (Platform.OS === 'web') {
      return 'ブラウザからOllamaへ直接接続できません。バックエンド経由、またはLAN IP設定（OLLAMA_ORIGINS の許可）が必要です。';
    }
    return 'Ollamaに接続できませんでした。Ollamaの起動とエンドポイント（例 http://（PCのLAN IP）:11434）をご確認ください。';
  }
}

// 全体設定の接続テスト（async・backend等は実POST。local は Ollama 専用）
export async function testAiConnectionAsync(settings: AiSettings): Promise<string> {
  switch (settings.connectionMode) {
    case 'mock':
      return 'mock方式です。AI接続なしで動作確認できます。';
    case 'user-api-key':
      return 'BYOK接続はSecureStore対応後に有効化予定です。';
    case 'backend':
      return testRemote('backend', trimOrEmpty(settings.backendEndpoint), settings);
    case 'local':
      // ローカルAI（Ollama）専用テスト：GET /api/tags でモデル確認
      return testOllamaConnection(
        trimOrEmpty(settings.localEndpoint),
        trimOrEmpty(settings.selectedModel),
      );
    case 'custom':
      return testRemote('custom', trimOrEmpty(settings.customApiEndpoint), settings);
    default:
      return 'mock方式にフォールバックします。';
  }
}

// 機能別設定の接続テスト（async・backend等は実POST）
export async function testTaskConnectionAsync(
  task: AiTaskProviderSettings,
  settings: AiSettings,
): Promise<string> {
  if (!task.enabled) return '無効化中です（mock にフォールバックします）。';
  const { mode, endpoint, model } = resolveConnection(task, settings);
  switch (mode) {
    case 'mock':
      return '簡易AIで動作しています';
    case 'user-api-key':
      return 'BYOK接続はSecureStore対応後に有効化予定です';
    case 'local':
      // ローカルAI（Ollama）専用テスト
      return testOllamaConnection(endpoint, model || trimOrEmpty(settings.selectedModel));
    case 'backend':
    case 'custom':
      return testRemote(mode, endpoint, settings);
    default:
      return '簡易AIで動作しています';
  }
}

// 機能別設定の接続テスト（実接続せず、設定内容に応じた安全な案内を返す）
export function testTaskConnection(task: AiTaskProviderSettings, settings: AiSettings): string {
  if (!task.enabled) return '無効化中です（mock にフォールバックします）。';
  const { mode, endpoint } = resolveConnection(task, settings);
  switch (mode) {
    case 'mock':
      return '簡易AIで動作しています';
    case 'backend':
      return endpoint.length === 0
        ? '運営APIエンドポイントが未設定です'
        : `運営API設定OK（${endpoint}）。実接続は今後対応予定です。`;
    case 'user-api-key':
      return 'BYOK接続はSecureStore対応後に有効化予定です';
    case 'local':
      return endpoint.length === 0
        ? 'ローカルAIエンドポイントが未設定です'
        : `ローカルAI設定OK（${endpoint}）。実接続は今後対応予定です。`;
    case 'custom':
      return endpoint.length === 0
        ? 'Custom APIエンドポイントが未設定です'
        : `Custom API設定OK（${endpoint}）。実接続は今後対応予定です。`;
    default:
      return '簡易AIで動作しています';
  }
}
