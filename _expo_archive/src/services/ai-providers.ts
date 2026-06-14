import type { AiSettings } from './ai-settings';
import { mockSummarizeText, mockTranscribeAudio } from './voice-memo';
import type { Memo, Reservation } from '../store/app-data';

/**
 * AI 処理の差し替え用ラッパー。
 *
 * 画面から AI 処理を直書きせず、必ずこの層を経由する。
 * 設定値（AiSettings）を見て実装を切り替える土台。
 * 今回は mock のみ実装し、それ以外は { ok: false, reason: 'unsupported' } を返す。
 *
 * 将来:
 *   transcribeAudio(uri, settings) → 各文字起こしAPIへ
 *   summarizeText(text, settings)  → 各要約AIへ
 *   chatWithAI(message, ctx, settings) → 各チャットAIへ
 */

export type AiResult<T> = { ok: true; value: T } | { ok: false; reason: 'unsupported' };

const UNSUPPORTED: AiResult<never> = { ok: false, reason: 'unsupported' };

// ── 文字起こし ──────────────────────────────────────────────────────────────

export async function transcribeAudio(
  uri: string | null,
  settings: AiSettings,
): Promise<AiResult<string>> {
  if (settings.transcriptionProvider === 'mock') {
    // uri は将来 API に渡す。mock では未使用。
    void uri;
    return { ok: true, value: await mockTranscribeAudio() };
  }
  return UNSUPPORTED;
}

// ── Web Speech API（ブラウザのリアルタイム音声認識・無料・Web 専用） ──────────
//
// 注意: これは録音ファイル URI を文字起こしする仕組みではなく、
//       マイク入力をその場で認識する「リアルタイム認識」。
//       将来の Whisper 用 transcribeAudio(uri, settings) とは別系統。

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike extends ArrayLike<SpeechRecognitionAlternativeLike> {
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebSpeechSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export interface WebSpeechHandlers {
  /** 認識テキスト（確定＋暫定）が更新されるたびに呼ばれる */
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
  lang?: string;
}

export interface WebSpeechController {
  stop: () => void;
}

/**
 * ブラウザのリアルタイム音声認識を開始する。
 * 対応していない環境では null を返す。
 */
export function startWebSpeechRecognition(handlers: WebSpeechHandlers): WebSpeechController | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = handlers.lang ?? 'ja-JP';
  recognition.continuous = true;
  recognition.interimResults = true;

  let finalText = '';

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) {
        finalText += text;
      } else {
        interim += text;
      }
    }
    handlers.onTranscript(finalText + interim);
  };
  recognition.onerror = (event) => {
    handlers.onError?.(event.error ?? '音声認識でエラーが発生しました。');
  };
  recognition.onend = () => {
    handlers.onEnd?.();
  };

  recognition.start();
  return { stop: () => recognition.stop() };
}

// ── 要約 ────────────────────────────────────────────────────────────────────

export function summarizeText(text: string, settings: AiSettings): AiResult<string> {
  if (settings.summaryProvider === 'mock') {
    return { ok: true, value: mockSummarizeText(text) };
  }
  return UNSUPPORTED;
}

// ── チャット ────────────────────────────────────────────────────────────────

export interface ChatContext {
  memos: Memo[];
  reservations: Reservation[];
}

export async function chatWithAI(
  message: string,
  context: ChatContext,
  settings: AiSettings,
): Promise<AiResult<string>> {
  if (settings.provider === 'mock') {
    return { ok: true, value: buildMockReply(message, context.memos, context.reservations) };
  }
  return UNSUPPORTED;
}

// ── 以下、mock チャット応答ロジック（旧 chat.tsx から移設） ───────────────────

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function reservationDateKey(datetime: string): string | null {
  const datePart = datetime.trim().split(/[ T]/)[0];
  const d = new Date(datePart);
  if (Number.isNaN(d.getTime())) return null;
  return ymd(d);
}

function formatList(items: Reservation[]): string {
  const brief = (s: string) => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    return t.length === 0 ? '内容なし' : t.length > 20 ? `${t.slice(0, 20)}…` : t;
  };
  return items
    .slice(0, 5)
    .map((r) => `・${r.datetime || '日時未定'} ${r.name}（${brief(r.content || r.note)}）`)
    .join('\n');
}

