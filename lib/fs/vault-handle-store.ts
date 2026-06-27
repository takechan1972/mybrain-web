/**
 * Obsidian Vault のフォルダハンドルを IndexedDB に保存／取得／削除する最小ラッパ（UI 非接続）。
 *
 * - 「フォルダへ書き出し」で毎回フォルダ選択する手間をなくすための土台。UI からはまだ呼ばない。
 * - 標準 IndexedDB のみ使用（依存追加なし）。FileSystemDirectoryHandle はオブジェクトのまま保存する。
 * - 保存するのはハンドル・保存日時・（取得できれば）表示名のみ。
 *   メモ本文 / Supabase データ / Google Drive トークン / 個人情報は保存しない。
 * - 権限の確認（queryPermission / requestPermission）はここでは扱わない（別ヘルパーの責務）。
 * - 設計方針：docs/obsidian-vault-export-design.md
 *
 * 異常時は画面を止めず安全側（未接続相当）に倒す：
 * - SSR / IndexedDB 非対応：load は null、save / clear は no-op。
 * - 読み込み失敗・データ破損：null を返す。
 * - 保存失敗：握りつぶして解決（既存のアプリデータには影響しない）。
 */

const DB_NAME = 'mybrain-local-vault';
const STORE_NAME = 'handles';
const KEY = 'obsidian-vault-directory';

/** IndexedDB に保存するレコードの形。 */
interface VaultHandleRecord {
  handle: FileSystemDirectoryHandle;
  savedAt: number;
  name?: string;
}

/** この環境で IndexedDB が使えるか（SSR / 非対応では false）。 */
function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

/** DB を開く（store が無ければ作成）。失敗時は reject。 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Vault ルートのフォルダハンドルを保存する（1件のみ・固定キーで上書き）。
 *
 * - SSR / 非対応では何もしない。
 * - 保存に失敗しても例外は投げず、既存データにも影響しない。
 */
export async function saveVaultHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    const record: VaultHandleRecord = {
      handle,
      savedAt: Date.now(),
      // handle.name が取れる場合のみ表示名として保存（任意）。
      name: typeof handle.name === 'string' ? handle.name : undefined,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 保存失敗は握りつぶす（毎回フォルダ選択にフォールバックできる）。
  }
}

/**
 * 保存済みの Vault フォルダハンドルを取得する。
 *
 * - SSR / 非対応・未保存・読み込み失敗・データ破損のいずれも null。
 * - ここでは権限確認をしない（取得のみ）。
 */
export async function loadVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!isIndexedDbAvailable()) return null;
  try {
    const db = await openDb();
    const record = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    // 破損・想定外の形は null 扱い。
    if (
      record &&
      typeof record === 'object' &&
      'handle' in record &&
      (record as VaultHandleRecord).handle
    ) {
      return (record as VaultHandleRecord).handle;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 保存済みの Vault フォルダハンドルを削除する（接続解除）。
 *
 * - SSR / 非対応では何もしない。失敗しても例外は投げない。
 * - ローカルの参照を消すだけ。Vault 内のファイルや Supabase には触れない。
 */
export async function clearVaultHandle(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 削除失敗は握りつぶす。
  }
}
