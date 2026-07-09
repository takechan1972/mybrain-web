'use client';

import { useState } from 'react';
import { requestGoogleDriveAccessToken, listDriveMarkdownFiles, type DriveMarkdownFileInfo } from '@/lib/google';

/**
 * Google Drive エクスポート済み Markdown の一覧表示（Phase 1・デスクトップのみ・読み取り専用）。
 *
 * - 「一覧を確認」ボタンを押したときだけ Drive に問い合わせる（ユーザー操作起点・自動読み込みなし）。
 * - 表示するのはファイル名と更新日時のみ。本文は読み込まない（Phase 2 の役割）。
 * - 取得結果は React state のみで保持する（Supabase・localStorage に保存しない）。
 * - Drive のファイル・フォルダは一切変更しない（読み取り専用）。
 * - 設計方針：docs/google-drive-markdown-read-search-design.md
 */

const NAVY = '#223A70';
const MUTED = '#8A94A6';

/** ISO 8601 → "YYYY/MM/DD HH:mm"（無効なら空文字）。 */
function formatModified(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type ListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; files: DriveMarkdownFileInfo[] }
  | { kind: 'error' };

export default function DriveExportedFilesList() {
  const [state, setState] = useState<ListState>({ kind: 'idle' });

  async function loadList() {
    setState({ kind: 'loading' });
    try {
      const token = await requestGoogleDriveAccessToken();
      if (token.state === 'cancelled') {
        // ユーザーが同意ポップアップを閉じた：エラーにせず元の状態に戻す。
        setState({ kind: 'idle' });
        return;
      }
      if (token.state !== 'granted' || !token.accessToken) {
        setState({ kind: 'error' });
        return;
      }
      const files = await listDriveMarkdownFiles(token.accessToken);
      setState({ kind: 'loaded', files });
    } catch {
      setState({ kind: 'error' });
    }
  }

  return (
    <div className="mt-3 border-t border-[#E8EAF3] pt-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-bold" style={{ color: NAVY }}>エクスポート済み一覧</span>
        <button
          type="button"
          onClick={loadList}
          disabled={state.kind === 'loading'}
          className="rounded-full border border-[#E8EAF3] bg-white px-3 py-1 text-[11px] font-semibold transition active:scale-95 disabled:opacity-40"
          style={{ color: '#54607A' }}>
          {state.kind === 'loading' ? '確認中…' : '一覧を確認'}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed" style={{ color: '#A6AEC0' }}>
        Google Driveの MyBrain/Memos/ にMyBrainから書き出したMarkdownファイルを表示します（表示のみ・ファイルは変更しません）。
      </p>
      {state.kind === 'error' && (
        <p className="mt-1.5 text-[12px]" style={{ color: MUTED }}>
          一覧を取得できませんでした。時間をおいてもう一度お試しください。
        </p>
      )}
      {state.kind === 'loaded' && state.files.length === 0 && (
        <p className="mt-1.5 text-[12px]" style={{ color: MUTED }}>
          Google Driveに書き出したMarkdownはまだありません。
        </p>
      )}
      {state.kind === 'loaded' && state.files.length > 0 && (
        <ul className="mt-1.5 max-h-48 overflow-y-auto">
          {state.files.map((f) => (
            <li key={f.id} className="flex items-baseline justify-between gap-3 border-b border-[#F3F4FA] py-1 last:border-b-0">
              <span className="min-w-0 truncate text-[12px]" style={{ color: NAVY }}>{f.name}</span>
              <span className="shrink-0 text-[11px]" style={{ color: MUTED }}>{formatModified(f.modifiedTime)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
