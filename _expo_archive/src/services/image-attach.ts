import * as ImagePicker from 'expo-image-picker';

/**
 * 画像添付（カメラ撮影・画像選択）。
 *
 * - Web / iOS / Android 共通で expo-image-picker を利用
 * - 永続化のため data URI（base64）で返す（AsyncStorage 保存・再表示に対応）
 * - 画像本体やURIはログに出さない（呼び出し側もログしない）
 * - 取得失敗・キャンセル時は null を返す（呼び出し側はアプリを止めない）
 */

// 端末容量・保存量に配慮した品質（0〜1）。data URI が大きくなりすぎないよう抑える。
const IMAGE_QUALITY = 0.5;

function assetToDataUri(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.base64 && asset.base64.length > 0) {
    const mime = asset.mimeType ?? 'image/jpeg';
    return `data:${mime};base64,${asset.base64}`;
  }
  // base64 が取得できない環境では元の uri を返す（最低限の表示用）
  return asset.uri;
}

/** カメラで撮影して画像（data URI）を返す。許可なし/キャンセルは null。 */
export async function takePhoto(): Promise<string | null> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
    const res = await ImagePicker.launchCameraAsync({ base64: true, quality: IMAGE_QUALITY });
    if (res.canceled || res.assets.length === 0) return null;
    return assetToDataUri(res.assets[0]);
  } catch {
    return null;
  }
}

/** 画像ライブラリから選択して画像（data URI）を返す。許可なし/キャンセルは null。 */
export async function pickImageFromLibrary(): Promise<string | null> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    // Web では許可不要なことが多い。granted=false でも続行を試みる。
    void perm;
    const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: IMAGE_QUALITY });
    if (res.canceled || res.assets.length === 0) return null;
    return assetToDataUri(res.assets[0]);
  } catch {
    return null;
  }
}
