/**
 * File System Access API の対応判定とコアヘルパー（UI 非接続）。
 *
 * - 「Obsidian Vault ローカルフォルダ直接書き出し」の土台。UI からはまだ呼ばない。
 * - ファイルハンドル系（FileSystemDirectoryHandle / FileSystemFileHandle 等）は標準 DOM 型を使う。
 *   ただし window.showDirectoryPicker は標準 lib.dom に型が無いため、このファイルでのみ最小宣言する。
 * - 設計方針：docs/obsidian-vault-export-design.md
 * - ブラウザ専用：window が無い環境（SSR 等）では安全側に倒す。
 */

import type { Memo } from '@/lib/types';
import { createMemoMarkdownFile, OBSIDIAN_MEMO_FOLDER } from '@/lib/markdown';

// window.showDirectoryPicker は lib.dom に未収録のため、このファイル内のみで最小宣言する。
// （FileSystemDirectoryHandle 自体は標準 DOM 型を使用する。）
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

/**
 * このブラウザで `window.showDirectoryPicker`（ディレクトリ選択）が使えるかを返す。
 *
 * - SSR など window が無い環境では false。
 * - window に showDirectoryPicker が存在するときだけ true。
 *
 * @returns 対応していれば true、そうでなければ false
 */
export function isDirectoryPickerSupported(): boolean {
  // SSR ガード：window が無ければ非対応として扱う。
  if (typeof window === 'undefined') return false;
  return 'showDirectoryPicker' in window;
}

/**
 * ユーザーにフォルダを選んでもらい、ディレクトリハンドルを返す。
 *
 * - 非対応ブラウザ（SSR 含む）では null。
 * - ユーザーがキャンセルした場合（AbortError）は null。
 * - それ以外の想定外エラーは再スローする。
 *
 * @returns 選択されたディレクトリハンドル、または null
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isDirectoryPickerSupported() || !window.showDirectoryPicker) return null;
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    // ユーザーがダイアログをキャンセルした場合は何もしない（null）。
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/** 1件のメモを Vault に書き出した結果。 */
export interface MemoWriteResult {
  /** 実際に書き込んだファイル名（重複回避で連番が付く場合がある）。 */
  fileName: string;
  /** Vault 内の相対パス（例: "MyBrain/Memos/買い物メモ.md"）。 */
  path: string;
}

/**
 * 選択フォルダ配下に、ネストしたサブフォルダ（例: "MyBrain/Memos"）を確保する。
 * - 各セグメントを create: true で取得／作成する。
 */
async function ensureSubDirectory(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const segment of relativePath.split('/').filter((s) => s.length > 0)) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}

/**
 * 指定ディレクトリ内で、既存ファイルと衝突しない安全なファイル名を返す。
 * - 既存なら "名前-2.md" / "名前-3.md" … と連番を付ける（上書きしない）。
 */
async function resolveAvailableFileName(
  dir: FileSystemDirectoryHandle,
  fileName: string,
): Promise<string> {
  let name = fileName;
  let n = 2;
  // getFileHandle（create なし）は存在しなければ NotFoundError を投げる。
  // 例外＝未使用の名前、成功＝既存なので連番を進める。
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await dir.getFileHandle(name);
    } catch {
      return name; // 見つからない＝この名前は空いている
    }
    name = fileName.replace(/(\.md)?$/i, `-${n}$1`);
    n += 1;
  }
}

/**
 * 1件のメモを、選択フォルダの "MyBrain/Memos/" 配下に Markdown として書き出す。
 *
 * - Markdown 生成は既存の createMemoMarkdownFile を再利用（複製しない）。
 * - 既存ファイルを黙って上書きしない（衝突時は連番ファイル名で新規作成）。
 * - 本文は UTF-8 テキストとして書き込む（createWritable → write → close）。
 * - この関数は UI 非依存（確認ダイアログ・トースト等は呼び出し側の責務）。
 *
 * @param dirHandle ユーザーが選んだ Vault ルートのディレクトリハンドル
 * @param memo      書き出すメモ
 * @returns { fileName, path }
 */
export async function writeMemoToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  memo: Memo,
): Promise<MemoWriteResult> {
  const { fileName, content } = createMemoMarkdownFile(memo);
  const memosDir = await ensureSubDirectory(dirHandle, OBSIDIAN_MEMO_FOLDER);
  const finalName = await resolveAvailableFileName(memosDir, fileName);
  const fileHandle = await memosDir.getFileHandle(finalName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return { fileName: finalName, path: `${OBSIDIAN_MEMO_FOLDER}/${finalName}` };
}
