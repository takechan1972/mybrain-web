import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import type { SpeechController, SpeechOptions } from './types';

/**
 * iOS / Android 用音声認識（expo-speech-recognition / 端末標準認識）。
 * - 端末内で処理（アプリが独自に音声を外部送信しない）
 * - 認識結果を console へ全文出力しない
 * - APIキー/token は扱わない
 * - Expo Go では動作しない（development / preview build が必要）
 */

export function isSpeechSupported(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export function startSpeechRecognition(options: SpeechOptions): SpeechController | null {
  try {
    // 無音による自動終了でも、ユーザーが「停止」を押すまで自動再開する。
    // 取得済みテキストは accumulated に蓄積して破棄しない。
    let manualStop = false;
    let accumulated = '';
    let sessionText = '';

    const subs = [
      ExpoSpeechRecognitionModule.addListener('result', (e) => {
        sessionText = e?.results?.[0]?.transcript ?? '';
        options.onResult(accumulated + sessionText);
      }),
      ExpoSpeechRecognitionModule.addListener('error', () => {
        // 致命的かどうかに関わらず、ここでは onError を通知（再開は end 側で判断）
        options.onError?.();
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        // セッション終了：確定分を蓄積に反映
        accumulated += sessionText;
        sessionText = '';
        if (manualStop) {
          options.onEnd?.();
          cleanup();
          return;
        }
        // 無音などによる自動終了 → 手動停止まで継続するため再開
        startSession();
      }),
    ];
    const cleanup = () => {
      for (const s of subs) {
        try {
          s.remove();
        } catch {
          // 無視
        }
      }
    };

    const startSession = () => {
      try {
        ExpoSpeechRecognitionModule.start({
          lang: options.lang ?? 'ja-JP',
          interimResults: true,
          continuous: true,
        });
      } catch {
        options.onError?.();
        cleanup();
      }
    };

    // マイク/音声認識の権限を取得してから開始
    ExpoSpeechRecognitionModule.requestPermissionsAsync()
      .then((perm) => {
        if (!perm.granted) {
          options.onError?.();
          cleanup();
          return;
        }
        startSession();
      })
      .catch(() => {
        options.onError?.();
        cleanup();
      });

    return {
      stop: () => {
        manualStop = true;
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          // 無視
        }
      },
    };
  } catch {
    return null;
  }
}

export function stopSpeechRecognition(controller: SpeechController | null): void {
  controller?.stop();
}
