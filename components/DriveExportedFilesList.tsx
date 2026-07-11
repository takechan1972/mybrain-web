'use client';

import { useState } from 'react';
import {
  requestGoogleDriveAccessToken,
  listDriveMarkdownFiles,
  readDriveMarkdownFile,
  DRIVE_MARKDOWN_READ_MAX_BYTES,
  type DriveMarkdownFileInfo,
} from '@/lib/google';
import { markdownToMemo, type ParsedMemoMarkdown } from '@/lib/markdown';

/**
 * Google Drive エクスポート済み Markdown の一覧＋1件プレビュー＋検索参照への追加
 * （Phase 1/2/3a・デスクトップのみ・読み取り専用）。
 *
 * - 「一覧を確認」「内容を確認」「参照に追加」を押したときだけ Drive に問い合わせる（ユーザー操作起点・自動読み込みなし）。
 * - 一覧はファイル名と更新日時のみ。プレビューは選んだ1件の本文を読み、既存の markdownToMemo で解析して表示する。
 * - 「参照に追加」した Drive メモは親（DesktopMemos）が state で保持し、検索の参考にのみ使う（Phase 3a）。
 * - 取得結果・本文・参照メモは React state のみで保持する（Supabase・localStorage に保存しない）。
 * - 読み取り専用：Drive のファイル・フォルダは一切変更しない。保存・取り込み・編集・AI接続はしない。
 * - 設計方針：docs/google-drive-markdown-read-search-design.md
 */

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const PURPLE = '#7B61FF';

/**
 * 検索の参考に使う Drive 参照メモ（メモリのみ・MyBrain 本体メモとは別物）。
 * - fileId で重複判定する。
 * - title / body / tags は既存の markdownToMemo の解析結果。
 */
export interface DriveReferenceMemo {
  fileId: string;
  fileName: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  hasFrontmatter: boolean;
}

interface DriveExportedFilesListProps {
  /** 現在の参照メモ（重複判定・「参照中」表示に使う）。未指定なら参照機能は出さない。 */
  references?: DriveReferenceMemo[];
  /** 参照メモの追加時に親へ通知するコールバック。未指定なら「参照に追加」ボタンを出さない。 */
  onReferenceChange?: (next: DriveReferenceMemo[]) => void;
}

/** ISO 8601 → "YYYY/MM/DD HH:mm"（無効なら空文字）。 */
function formatModified(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatDate(d);
}

/** epoch ms → "YYYY/MM/DD HH:mm"（0・無効なら空文字）。 */
function formatMs(ms: number): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return formatDate(d);
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type ListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; files: DriveMarkdownFileInfo[] }
  | { kind: 'error' };

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading'; fileId: string }
  | { kind: 'loaded'; file: DriveMarkdownFileInfo; parsed: ParsedMemoMarkdown; hasFrontmatter: boolean }
  | { kind: 'too-large'; file: DriveMarkdownFileInfo }
  | { kind: 'error' };

/** Drive の本文読み取り＋解析の結果（プレビューと参照追加で共有）。 */
type ReadResult =
  | { ok: true; parsed: ParsedMemoMarkdown; hasFrontmatter: boolean }
  | { ok: false; reason: 'cancelled' | 'error' };

