import { Platform } from 'react-native';

import {
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  saveAiSettings,
  type AiSettings,
} from './ai-settings';
import { saveOrShareFile } from './file-download';

/**
 * AI設定のバックアップ（エクスポート / インポート / 初期化）。
 *
 * セキュリティ:
 *  - APIキー本体は一切含めない（そもそも保存していない）
 *  - apiKeyStored は復元時に false へ
 *  - localStorage / バックアップJSON にキーを書き込まない
 */

export const BACKUP_TYPE = 'AI_IPHONE_SETTINGS_BACKUP';
export const BACKUP_VERSION = 1;

export interface SettingsBackup {
  type: typeof BACKUP_TYPE;
  version: number;
  exportedAt: string;
  settings: AiSettings;
}

// エクスポート対象を組み立てる（APIキー本体は元々持たないため安全）
function buildBackup(settings: AiSettings): SettingsBackup {
  return {
    type: BACKUP_TYPE,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      ...settings,
      // 念のため：キー保存フラグは true でもエクスポートしない方針に合わせて落とす
      apiKeyStored: false,
    },
  };
}

function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/**
 * 設定をエクスポート。
 * Web: JSON ファイルをダウンロード。
 * Native: TODO（expo-sharing / expo-file-system で共有対応予定）。
 */
export async function exportSettings(): Promise<{ ok: boolean; message: string }> {
  try {
    const settings = await loadAiSettings();
    const backup = buildBackup(settings);
    const json = JSON.stringify(backup, null, 2);
    const res = await saveOrShareFile({
      filename: `ai-iphone-settings-backup-${todayStamp()}.json`,
      content: json,
      mimeType: 'application/json',
    });
    if (!res.ok) return { ok: false, message: res.message };
    return {
      ok: true,
      message:
        Platform.OS === 'web'
          ? '設定をエクスポートしました'
          : '設定をエクスポートしました（ファイルを共有しました）',
    };
  } catch {
    return { ok: false, message: '設定のエクスポートに失敗しました' };
  }
}

export interface ImportResult {
  ok: boolean;
  message: string;
  /** APIキー利用が有効だが本体は復元されていない場合の注意喚起 */
  apiKeyNotice?: boolean;
}

/**
 * バックアップ JSON 文字列をパースして検証し、AiSettings に反映・保存する。
 * - 不正JSON / 形式不一致 / 古いバージョンでも落ちない
 * - 不足項目は既定値で補完
 * - apiKeyStored は false に強制
 */
export async function importSettingsFromJson(raw: string): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'バックアップファイルの形式が正しくありません' };
  }

  const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  if (!obj || obj.type !== BACKUP_TYPE || typeof obj.settings !== 'object' || obj.settings === null) {
    return { ok: false, message: 'バックアップファイルの形式が正しくありません' };
  }

  const incoming = obj.settings as Partial<AiSettings>;
  const userApiKeyEnabled = incoming.userApiKeyEnabled === true;

  // 既定値で補完しつつ反映。APIキー本体は扱わず、apiKeyStored は false に。
  const merged: AiSettings = {
    ...DEFAULT_AI_SETTINGS,
    ...incoming,
    summarySettings: { ...DEFAULT_AI_SETTINGS.summarySettings, ...incoming.summarySettings },
    chatSettings: { ...DEFAULT_AI_SETTINGS.chatSettings, ...incoming.chatSettings },
    scheduleExtractionSettings: {
      ...DEFAULT_AI_SETTINGS.scheduleExtractionSettings,
      ...incoming.scheduleExtractionSettings,
    },
    memoClassificationSettings: {
      ...DEFAULT_AI_SETTINGS.memoClassificationSettings,
      ...incoming.memoClassificationSettings,
    },
    apiKeyStored: false,
    apiKeyStatus: {},
  };

  try {
    await saveAiSettings(merged);
    return {
      ok: true,
      message: '設定をインポートしました。APIキー本体は復元されていません。',
      apiKeyNotice: userApiKeyEnabled,
    };
  } catch {
    return { ok: false, message: '設定のインポートに失敗しました' };
  }
}

/**
 * AI設定のみを初期化（メモ・予定・チャット履歴・タグ等は変更しない）。
 */
export async function resetAiSettings(): Promise<{ ok: boolean; message: string }> {
  try {
    await saveAiSettings(DEFAULT_AI_SETTINGS);
    return { ok: true, message: 'AI設定を初期化しました' };
  } catch {
    return { ok: false, message: 'AI設定の初期化に失敗しました' };
  }
}
