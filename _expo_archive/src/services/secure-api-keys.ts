import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * BYOK APIキーの安全な保存（ネイティブのみ SecureStore）。
 *
 * セキュリティ:
 *  - Web では一切保存しない（localStorage/AsyncStorage にも入れない）
 *  - APIキー本体は設定/データバックアップ・CSV に含めない
 *  - 画面へは保存済みかどうかのみを返す（本体は再表示用途に使わない方針）
 */

export type ApiKeyProvider = 'openai' | 'anthropic' | 'gemini' | 'custom';

const KEY_NAMES: Record<ApiKeyProvider, string> = {
  openai: 'AI_IPHONE_API_KEY_OPENAI',
  anthropic: 'AI_IPHONE_API_KEY_ANTHROPIC',
  gemini: 'AI_IPHONE_API_KEY_GEMINI',
  custom: 'AI_IPHONE_API_KEY_CUSTOM',
};

const WEB_MESSAGE =
  'Web版では安全性のためAPIキーを保存しません。ネイティブ版でSecureStore保存に対応します。';
const UNAVAILABLE_MESSAGE = 'この端末ではSecureStoreを利用できません';

const MIN_KEY_LENGTH = 8;

export async function isSecureApiKeyAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function saveApiKey(
  provider: ApiKeyProvider,
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  if (Platform.OS === 'web') {
    return { ok: false, message: WEB_MESSAGE };
  }
  const value = (apiKey ?? '').trim();
  if (value.length === 0) {
    return { ok: false, message: 'APIキーを入力してください' };
  }
  if (value.length < MIN_KEY_LENGTH) {
    return { ok: false, message: 'APIキーが短すぎます。内容をご確認ください' };
  }
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return { ok: false, message: UNAVAILABLE_MESSAGE };
    }
    await SecureStore.setItemAsync(KEY_NAMES[provider], value);
    return { ok: true, message: 'APIキーをSecureStoreに保存しました' };
  } catch {
    return { ok: false, message: 'APIキーの保存に失敗しました' };
  }
}

export async function getApiKey(
  provider: ApiKeyProvider,
): Promise<{ ok: boolean; apiKey?: string; message?: string }> {
  if (Platform.OS === 'web') {
    return { ok: false, message: WEB_MESSAGE };
  }
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return { ok: false, message: UNAVAILABLE_MESSAGE };
    }
    const apiKey = await SecureStore.getItemAsync(KEY_NAMES[provider]);
    if (apiKey == null) {
      return { ok: false, message: 'BYOK APIキーが保存されていません' };
    }
    return { ok: true, apiKey };
  } catch {
    return { ok: false, message: 'APIキーの読み込みに失敗しました' };
  }
}

export async function deleteApiKey(
  provider: ApiKeyProvider,
): Promise<{ ok: boolean; message: string }> {
  if (Platform.OS === 'web') {
    return { ok: false, message: WEB_MESSAGE };
  }
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return { ok: false, message: UNAVAILABLE_MESSAGE };
    }
    await SecureStore.deleteItemAsync(KEY_NAMES[provider]);
    return { ok: true, message: 'APIキーを削除しました' };
  } catch {
    return { ok: false, message: 'APIキーの削除に失敗しました' };
  }
}

export async function hasApiKey(provider: ApiKeyProvider): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    if (!(await SecureStore.isAvailableAsync())) return false;
    const v = await SecureStore.getItemAsync(KEY_NAMES[provider]);
    return v != null;
  } catch {
    return false;
  }
}
