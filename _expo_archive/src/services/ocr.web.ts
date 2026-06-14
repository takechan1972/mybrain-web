import type { OcrResult } from './ocr-types';

/**
 * OCR（Web 向け実装：tesseract.js・日本語 jpn）。
 * - ユーザーが「画像から文字起こし」を押した時のみ呼ばれる（自動実行しない）
 * - 画像本体・抽出全文はログに出さない
 * - 将来 OpenAI Vision / Google Vision / Gemini Vision に差し替え可能なよう、
 *   入力=画像URI / 出力=OcrResult のシンプルなシグネチャに統一している
 */

export function isOcrSupported(): boolean {
  return typeof window !== 'undefined';
}

export async function runOcr(uri: string): Promise<OcrResult> {
  if (!isOcrSupported()) return { ok: false, reason: 'unsupported' };
  try {
    // 動的importでバンドルを必要時のみ読み込む
    const Tesseract = await import('tesseract.js');
    const result = await Tesseract.recognize(uri, 'jpn');
    const text = (result?.data?.text ?? '').replace(/\s+\n/g, '\n').trim();
    if (text.length === 0) return { ok: false, reason: 'empty' };
    return { ok: true, text };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export type { OcrResult };
