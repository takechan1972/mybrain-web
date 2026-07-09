/**
 * Google Drive の Markdown 読み取りヘルパー（Phase 1：一覧／Phase 2：1件本文・読み取り専用）。
 *
 * - MyBrain が Drive の MyBrain/Memos/ に書き出した Markdown ファイルの
 *   一覧メタデータ（Phase 1）と、選択した1件の本文テキスト（Phase 2）を取得する。
 * - 読み取り専用：フォルダ・ファイルの作成／変更／削除はしない。
 *   フォルダが無い場合も作成せず、「エクスポートなし」として空の一覧を返す。
 * - スコープは既存の drive.file のまま（アプリ自身が作成したファイルだけが見える。
 *   Obsidian 等の他アプリが置いたファイルは一覧に出ない）。
 * - トークンは引数で受け取るだけ・保存しない（既存の書き出しヘルパーと同じ方針）。
 * - 設計方針：docs/google-drive-markdown-read-search-design.md
 */

import { OBSIDIAN_MEMO_FOLDER } from '@/lib/markdown';
import { findDriveFolder, escapeDriveQueryValue } from './google-drive-folders';

const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Drive 上の Markdown ファイル1件分のメタデータ（本文は含まない）。 */
export interface DriveMarkdownFileInfo {
  /** Drive のファイル ID（Phase 2 の本文読み取りで使う）。 */
  id: string;
  /** ファイル名（例: "買い物メモ.md"）。 */
  name: string;
  /** 最終更新日時（ISO 8601。取得できなければ空文字）。 */
  modifiedTime: string;
  /** ファイルサイズ（バイト。取得できなければ undefined）。 */
  size?: number;
}

/**
 * 相対パス（例: "MyBrain/Memos"）を find のみで辿り、末端フォルダの ID を返す。
 *
 * - ensureDriveFolderPath と違い、フォルダが無くても**作成しない**（読み取り専用）。
 * - 途中のフォルダが1つでも見つからなければ null（＝まだエクスポートが無い）。
 */
export async function findDriveFolderPathReadOnly(
  accessToken: string,
  relativePath: string = OBSIDIAN_MEMO_FOLDER,
): Promise<string | null> {
  let parentId = 'root';
  for (const segment of relativePath.split('/').filter((s) => s.length > 0)) {
    const found = await findDriveFolder(accessToken, segment, parentId);
    if (!found) return null;
    parentId = found;
  }
  return parentId;
}

/**
 * MyBrain/Memos/ 直下の Markdown（.md）ファイルの一覧メタデータを取得する。
 *
 * - 新しい順（modifiedTime desc）。ページングを内部で辿って全件返す。
 * - フォルダが無い場合は空配列（フォルダは作成しない）。
 * - 本文はダウンロードしない。Drive への書き込みは一切しない。
 *
 * @param accessToken 短命アクセストークン（保存しない）
 */
export async function listDriveMarkdownFiles(accessToken: string): Promise<DriveMarkdownFileInfo[]> {
  const folderId = await findDriveFolderPathReadOnly(accessToken);
  if (!folderId) return [];

  const q = [
    `'${escapeDriveQueryValue(folderId)}' in parents`,
    `mimeType!='${FOLDER_MIME}'`,
    'trashed=false',
  ].join(' and ');

  const files: DriveMarkdownFileInfo[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken, files(id,name,modifiedTime,size)',
      orderBy: 'modifiedTime desc',
      spaces: 'drive',
      pageSize: '100',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Drive file list failed (${res.status})`);
    }
    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: { id: string; name: string; modifiedTime?: string; size?: string }[];
    };
    for (const f of data.files ?? []) {
      // Drive クエリは「.md で終わる」を表現できないため、名前はクライアント側で絞り込む。
      if (!f.name.toLowerCase().endsWith('.md')) continue;
      files.push({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime ?? '',
        // Drive API の size は文字列で返る。数値化できなければ undefined のまま。
        size: f.size !== undefined && Number.isFinite(Number(f.size)) ? Number(f.size) : undefined,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

/**
 * 本文読み取りの上限サイズ（バイト）。これを超えるファイルは読み込まない（呼び出し側で判定する）。
 * - 設計方針（docs/google-drive-markdown-read-search-design.md）の「サイズ上限（例：1MB）」に対応。
 */
export const DRIVE_MARKDOWN_READ_MAX_BYTES = 1024 * 1024;

/**
 * 選択した1件の Markdown ファイル本文をテキストとして読み取る（Phase 2・読み取り専用）。
 *
 * - listDriveMarkdownFiles が返したファイル（＝このアプリが作成した .md）に対して使う想定。
 * - 生の Markdown テキストをそのまま返す（解析は呼び出し側で lib/markdown の markdownToMemo を使う）。
 * - Drive への書き込み・変更・削除はしない。フォルダも作成しない。
 * - トークンは引数で受け取るだけ・保存しない。
 *
 * @param accessToken 短命アクセストークン（保存しない）
 * @param fileId      Drive のファイル ID（一覧メタデータの id）
 */
export async function readDriveMarkdownFile(accessToken: string, fileId: string): Promise<string> {
  const res = await fetch(`${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Drive file read failed (${res.status})`);
  }
  return res.text();
}
