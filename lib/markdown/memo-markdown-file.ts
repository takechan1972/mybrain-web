import type { Memo } from '@/lib/types';
import { memoToMarkdown } from './memo-markdown';
import { createMemoMarkdownFileName } from './memo-file-name';
import { createMemoMarkdownPath } from './memo-folder';

/**
 * 1件のメモを「Obsidian Markdown ファイル」を表すオブジェクトに変換する純関数。
 *
 * - これは内部ユーティリティであり、保存処理・UI・既存の保存挙動には接続しない。
 * - 既存ヘルパーを組み合わせるだけ（ファイル名・パス・本文の生成ロジックは複製しない）。
 *   将来、Obsidian アダプタ実装時にこのオブジェクトを実ファイル書き出しへ渡す。
 */

/** Obsidian Vault に書き出すメモ Markdown ファイルの表現。 */
export interface MemoMarkdownFile {
  /** ファイル名（例: "買い物メモ.md"） */
  fileName: string;
  /** Vault 内の相対パス（例: "MyBrain/Memos/買い物メモ.md"） */
  path: string;
  /** ファイル本文（YAML frontmatter + 本文） */
  content: string;
}

/**
 * メモから Obsidian Markdown ファイルオブジェクトを生成する。
 *
 * @param memo 変換対象のメモ
 * @returns { fileName, path, content }
 */
export function createMemoMarkdownFile(memo: Memo): MemoMarkdownFile {
  const fileName = createMemoMarkdownFileName(memo.title);
  const path = createMemoMarkdownPath(fileName);
  const content = memoToMarkdown(memo);
  return { fileName, path, content };
}
