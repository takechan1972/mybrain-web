/**
 * Google Drive へ 1 件の Markdown をアップロードするヘルパー（UI 非接続）。
 *
 * - Drive REST API の multipart アップロード（files.create, uploadType=multipart）を使う。
 * - アップロード前に resolveAvailableDriveFileName で空きファイル名を解決し、既存ファイルを上書きしない。
 * - 実際に Drive へ通信するが、UI からはまだ呼ばない・exportMemosToGoogleDrive にもまだ繋がない。
 *   呼び出し側が短命アクセストークンを渡したときだけ動く。
 * - トークンは引数で受け取るだけ・保存しない。
 * - 設計方針：docs/google-drive-markdown-export-design.md
 */

import { OBSIDIAN_MEMO_FOLDER } from '@/lib/markdown';
import { resolveAvailableDriveFileName } from './google-drive-files';

const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
const MARKDOWN_MIME = 'text/markdown';

/** Drive にアップロードしたファイルの情報。 */
export interface GoogleDriveUploadedFile {
  id: string;
  name: string;
  /** 表示用の相対パス（例: "MyBrain/Memos/買い物メモ.md"）。 */
  path?: string;
}

/**
 * 1 件の Markdown を Drive の指定フォルダにアップロードする。
 *
 * - 先に resolveAvailableDriveFileName で空きファイル名を求め、既存を上書きしない（衝突時は連番名）。
 * - multipart（メタデータ＋本文）で files.create する。本文は UTF-8 テキスト。
 *
 * @param accessToken    短命アクセストークン（保存しない）
 * @param fileName       希望ファイル名（例: "買い物メモ.md"）
 * @param content        Markdown 本文
 * @param parentFolderId アップロード先フォルダ ID
 * @returns 作成された Drive ファイルの { id, name, path }
 */
export async function uploadMarkdownToDrive(
  accessToken: string,
  fileName: string,
  content: string,
  parentFolderId: string,
): Promise<GoogleDriveUploadedFile> {
  // 既存ファイルを上書きしないよう、空いている名前を先に決める。
  const finalName = await resolveAvailableDriveFileName(accessToken, fileName, parentFolderId);

  const boundary = `mybrain-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: finalName,
    mimeType: MARKDOWN_MIME,
    parents: [parentFolderId],
  };
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${MARKDOWN_MIME}; charset=utf-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const params = new URLSearchParams({ uploadType: 'multipart', fields: 'id,name' });
  const res = await fetch(`${DRIVE_UPLOAD_ENDPOINT}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Drive upload failed (${res.status})`);
  }
  const data = (await res.json()) as { id?: string; name?: string };
  if (!data.id) throw new Error('Drive upload returned no id');
  const name = data.name || finalName;
  return { id: data.id, name, path: `${OBSIDIAN_MEMO_FOLDER}/${name}` };
}
