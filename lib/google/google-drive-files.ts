/**
 * Google Drive のファイル存在確認／重複ファイル名解決ヘルパー（UI 非接続）。
 *
 * - 「Drive への Markdown 書き出し」で、既存ファイルを黙って上書きしないための土台。
 * - 実際に Drive REST API（files.list）を呼ぶが、UI からはまだ呼ばない。
 *   呼び出し側が短命アクセストークンを渡したときだけ動く。
 * - トークンは引数で受け取るだけ・保存しない。ここではファイルのアップロードはしない（存在確認のみ）。
 * - 重複名の付け方はローカル Vault 書き出し（lib/fs の resolveAvailableFileName）と同じ規則に揃える。
 * - 設計方針：docs/google-drive-markdown-export-design.md
 */

import { escapeDriveQueryValue } from './google-drive-folders';

const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * 指定フォルダ（parentFolderId）直下に、同名のファイル（フォルダ以外）があれば ID を返す（無ければ null）。
 *
 * @param accessToken    短命アクセストークン（保存しない）
 * @param name           探すファイル名（例: "買い物メモ.md"）
 * @param parentFolderId 親フォルダ ID
 */
export async function findDriveFile(
  accessToken: string,
  name: string,
  parentFolderId: string,
): Promise<string | null> {
  const q = [
    `name='${escapeDriveQueryValue(name)}'`,
    `'${escapeDriveQueryValue(parentFolderId)}' in parents`,
    `mimeType!='${FOLDER_MIME}'`,
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
    throw new Error(`Drive file search failed (${res.status})`);
  }
  const data = (await res.json()) as { files?: { id: string; name: string }[] };
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

/**
 * 指定フォルダ内で、既存ファイルと衝突しない安全なファイル名を返す。
 *
 * - 既存なら "名前-2.md" / "名前-3.md" … と連番を付ける（上書きしない）。
 * - ローカル Vault 書き出し（resolveAvailableFileName）と同じ規則。
 *
 * @param accessToken    短命アクセストークン（保存しない）
 * @param fileName       希望ファイル名（例: "買い物メモ.md"）
 * @param parentFolderId 親フォルダ ID
 */
export async function resolveAvailableDriveFileName(
  accessToken: string,
  fileName: string,
  parentFolderId: string,
): Promise<string> {
  let name = fileName;
  let n = 2;
  // 見つからない＝その名前は空いている。見つかれば連番を進める。
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await findDriveFile(accessToken, name, parentFolderId);
    if (!existing) return name;
    name = fileName.replace(/(\.md)?$/i, `-${n}$1`);
    n += 1;
  }
}
