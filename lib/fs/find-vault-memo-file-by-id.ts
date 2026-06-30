/**
 * ローカル Obsidian Vault 内から、MyBrain メモに対応する Markdown ファイルを
 * frontmatter の id / source で特定する「読み取り専用」ヘルパー（UI 非接続）。
 *
 * - 目的：将来の「更新内容の Vault 反映（write-back）」の土台。まず“探すだけ”を切り出す。
 * - このフェーズは完全に read-only：書き込み・新規作成・削除・権限要求は一切しない。
 * - 照合キーはファイル名ではなく frontmatter の id（タイトル変更でファイル名は変わるが id は不変）。
 *   さらに source==="mybrain" を要求し、MyBrain 由来ではないノートを誤って拾わないようにする。
 * - ディレクトリ・ファイルが無ければ null を返す（作成しない）。
 * - 個別ファイルが読めない場合はスキップして次へ進む（全体を止めない）。
 * - 設計方針：docs/obsidian-storage-flow-review.md / Phase 4.11 レビュー
 */

import {
  OBSIDIAN_MEMO_FOLDER,
  MEMO_MARKDOWN_SOURCE,
  markdownToMemo,
} from '@/lib/markdown';

/**
 * FileSystemDirectoryHandle の非同期イテレーション（values）への最小アクセス。
 * - lib.dom の版差で values()/entries() の型が無い場合があるため、ここで最小宣言して安全に使う。
 * - 実体は標準 API（ハンドルは標準 DOM 型をそのまま扱う）。
 */
interface AsyncIterableDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

/**
 * ルート配下のネストしたサブフォルダ（例: "MyBrain/Memos"）を「作らずに」開く。
 * - 各セグメントを create なし（既定）で取得。途中で存在しなければ null。
 * - 権限要求はしない（取得のみ）。
 */
async function openSubDirectoryReadOnly(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemDirectoryHandle | null> {
  let dir = root;
  for (const segment of relativePath.split('/').filter((s) => s.length > 0)) {
    try {
      dir = await dir.getDirectoryHandle(segment); // create:false（既定）。無ければ NotFoundError。
    } catch {
      return null; // フォルダ未作成 等：見つからない扱い。
    }
  }
  return dir;
}

/**
 * 選択中の Vault フォルダ内 "MyBrain/Memos/" を走査し、frontmatter の id が memoId と一致し
 * かつ source==="mybrain" の Markdown ファイル（最初の1件）のハンドルを返す。
 *
 * - "MyBrain/Memos/" が存在しない → null（作成しない）。
 * - 一致が無い → null。
 * - 走査対象は拡張子 .md のファイルのみ。読めないファイルはスキップして続行。
 * - 書き込み・新規作成・削除・権限要求は一切しない（read-only）。
 *
 * @param vaultDirectory ユーザーが選んだ Vault ルートのディレクトリハンドル
 * @param memoId         照合する MyBrain のメモID
 * @returns 一致した FileSystemFileHandle、または null
 */
export async function findVaultMemoFileById(
  vaultDirectory: FileSystemDirectoryHandle | null | undefined,
  memoId: string,
): Promise<FileSystemFileHandle | null> {
  // 入力が無い・空 id は安全側で null（空 id の誤マッチを避ける）。
  if (!vaultDirectory || !memoId) return null;

  const memosDir = await openSubDirectoryReadOnly(vaultDirectory, OBSIDIAN_MEMO_FOLDER);
  if (!memosDir) return null;

  // ディレクトリの非同期イテレーション（型は最小宣言経由）。
  const iterable = memosDir as unknown as AsyncIterableDirectoryHandle;

  try {
    for await (const entry of iterable.values()) {
      // ファイル以外・.md 以外は対象外。
      if (entry.kind !== 'file') continue;
      if (!entry.name.toLowerCase().endsWith('.md')) continue;

      const fileHandle = entry as FileSystemFileHandle;
      try {
        const file = await fileHandle.getFile();
        const text = await file.text();
        const parsed = markdownToMemo(text);
        if (parsed.id === memoId && parsed.source === MEMO_MARKDOWN_SOURCE) {
          return fileHandle; // 最初の一致を返す。
        }
      } catch {
        // 読めない・壊れたファイルは無視して次へ。
        continue;
      }
    }
  } catch {
    // 走査自体が失敗（権限喪失・想定外）→ 見つからない扱い（非致命）。
    return null;
  }

  return null;
}
