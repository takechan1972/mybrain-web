import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/**
 * CSV ファイル選択（Web=input / ネイティブ=expo-document-picker）。
 *
 * - UTF-8 を基本対応。BOM は除去。
 * - TODO: Excel 由来の Shift_JIS CSV 対応は将来検討。
 * - 例外安全（落とさない）。
 */

export interface PickCsvResult {
  ok: boolean;
  text?: string;
  filename?: string;
  message?: string;
  canceled?: boolean;
}

function stripBom(text: string): string {
  return text.replace(/^﻿/, '');
}

// Web: input[type=file]
function pickCsvWeb(): Promise<PickCsvResult> {
  return new Promise((resolve) => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'text/csv,.csv';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ ok: false, canceled: true, message: 'CSVインポートをキャンセルしました' });
          return;
        }
        const reader = new FileReader();
        reader.onload = () =>
          resolve(
            typeof reader.result === 'string'
              ? { ok: true, text: stripBom(reader.result), filename: file.name }
              : { ok: false, message: 'CSVファイルの読み込みに失敗しました' },
          );
        reader.onerror = () => resolve({ ok: false, message: 'CSVファイルの読み込みに失敗しました' });
        reader.readAsText(file);
      };
      input.click();
    } catch {
      resolve({ ok: false, message: 'CSVファイルの読み込みに失敗しました' });
    }
  });
}

// ネイティブ: expo-document-picker + expo-file-system
async function pickCsvNative(): Promise<PickCsvResult> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) {
      return { ok: false, canceled: true, message: 'CSVインポートをキャンセルしました' };
    }
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return { ok: false, message: 'CSVファイルを選択してください' };
    }
    try {
      const raw = await readAsStringAsync(asset.uri);
      return { ok: true, text: stripBom(raw), filename: asset.name };
    } catch {
      return { ok: false, message: 'CSVファイルの読み込みに失敗しました' };
    }
  } catch {
    return { ok: false, message: 'CSVファイルの読み込みに失敗しました' };
  }
}

export async function pickCsvFile(): Promise<PickCsvResult> {
  return Platform.OS === 'web' ? pickCsvWeb() : pickCsvNative();
}
