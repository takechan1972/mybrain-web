import { cacheDirectory, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * バックアップファイルの保存・共有（Web=ダウンロード / ネイティブ=共有シート）。
 *
 * セキュリティ: 呼び出し側が APIキー本体等を content に含めない前提
 * （本アプリはキーを保持しない）。
 */

export interface SaveFileInput {
  filename: string;
  content: string;
  mimeType: string;
}

export interface SaveFileResult {
  ok: boolean;
  message: string;
}

// Web: Blob + download link（既存挙動を踏襲）
function downloadWeb(input: SaveFileInput): SaveFileResult {
  try {
    const blob = new Blob([input.content], { type: input.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = input.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true, message: 'ファイルを保存しました' };
  } catch {
    return { ok: false, message: 'ファイルの作成に失敗しました' };
  }
}

// ネイティブ: 一時保存 → 共有シート
async function shareNative(input: SaveFileInput): Promise<SaveFileResult> {
  const dir = cacheDirectory;
  if (!dir) {
    return { ok: false, message: 'ファイルの作成に失敗しました' };
  }
  const fileUri = `${dir}${input.filename}`;
  try {
    await writeAsStringAsync(fileUri, input.content);
  } catch {
    return { ok: false, message: 'ファイルの作成に失敗しました' };
  }

  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { ok: false, message: 'この端末では共有機能を利用できません' };
    }
    await Sharing.shareAsync(fileUri, {
      mimeType: input.mimeType,
      dialogTitle: input.filename,
    });
    return { ok: true, message: 'ファイルを共有しました' };
  } catch {
    // 共有キャンセルや失敗。落とさず案内。
    return { ok: false, message: 'ファイル共有に失敗しました' };
  }
}

/**
 * Web はダウンロード、ネイティブは共有シート。例外安全。
 */
export async function saveOrShareFile(input: SaveFileInput): Promise<SaveFileResult> {
  if (!input.filename || input.content.length === 0) {
    return { ok: false, message: 'ファイルの作成に失敗しました' };
  }
  if (Platform.OS === 'web') {
    return downloadWeb(input);
  }
  return shareNative(input);
}
