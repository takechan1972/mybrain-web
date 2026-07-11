'use client';

import { useState } from 'react';
import {
  requestGoogleDriveAccessToken,
  listDriveMarkdownFiles,
  readDriveMarkdownFile,
  DRIVE_MARKDOWN_READ_MAX_BYTES,
  type DriveMarkdownFileInfo,
} from '@/lib/google';
import { markdownToMemo } from '@/lib/markdown';
import type { DriveReferenceMemo } from '@/components/DriveExportedFilesList';
import { DRIVE_REF_AI_MAX_ITEMS } from '@/lib/ai/consult-ollama';

/**
 * モバイル用 Google Drive 参照メモパネル（OBS36 設計・Phase M1・/consult 専用）。
 *
 * - デスクトップの DriveExportedFilesList と同じ Drive ロジック（lib/google・markdownToMemo）を再利用する。
 *   見た目だけモバイル（ダーク・ネオン・グラス）に合わせた別コンポーネント（デスクトップは無変更）。
 * - 「一覧を確認」「参照に追加」を押したときだけ Drive に問い合わせる（自動読み込みなし・OAuth はタップ起点）。
 * - 参照メモは親（/consult ページ）が React state で保持する。メモリのみ・保存しない
 *   （Supabase・localStorage・相談履歴に入れない）。再読み込みで消える。
 * - 読み取り専用：Drive のファイルは変更しない。取り込み・双方向同期・プレビューはしない（Phase M1 スコープ外）。
 * - 設計：docs/mobile-drive-reference-ai-design.md
 */

interface MobileDriveReferencePanelProps {
  /** 現在の参照メモ（重複判定・トレイ表示に使う）。 */
  references: DriveReferenceMemo[];
  /** 参照メモの変更を親へ通知するコールバック。 */
  onReferenceChange: (next: DriveReferenceMemo[]) => void;
}

type ListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; files: DriveMarkdownFileInfo[] }
  | { kind: 'error' };

