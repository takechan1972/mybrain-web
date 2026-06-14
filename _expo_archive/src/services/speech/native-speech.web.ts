/**
 * Web ビルド用のスタブ。
 * Web では expo-speech-recognition を読み込まないよう、native-speech をこのファイルに解決させ、
 * 実体は Web Speech 実装へ委譲する（index.ts は Web では web-speech を使うため通常未使用）。
 */
export { isSpeechSupported, startSpeechRecognition, stopSpeechRecognition } from './web-speech';