export default function DriveExportedFilesList({ references, onReferenceChange }: DriveExportedFilesListProps) {
  const [state, setState] = useState<ListState>({ kind: 'idle' });
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  // 参照追加の進行中ファイルID・案内メッセージ（メモリのみ）。
  const [addBusyId, setAddBusyId] = useState<string | null>(null);
  const [addNote, setAddNote] = useState<string | null>(null);

  const refs = references ?? [];
  const canReference = typeof onReferenceChange === 'function';

  // 選んだ1件の本文を取得して既存 markdownToMemo で解析する（トークン取得は既存パターン・保存しない）。
  async function readAndParse(file: DriveMarkdownFileInfo): Promise<ReadResult> {
    const token = await requestGoogleDriveAccessToken();
    if (token.state === 'cancelled') return { ok: false, reason: 'cancelled' };
    if (token.state !== 'granted' || !token.accessToken) return { ok: false, reason: 'error' };
    const raw = await readDriveMarkdownFile(token.accessToken, file.id);
    // フロントマターが無い場合、markdownToMemo は全文を本文として返す（安全なフォールバック）。
    const hasFrontmatter = /^---\r?\n/.test(raw);
    return { ok: true, parsed: markdownToMemo(raw), hasFrontmatter };
  }

  async function loadList() {
    setState({ kind: 'loading' });
    setPreview({ kind: 'idle' }); // 一覧を取り直したら古いプレビューは閉じる
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

  // 選んだ1件の本文を読み取ってプレビュー表示する（読み取り専用・メモリのみ）。
  async function openPreview(file: DriveMarkdownFileInfo) {
    // 大きすぎるファイルは読み込まない（設計上のサイズ上限。トークン要求もしない）。
    if (file.size !== undefined && file.size > DRIVE_MARKDOWN_READ_MAX_BYTES) {
      setPreview({ kind: 'too-large', file });
      return;
    }
    setPreview({ kind: 'loading', fileId: file.id });
    try {
      const r = await readAndParse(file);
      if (!r.ok) {
        setPreview(r.reason === 'cancelled' ? { kind: 'idle' } : { kind: 'error' });
        return;
      }
      setPreview({ kind: 'loaded', file, parsed: r.parsed, hasFrontmatter: r.hasFrontmatter });
    } catch {
      setPreview({ kind: 'error' });
    }
  }

  // 選んだ1件を「Google Drive参照」として親の state に追加する（検索の参考にのみ使う・保存しない）。
  async function addReference(file: DriveMarkdownFileInfo) {
    if (!onReferenceChange) return;
    setAddNote(null);
    // すでに追加済みなら、やさしい案内を出して終わり（重複追加しない）。
    if (refs.some((r) => r.fileId === file.id)) {
      setAddNote(`「${file.name}」はすでに参照に追加されています。`);
      return;
    }
    // 大きすぎるファイルは読み込まない（プレビューと同じサイズ上限）。
    if (file.size !== undefined && file.size > DRIVE_MARKDOWN_READ_MAX_BYTES) {
      setAddNote(`「${file.name}」は大きすぎるため参照に追加できません。`);
      return;
    }
    setAddBusyId(file.id);
    try {
      const r = await readAndParse(file);
      if (!r.ok) {
        // キャンセルは静かに終える。失敗のみ案内する。
        if (r.reason === 'error') setAddNote('参照に追加できませんでした。もう一度お試しください。');
        return;
      }
      const ref: DriveReferenceMemo = {
        fileId: file.id,
        fileName: file.name,
        title: r.parsed.title,
        body: r.parsed.body,
        tags: r.parsed.tags,
        createdAt: r.parsed.createdAt,
        updatedAt: r.parsed.updatedAt,
        hasFrontmatter: r.hasFrontmatter,
      };
      onReferenceChange([...refs, ref]);
      setAddNote(`「${file.name}」を参照に追加しました。読み込み中の一覧はメモ一覧の上に表示されます。`);
    } catch {
      setAddNote('参照に追加できませんでした。もう一度お試しください。');
    } finally {
      setAddBusyId(null);
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
      {canReference && (
        <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: '#A6AEC0' }}>
          「参照に追加」すると、メモ検索の参考にできます（この画面を開いている間だけ・MyBrainには保存されません）。
        </p>
      )}
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
          {state.files.map((f) => {
            const isReferenced = refs.some((r) => r.fileId === f.id);
            return (
              <li key={f.id} className="flex items-baseline justify-between gap-3 border-b border-[#F3F4FA] py-1 last:border-b-0">
                <span className="min-w-0 truncate text-[12px]" style={{ color: NAVY }}>{f.name}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-[11px]" style={{ color: MUTED }}>{formatModified(f.modifiedTime)}</span>
                  <button
                    type="button"
                    onClick={() => openPreview(f)}
                    disabled={preview.kind === 'loading'}
                    className="rounded-full border border-[#E8EAF3] bg-white px-2.5 py-0.5 text-[11px] font-semibold transition active:scale-95 disabled:opacity-40"
                    style={{ color: '#54607A' }}>
                    内容を確認
                  </button>
                  {canReference && (
                    isReferenced ? (
                      <span className="rounded-full border border-[#E5DDFB] bg-[#F6F4FF] px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: PURPLE }}>
                        参照中
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addReference(f)}
                        disabled={addBusyId !== null}
                        className="rounded-full border border-[#E8EAF3] bg-white px-2.5 py-0.5 text-[11px] font-semibold transition active:scale-95 disabled:opacity-40"
                        style={{ color: '#54607A' }}>
                        {addBusyId === f.id ? '追加中…' : '参照に追加'}
                      </button>
                    )
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {canReference && addNote && (
        <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>{addNote}</p>
      )}

      {/* 1件プレビュー（読み取り専用・メモリのみ。保存/取り込み/編集ボタンは置かない） */}
      {preview.kind === 'loading' && (
        <p className="mt-2 text-[12px]" style={{ color: MUTED }}>読み込み中...</p>
      )}
      {preview.kind === 'error' && (
        <p className="mt-2 text-[12px]" style={{ color: MUTED }}>
          内容を読み込めませんでした。もう一度お試しください。
        </p>
      )}
      {preview.kind === 'too-large' && (
        <div className="mt-2 rounded-xl border border-[#E8EAF3] bg-[#FAFBFF] px-3 py-2">
          <p className="text-[12px]" style={{ color: MUTED }}>
            「{preview.file.name}」は大きすぎるため表示できません。
          </p>
          <button
            type="button"
            onClick={() => setPreview({ kind: 'idle' })}
            className="mt-1.5 rounded-full border border-[#E8EAF3] bg-white px-3 py-1 text-[11px] font-semibold transition active:scale-95"
            style={{ color: '#54607A' }}>
            閉じる
          </button>
        </div>
      )}
      {preview.kind === 'loaded' && (
        <div className="mt-2 rounded-xl border border-[#E8EAF3] bg-[#FAFBFF] px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold" style={{ color: NAVY }}>
                {preview.parsed.title || preview.file.name}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: '#A6AEC0' }}>ファイル：{preview.file.name}</p>
            </div>
            <button
              type="button"
              onClick={() => setPreview({ kind: 'idle' })}
              className="shrink-0 rounded-full border border-[#E8EAF3] bg-white px-3 py-1 text-[11px] font-semibold transition active:scale-95"
              style={{ color: '#54607A' }}>
              閉じる
            </button>
          </div>
          {preview.parsed.tags.length > 0 && (
            <p className="mt-1 text-[11px]" style={{ color: '#7B61FF' }}>
              {preview.parsed.tags.map((t) => `#${t}`).join('　')}
            </p>
          )}
          {(formatMs(preview.parsed.createdAt) || formatMs(preview.parsed.updatedAt)) && (
            <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
              {formatMs(preview.parsed.createdAt) && <>作成：{formatMs(preview.parsed.createdAt)}</>}
              {formatMs(preview.parsed.createdAt) && formatMs(preview.parsed.updatedAt) && '　'}
              {formatMs(preview.parsed.updatedAt) && <>更新：{formatMs(preview.parsed.updatedAt)}</>}
            </p>
          )}
          {!preview.hasFrontmatter && (
            <p className="mt-1 text-[11px]" style={{ color: '#A6AEC0' }}>
              ※ MyBrain形式の情報が見つからなかったため、ファイルの内容をそのまま表示しています。
            </p>
          )}
          <div className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-[#F3F4FA] bg-white px-3 py-2">
            <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ color: '#3A4358' }}>
              {preview.parsed.body || '（本文はありません）'}
            </p>
          </div>
          <p className="mt-1 text-[10px]" style={{ color: '#A6AEC0' }}>
            表示のみ（このプレビューからの保存・編集はできません）。メモ本体はMyBrainに保存されています。
          </p>
        </div>
      )}
    </div>
  );
}