/** ISO 8601 → "YYYY/MM/DD HH:mm"（無効なら空文字）。 */
function formatModified(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function MobileDriveReferencePanel({ references, onReferenceChange }: MobileDriveReferencePanelProps) {
  // 折りたたみ（既定は閉じる＝既存画面の見た目を変えない）
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ListState>({ kind: 'idle' });
  const [addBusyId, setAddBusyId] = useState<string | null>(null);
  const [addNote, setAddNote] = useState<string | null>(null);

  // 選んだ1件の本文を読み取って解析する（デスクトップと同じ流れ・トークンは保存しない）。
  async function readAndParse(file: DriveMarkdownFileInfo) {
    const token = await requestGoogleDriveAccessToken();
    if (token.state === 'cancelled') return { ok: false as const, reason: 'cancelled' as const };
    if (token.state !== 'granted' || !token.accessToken) return { ok: false as const, reason: 'error' as const };
    const raw = await readDriveMarkdownFile(token.accessToken, file.id);
    const hasFrontmatter = /^---\r?\n/.test(raw);
    return { ok: true as const, parsed: markdownToMemo(raw), hasFrontmatter };
  }

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

  // 選んだ1件を「Google Drive参照」として親の state に追加する（AI 相談の参考にのみ使う・保存しない）。
  async function addReference(file: DriveMarkdownFileInfo) {
    setAddNote(null);
    if (references.some((r) => r.fileId === file.id)) {
      setAddNote(`「${file.name}」はすでに参照に追加されています。`);
      return;
    }
    if (file.size !== undefined && file.size > DRIVE_MARKDOWN_READ_MAX_BYTES) {
      setAddNote(`「${file.name}」は大きすぎるため参照に追加できません。`);
      return;
    }
    setAddBusyId(file.id);
    try {
      const r = await readAndParse(file);
      if (!r.ok) {
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
      onReferenceChange([...references, ref]);
      setAddNote(`「${file.name}」を参照に追加しました。`);
    } catch {
      setAddNote('参照に追加できませんでした。もう一度お試しください。');
    } finally {
      setAddBusyId(null);
    }
  }

  function removeReference(fileId: string) {
    onReferenceChange(references.filter((r) => r.fileId !== fileId));
  }

  function clearReferences() {
    onReferenceChange([]);
  }

  return (
    <div className="rounded-2xl border" style={{ background: 'rgba(10,14,32,0.78)', borderColor: 'rgba(120,160,255,0.3)' }}>
      {/* 見出し（タップで開閉。参照があるときは閉じていても件数が見える） */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-h-[48px] items-center gap-2 px-4 py-3 text-left active:opacity-70">
        <span className="text-[15px]">☁️</span>
        <span className="flex-1 text-[13px] font-semibold" style={{ color: 'rgba(220,230,255,0.9)' }}>
          Google Driveのメモを参考にする{references.length > 0 ? `（${references.length}件）` : ''}
        </span>
        <span
          className="shrink-0 text-[12px] transition-transform"
          style={{ color: '#7A86A8', transform: open ? 'rotate(90deg)' : 'none' }}>
          ▶
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2.5 px-4 pb-4" style={{ borderTop: '1px solid rgba(120,160,255,0.15)' }}>
          {/* やさしい説明（常時） */}
          <p className="pt-2.5 text-[11px] leading-relaxed" style={{ color: '#7A86A8' }}>
            Google Driveに書き出したメモを、この相談の参考にできます。
          </p>
          <p className="text-[11px] font-semibold leading-relaxed" style={{ color: '#F2D58A' }}>
            この参照メモは一時的です。再読み込みすると消えます。
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: '#7A86A8' }}>
            AI相談に使われるのは最大5件までです。
          </p>

          {/* 一覧を確認（タップ起点のみ・自動読み込みなし） */}
          <button
            type="button"
            onClick={loadList}
            disabled={state.kind === 'loading'}
            className="self-start rounded-full border px-4 py-2 text-[12px] font-semibold transition active:scale-95 disabled:opacity-40"
            style={{ background: 'rgba(20,28,60,0.5)', borderColor: 'rgba(120,160,255,0.3)', color: 'rgba(220,230,255,0.9)' }}>
            {state.kind === 'loading' ? '確認中…' : '一覧を確認'}
          </button>

          {state.kind === 'error' && (
            <p className="text-[12px]" style={{ color: '#7A86A8' }}>
              一覧を取得できませんでした。時間をおいてもう一度お試しください。
            </p>
          )}
          {state.kind === 'loaded' && state.files.length === 0 && (
            <p className="text-[12px]" style={{ color: '#7A86A8' }}>
              Google Driveに書き出したMarkdownはまだありません。
            </p>
          )}
          {state.kind === 'loaded' && state.files.length > 0 && (
            <ul className="max-h-48 overflow-y-auto">
              {state.files.map((f) => {
                const isReferenced = references.some((r) => r.fileId === f.id);
                return (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-2 py-1.5"
                    style={{ borderBottom: '1px solid rgba(120,160,255,0.12)' }}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[12px]" style={{ color: 'rgba(220,230,255,0.9)' }}>{f.name}</span>
                      <span className="text-[10px]" style={{ color: '#7A86A8' }}>{formatModified(f.modifiedTime)}</span>
                    </span>
                    {isReferenced ? (
                      <span
                        className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                        style={{ background: 'rgba(166,107,255,0.2)', color: '#C9A6FF' }}>
                        参照中
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addReference(f)}
                        disabled={addBusyId !== null}
                        className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition active:scale-95 disabled:opacity-40"
                        style={{ borderColor: 'rgba(120,160,255,0.3)', color: 'rgba(220,230,255,0.9)' }}>
                        {addBusyId === f.id ? '追加中…' : '参照に追加'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {addNote && <p className="text-[11px]" style={{ color: '#7A86A8' }}>{addNote}</p>}

          {/* 読み込み中トレイ（参照が1件以上のとき） */}
          {references.length > 0 && (
            <div className="rounded-2xl border border-dashed p-3" style={{ borderColor: 'rgba(166,107,255,0.4)', background: 'rgba(123,97,255,0.08)' }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-bold" style={{ color: 'rgba(220,230,255,0.95)' }}>
                  読み込み中のGoogle Drive参照メモ（{references.length}件）
                </p>
                <button
                  type="button"
                  onClick={clearReferences}
                  className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition active:scale-95"
                  style={{ borderColor: 'rgba(120,160,255,0.3)', color: '#9AA4C0' }}>
                  すべて解除
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {references.map((r, i) => {
                  const usedByAi = i < DRIVE_REF_AI_MAX_ITEMS;
                  return (
                    <div key={r.fileId} className="rounded-xl border p-2.5" style={{ borderColor: 'rgba(120,160,255,0.2)', background: 'rgba(8,10,24,0.6)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                            style={
                              usedByAi
                                ? { background: 'rgba(166,107,255,0.25)', color: '#C9A6FF' }
                                : { background: 'rgba(255,255,255,0.08)', color: '#7A86A8' }
                            }>
                            {usedByAi ? 'AIで使用' : 'AIには渡りません'}
                          </span>
                          <p className="truncate text-[12px] font-semibold" style={{ color: 'rgba(220,230,255,0.95)' }}>
                            {r.title || r.fileName}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeReference(r.fileId)}
                          className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition active:scale-95"
                          style={{ borderColor: 'rgba(120,160,255,0.3)', color: '#9AA4C0' }}>
                          参照を解除
                        </button>
                      </div>
                      <p className="mt-1 truncate text-[9px]" style={{ color: '#7A86A8' }}>ファイル：{r.fileName}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
