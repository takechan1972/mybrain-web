import { Platform } from 'react-native';

/**
 * 録音ファイルを端末から削除する。
 * - メモ登録後にスマホ容量を圧迫しないよう録音データを残さない
 * - 失敗してもアプリを止めない（呼び出し側は成功扱いを継続）
 * - URI や本文など秘密情報はログに出さない（成功/失敗のみ）
 */
export async function deleteRecordingFile(uri: string | null | undefined): Promise<boolean> {
  const target = (uri ?? '').trim();
  if (target.length === 0) return true; // 削除対象なし＝何もしない（成功扱い）

  // Web は blob/object URL のため端末ファイル削除は不要
  if (Platform.OS === 'web') return true;

  try {
    // 動的importで legacy API を利用（Web バンドルへ不要に含めない）
    const FileSystem = await import('expo-file-system/legacy');
    await FileSystem.deleteAsync(target, { idempotent: true });
    return true;
  } catch {
    // 削除失敗は警告のみ（メモ登録自体は成功扱い）
    return false;
  }
}
