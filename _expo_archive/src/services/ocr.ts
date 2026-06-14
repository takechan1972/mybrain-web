import type { OcrResult } from './ocr-types';

/**
 * OCR（端末向けスタブ）。
 * iOS/Android では現状未対応（将来 OpenAI Vision / Google Vision / Gemini Vision に差し替え）。
 * Web では ocr.web.ts（tesseract.js）に解決される。
 */
export function isOcrSupported(): boolean {
  return false;
}

export async function runOcr(_uri: string): Promise<OcrResult> {
  void _uri;
  return { ok: false, reason: 'unsupported' };
}

export type { OcrResult };
