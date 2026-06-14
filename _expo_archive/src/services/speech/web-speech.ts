import type { SpeechController, SpeechOptions } from './types';

/**
 * Web 用音声認識（ブラウザの Web Speech API）。
 * iOS/Android ネイティブには window が無いため未対応（isSpeechSupported=false）。
 */

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0?: { transcript?: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
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

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechSupported(): boolean {
  return getCtor() !== null;
}

export function startSpeechRecognition(options: SpeechOptions): SpeechController | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  // 無音による自動終了（onend）でも、ユーザーが「停止」を押すまで自動再開する。
  // 取得済みテキストは accumulated に蓄積して破棄しない。
  let manualStop = false;
  let accumulated = '';
  let current: SpeechRecognitionInstance | null = null;

  function startSession(): boolean {
    const recognition = new Ctor!();
    recognition.lang = options.lang ?? 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;

    let sessionFinal = '';
    recognition.onresult = (event) => {
      // このセッション分の確定/暫定を毎回先頭から再計算（二重加算を防ぐ）
      let interim = '';
      sessionFinal = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) sessionFinal += text;
        else interim += text;
      }
      options.onResult(accumulated + sessionFinal + interim);
    };
    recognition.onerror = (event) => {
      const err = event?.error ?? '';
      // 権限・マイク系の致命的エラーは終了（再開しない）
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        manualStop = true;
        options.onError?.();
      }
      // no-speech / aborted などは onend 側の自動再開に任せる
    };
    recognition.onend = () => {
      // セッション終了：確定分を蓄積に反映
      accumulated += sessionFinal;
      if (manualStop) {
        options.onEnd?.();
        return;
      }
      // 無音などによる自動終了 → 手動停止まで継続するため再開
      if (!startSession()) {
        options.onEnd?.();
      }
    };

    try {
      recognition.start();
    } catch {
      return false;
    }
    current = recognition;
    return true;
  }

  if (!startSession()) return null;

  return {
    stop: () => {
      manualStop = true;
      current?.stop();
    },
  };
}

export function stopSpeechRecognition(controller: SpeechController | null): void {
  controller?.stop();
}