export function buildMockChatReply(
  input: string,
  memos: Memo[],
  reservations: Reservation[],
): string {
  return buildMockReply(input, memos, reservations);
}

// メモ本文を参照用に短く要約（先頭の一文または40文字程度。丸写ししない）
function summarizeForRef(body: string): string {
  const text = (body ?? '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return '（本文なし）';
  const firstSentence = text.split(/[。．.!?！？\n]/)[0]?.trim() ?? text;
  const base = firstSentence.length > 0 ? firstSentence : text;
  return base.length > 40 ? `${base.slice(0, 40)}…` : base;
}

function buildMockReply(input: string, memos: Memo[], reservations: Reservation[]): string {
  const q = input.toLowerCase();

  if (q.includes('メモ') || q.includes('memo')) {
    if (memos.length === 0) return 'まだメモは登録されていません。';
    const titles = memos.slice(0, 3).map((m) => `・${m.title}`).join('\n');
    return `現在 ${memos.length} 件のメモがあります。\n${titles}`;
  }

  if (q.includes('今日') && q.includes('予定')) {
    const todayKey = ymd(new Date());
    const items = reservations.filter((r) => reservationDateKey(r.datetime) === todayKey);
    if (items.length === 0) return '今日の予定はありません。';
    return `今日の予定は ${items.length} 件です。\n${formatList(items)}`;
  }

  if (q.includes('明日') && q.includes('予定')) {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    const tomorrowKey = ymd(t);
    const items = reservations.filter((r) => reservationDateKey(r.datetime) === tomorrowKey);
    if (items.length === 0) return '明日の予定はありません。';
    return `明日の予定は ${items.length} 件です。\n${formatList(items)}`;
  }

  if (q.includes('今週') && q.includes('予定')) {
    const now = new Date();
    const start = ymd(now);
    const end = new Date(now);
    end.setDate(end.getDate() + (7 - (now.getDay() === 0 ? 7 : now.getDay())));
    const endKey = ymd(end);
    const items = reservations.filter((r) => {
      const k = reservationDateKey(r.datetime);
      return k !== null && k >= start && k <= endKey;
    });
    if (items.length === 0) return '今週の予定はありません。';
    return `今週の予定は ${items.length} 件です。\n${formatList(items)}`;
  }

  if (q.includes('予定') || q.includes('予約') || q.includes('空い')) {
    if (reservations.length === 0) return 'まだ予定は登録されていません。';
    return `予約情報によると、関連する予約は ${reservations.length} 件です。\n${formatList(reservations)}\n\n上記を参考に、空き時間や次回予約などをご確認ください。`;
  }

  // 関連メモがある場合：メモを参考にした回答（要約のみ・丸写ししない）
  if (memos.length > 0) {
    const refs = memos.slice(0, 3);
    const summarized = refs
      .map((m) => `・${m.title || '無題のメモ'}：${summarizeForRef(m.body)}`)
      .join('\n');
    const extra =
      reservations.length > 0
        ? `\n\n予約情報によると、関連する予約も ${reservations.length} 件あります。\n${formatList(reservations)}`
        : '';
    return [
      'ご相談の件、登録メモを参考にお答えします。',
      'メモによると、以下の情報がありました。',
      summarized,
      '',
      'これらを踏まえて整理しました。さらに具体化したい場合は、目的や宛先などを教えてください。',
    ].join('\n') + extra;
  }

  // メモは無いが関連予約がある場合：予約を参考にした回答
  if (reservations.length > 0) {
    return [
      'ご相談の件、登録予定を参考にお答えします。',
      `予約情報によると、関連する予約は ${reservations.length} 件です。`,
      formatList(reservations),
      '',
      '上記を踏まえ、空き時間や次回予約のご確認にお役立てください。',
    ].join('\n');
  }

  return `「${input}」について承知しました。（これは仮のAI返信です）\n関連する登録メモ・予約は見つかりませんでした。「メモ」「予定」「今日の予定」などと聞くこともできます。`;
}
