import { ollamaChat, loadOllamaSettings } from './ollama';

/**
 * 保存済みメモ本文を Ollama で要約・整理する（PCローカル専用）。
 * 既存の lib/ai/ollama.ts（ollamaChat / loadOllamaSettings）を共通利用する。
 */

export type MemoAiKind = 'summary' | 'organize';

const PROMPTS: Record<MemoAiKind, string> = {
  summary:
    '以下の文字起こしメモを、重要な内容を残して短く要約してください。箇条書きで3〜7個にまとめてください。',
  organize:
    '以下の文字起こしメモを、見出し、要点、タスク、重要メモに分けて整理してください。タスクがなければ「タスクなし」と書いてください。',
};

/**
 * メモ本文を AI 処理して結果テキストを返す。
 * - Ollama 無効/未設定/接続不可の場合は例外を投げる（呼び出し側で日本語表示）。
 */
export async function runMemoAi(kind: MemoAiKind, body: string): Promise<string> {
  const settings = loadOllamaSettings();
  if (!settings.enabled) {
    throw new Error('Ollama接続を確認してください');
  }
  const system =
    'あなたは日本語のノート整理アシスタントです。与えられたメモ本文だけを根拠に、' +
    '簡潔で読みやすい日本語で出力してください。本文に無い情報は作らないでください。';
  const user = `${PROMPTS[kind]}\n\n# メモ本文\n${body}`;

  const result = await ollamaChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    settings,
  );
  const trimmed = result.trim();
  if (trimmed.length === 0) {
    throw new Error('Ollama接続を確認してください');
  }
  return trimmed;
}
