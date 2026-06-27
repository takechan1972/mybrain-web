/**
 * Google Drive のフォルダ検索／作成ヘルパー（UI 非接続）。
 *
 * - 「Drive への Markdown 書き出し」で MyBrain/Memos/ を確保するための土台。
 * - 実際に Drive REST API（files.list / files.create）を呼ぶが、UI からはまだ呼ばない。
 *   呼び出し側が短命アクセストークン（requestGoogleDriveAccessToken の戻り値）を渡したときだけ動く。
 * - トークンは引数で受け取るだけ・保存しない。ここではファイルのアップロードはしない（フォルダのみ）。
 * - 設計方針：docs/google-drive-markdown-export-design.md
 */

import { OBSIDIAN_MEMO_FOLDER } from '@/lib/markdown';

const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Drive のクエリ文字列内で使うため、シングルクォートをエスケープする。 */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * 指定フォルダ（parentId）直下に、同名のフォルダがあればその ID を返す（無ければ null）。
 *
 * @param accessToken 短命アクセストークン（保存しない）
 * @param name        探すフォルダ名
 * @param parentId    親フォルダ ID（ルートは 'root'）
 */
export async function findDriveFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<string | null> {
  const q = [
    `mimeType='${FOLDER_MIME}'`,
    `name='${escapeDriveQueryValue(name)}'`,
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    'trashed=false',
  ].join(' and ');
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: '1',
  });
  const res = await fetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Drive folder search failed (${res.status})`);
  }
  const data = (await res.json()) as { files?: { id: string; name: string }[] };
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

/**
 * 指定フォルダ（parentId）直下に、新しいフォルダを作成して ID を返す。
 *
 * @param accessToken 短命アクセストークン（保存しない）
 * @param name        作成するフォルダ名
 * @param parentId    親フォルダ ID（ルートは 'root'）
 */
export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<string> {
  const res = await fetch(`${DRIVE_FILES_ENDPOINT}?fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) {
    throw new Error(`Drive folder create failed (${res.status})`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error('Drive folder create returned no id');
  return data.id;
}

/**
 * 指定フォルダ直下に同名フォルダがあればそれを、無ければ作成して ID を返す（find or create）。
 *
 * @param accessToken 短命アクセストークン（保存しない）
 * @param name        フォルダ名
 * @param parentId    親フォルダ ID（ルートは 'root'）
 */
export async function ensureDriveFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<string> {
  const existing = await findDriveFolder(accessToken, name, parentId);
  if (existing) return existing;
  return createDriveFolder(accessToken, name, parentId);
}

/**
 * 相対パス（例: "MyBrain/Memos"）の各セグメントを順に find-or-create して、末端フォルダの ID を返す。
 *
 * - 既定では既存メモ用フォルダ（OBSIDIAN_MEMO_FOLDER = "MyBrain/Memos"）を確保する。
 * - ルートから順にネストして作成する（ローカル Vault の MyBrain/Memos/ と同じ構造）。
 *
 * @param accessToken 短命アクセストークン（保存しない）
 * @param relativePath ルートからの相対パス（既定: OBSIDIAN_MEMO_FOLDER）
 * @returns 末端フォルダの ID
 */
export async function ensureDriveFolderPath(
  accessToken: string,
  relativePath: string = OBSIDIAN_MEMO_FOLDER,
): Promise<string> {
  let parentId = 'root';
  for (const segment of relativePath.split('/').filter((s) => s.length > 0)) {
    parentId = await ensureDriveFolder(accessToken, segment, parentId);
  }
  return parentId;
}
