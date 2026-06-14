/**
 * 共通音声認識APIの型。
 * 認識結果(onResult)は呼び出し側で扱う。ここでは console へ全文出力しない。
 * onError は内部エラー詳細を渡さない（呼び出し側はユーザー向け定型文を表示）。
 */
export interface SpeechOptions {
  lang?: string;
  onResult: (text: string) => void;
  onError?: () => void;
  onEnd?: () => void;
}

export interface SpeechController {
  stop: () => void;
}
