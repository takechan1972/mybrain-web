/**
 * OCR（画像内テキスト抽出）の共通型。
 * Web は tesseract.js（日本語 jpn）、端末は当面未対応（将来 Vision API へ差し替え）。
 */
export type OcrResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'unsupported' | 'failed' | 'empty' };
