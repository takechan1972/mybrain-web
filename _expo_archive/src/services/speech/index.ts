import { Platform } from 'react-native';

import * as nativeImpl from './native-speech';
import * as webImpl from './web-speech';

/**
 * 共通音声認識API。
 * - Web: window.SpeechRecognition（既存のWeb Speech）
 * - iOS/Android: expo-speech-recognition（端末標準認識）
 * - 非対応: isSpeechSupported() が false / startSpeechRecognition() が null を返す → 手入力へ
 *
 * メモ/予定フォームはこの共通APIだけを呼ぶ。
 * （Web では native-speech は native-speech.web.ts スタブに解決され、expo依存をバンドルしない）
 */
const impl = Platform.OS === 'web' ? webImpl : nativeImpl;

export const isSpeechSupported = impl.isSpeechSupported;
export const startSpeechRecognition = impl.startSpeechRecognition;
export const stopSpeechRecognition = impl.stopSpeechRecognition;

export type { SpeechOptions, SpeechController } from './types';
