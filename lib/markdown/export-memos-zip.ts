/**
 * 複数メモを1つの ZIP（Obsidian 用 Markdown ファイル群）にまとめる共通ヘルパー。
 *
 * - デスクトップ（components/DesktopMemos.tsx）とモバイル（app/history/page.tsx）で
 *   重複していた「ZIP 生成・ファイル名の重複回避・ZIP ファイル名の生成」を1箇所に集約する。
 * - UI 固有の挙動（window.confirm / 大量選択の警告 / トースト / ボタンの無効化）は呼び出し側に残す。
 * - 端末のダウンロード用の Blob を返すだけ。実際のダウンロード（anchor 操作）は呼び出し側で行う。
 * - 保存挙動・Supabase は不変（MyBrain/Supabase が source of truth）。
 */

import JSZip from 'jszip';
import type { Memo } from '@/lib/types';
import { createMemoMarkdownFile } from './memo-markdown-file';

/** ZIP 書き出しの結果。呼び出し側でダウンロード／トーストに使う。 */
export interface MemoZipExport {
  /** 既定の ZIP ファイル名（例: "mybrain-memos-2026-06-27.zip"）。 */
  fileName: string;
  /** ZIP 本体（端末ダウンロード用）。 */
  blob: Blob;
  /** ZIP に含めたメモ件数。 */
  count: number;
}

/** 今日の日付から既定の ZIP ファイル名を作る（mybrain-memos-YYYY-MM-DD.zip）。 */
export function createMemoZipFileName(date: Date = new Date()): string {
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `mybrain-memos-${ymd}.zip`;
}

/**
 * 渡されたメモを1つの ZIP にまとめて Blob を生成する。
 *
 * - 各メモは既存の createMemoMarkdownFile で Markdown 化する（生成ロジックは複製しない）。
 * - 同名タイトルでも上書きしないよう、重複ファイル名には連番サフィックス（名前-2.md / 名前-3.md …）を付ける。
 * - UI 固有の確認・警告・トーストは含めない（呼び出し側の責務）。
 *
 * @param memos ZIP に含めるメモ（呼び出し側で選択済みのものを渡す）
 * @returns { fileName, blob, count }
 */
export async function exportMemosAsZip(memos: Memo[]): Promise<MemoZipExport> {
  const zip = new JSZip();
  const usedNames = new Set<string>();
  memos.forEach((m) => {
    const { fileName, content } = createMemoMarkdownFile(m);
    // ファイル名の重複を避ける（同名タイトルでも上書きしない）
    let name = fileName;
    let n = 2;
    while (usedNames.has(name)) {
      name = fileName.replace(/(\.md)?$/i, `-${n}$1`);
      n += 1;
    }
    usedNames.add(name);
    zip.file(name, content);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  return { fileName: createMemoZipFileName(), blob, count: memos.length };
}
