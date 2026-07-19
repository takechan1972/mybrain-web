'use client';

import { useRef, useState } from 'react';
import { listMemos } from '@/lib/memos';
import {
  IMPORT_MAX_FILES_PER_BATCH,
  buildImportCandidate,
  detectImportDuplicates,
  setImportAsNew,
  listImportTargets,
  type ImportCandidate,
  type ImportCandidateStatus,
} from '@/lib/import';

/**
 * メモ取り込み（インポート）のプレビューパネル（IMP2a・デスクトップのみ・確認のみ）。
 *
 * - 設計：docs/memo-import-design.md（OBS43）§12・§18。
 * - ファイル選択 → 検証・解析・重複検知（IMP1 の純ヘルパーを再利用）→ プレビュー表示のみ。
 * - この IMP2a では保存しない：Supabase への insert・update・delete は一切呼ばない
 *   （createMemoWithTimestamps／createMemo は import もしていない）。保存は IMP2b で接続する。
 * - 既存メモ一覧は選択バッチごとに1回だけ読み取り、重複検知にのみ使う（読み取り専用）。
 * - 候補・選択状態は React state のみで保持する（Supabase・localStorage に保存しない）。
 */

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const PURPLE = '#7B61FF';
const LAVENDER = '#EEF0FF';

/** 「⬇ インポート（データ取込）」行からのスクロール先アンカー */
export const MEMO_IMPORT_SECTION_ID = 'memo-import-section';

/** 本文抜粋の長さ（約200字。既存の AI 参照抜粋と同じ長さ基準・設計 §12） */
const IMPORT_PREVIEW_EXCERPT_CHARS = 200;

/** 状態バッジの表示（設計 §12） */
const STATUS_BADGES: Record<ImportCandidateStatus, { label: string; bg: string; color: string }> = {
  ok: { label: '取り込み可能', bg: '#E8F8EE', color: '#1B8A4B' },
  'duplicate-id': { label: '重複（同じメモID）', bg: '#EEF0F5', color: '#54607A' },
  'duplicate-content': { label: '重複の可能性', bg: '#FEFCE8', color: '#9A7B27' },
  invalid: { label: 'エラー', bg: '#FDECEC', color: '#C0392B' },
};

type PanelState =
  | { kind: 'idle' }
  | { kind: 'loading'; total: number }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; candidates: ImportCandidate[] };

/** epoch ms → "YYYY/MM/DD HH:mm"（無効なら空文字） */
function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 本文の冒頭抜粋（約200字） */
function excerptBody(body: string): string {
  const text = body.trim();
  if (text.length <= IMPORT_PREVIEW_EXCERPT_CHARS) return text;
  return `${text.slice(0, IMPORT_PREVIEW_EXCERPT_CHARS)}…`;
}

/** 1ファイルのテキスト読み取り。失敗は null（buildImportCandidate 側で理由付き invalid になる） */
async function readFileText(file: File): Promise<string | null> {
  try {
    return await file.text();
  } catch {
    return null;
  }
}

export default function MemoImportPanel() {
  const [state, setState] = useState<PanelState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  // 選択バッチの世代番号。新しい選択・クリアで進め、古い非同期結果は捨てる。
  const batchIdRef = useRef(0);

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // 同じファイルをもう一度選んでも change が発火するようにリセット
    e.target.value = '';
    if (files.length === 0) return;

    const batchId = ++batchIdRef.current;

    // 21件以上は案内を出して取り込みを開始しない（先頭20件だけ処理する方式は採らない・設計 §3）
    if (files.length > IMPORT_MAX_FILES_PER_BATCH) {
      setState({
        kind: 'error',
        message: `一度に選べるのは最大${IMPORT_MAX_FILES_PER_BATCH}件までです（${files.length}件が選ばれています）。ファイルを減らして、もう一度お試しください。`,
      });
      return;
    }

    setState({ kind: 'loading', total: files.length });

    // 既存メモ一覧はバッチごとに1回だけ取得する（重複検知に使う・読み取りのみ）
    const { memos, error } = await listMemos();
    if (batchId !== batchIdRef.current) return;
    if (error) {
      setState({
        kind: 'error',
        message: '既存メモの一覧を取得できなかったため、重複の確認ができません。時間をおいて、もう一度お試しください。',
      });
      return;
    }

    const importTimeMs = Date.now();
    const candidates: ImportCandidate[] = [];
    for (const file of files) {
      const markdownText = await readFileText(file);
      candidates.push(
        buildImportCandidate({
          fileName: file.name,
          fileSizeBytes: file.size,
          markdownText,
          importTimeMs,
        }),
      );
    }
    if (batchId !== batchIdRef.current) return;

    setState({ kind: 'loaded', candidates: detectImportDuplicates(candidates, memos) });
  }

  // 「重複の可能性」のチェック切替（setImportAsNew は対象外の status を変更しない）
  function toggleImportAsNew(index: number, value: boolean) {
    setState((prev) => {
      if (prev.kind !== 'loaded') return prev;
      return {
        kind: 'loaded',
        candidates: prev.candidates.map((c, i) => (i === index ? setImportAsNew(c, value) : c)),
      };
    });
  }

  function clearSelection() {
    batchIdRef.current += 1; // 進行中の読み取り結果があっても捨てる
    setState({ kind: 'idle' });
  }

  const loading = state.kind === 'loading';
  const candidates = state.kind === 'loaded' ? state.candidates : null;
  const counts = candidates
    ? {
        total: candidates.length,
        ok: candidates.filter((c) => c.status === 'ok').length,
        duplicateId: candidates.filter((c) => c.status === 'duplicate-id').length,
        duplicateContent: candidates.filter((c) => c.status === 'duplicate-content').length,
        invalid: candidates.filter((c) => c.status === 'invalid').length,
        importable: listImportTargets(candidates).length,
      }
    : null;

  return (
    <div id={MEMO_IMPORT_SECTION_ID} className="mt-6">
      <h3 className="text-[14px] font-extrabold" style={{ color: NAVY }}>メモの取り込み（インポート）</h3>
      <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
        Obsidian互換のMarkdownファイル（.md）を選んで、MyBrainのメモとして取り込む内容を確認できます。
        1ファイル1MBまで・1回最大{IMPORT_MAX_FILES_PER_BATCH}件です。
      </p>

      {/* 固定の注意書き（設計 §12） */}
      <p className="mt-3 rounded-xl px-3 py-2 text-[12px] font-bold" style={{ backgroundColor: LAVENDER, color: NAVY }}>
        既存のメモは変更されません。取り込み可能なメモだけを新しいメモとして追加します。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".md,text/markdown"
          onChange={handleFilesSelected}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="rounded-xl px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50"
          style={{ background: PURPLE }}>
          Markdownファイルを選択
        </button>
        {(state.kind === 'loaded' || state.kind === 'error') && (
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-xl border px-3 py-2 text-[12px] font-bold"
            style={{ borderColor: '#E8EAF3', color: NAVY }}>
            選択をクリア
          </button>
        )}
      </div>

      {state.kind === 'loading' && (
        <p className="mt-3 text-[12px] font-semibold" style={{ color: NAVY }}>
          {state.total}件のファイルを確認しています…
        </p>
      )}

      {state.kind === 'error' && (
        <p className="mt-3 rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#FDECEC', color: '#C0392B' }}>
          {state.message}
        </p>
      )}

      {candidates && counts && (
        <div className="mt-3 flex flex-col gap-3">
          {/* 合計サマリ（設計 §12） */}
          <div className="flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: '#EEF0F5', color: NAVY }}>選択 {counts.total}件</span>
            <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: STATUS_BADGES.ok.bg, color: STATUS_BADGES.ok.color }}>取り込み可能 {counts.ok}件</span>
            <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: STATUS_BADGES['duplicate-id'].bg, color: STATUS_BADGES['duplicate-id'].color }}>重複（同じメモID） {counts.duplicateId}件</span>
            <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: STATUS_BADGES['duplicate-content'].bg, color: STATUS_BADGES['duplicate-content'].color }}>重複の可能性 {counts.duplicateContent}件</span>
            <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: STATUS_BADGES.invalid.bg, color: STATUS_BADGES.invalid.color }}>エラー {counts.invalid}件</span>
          </div>

          {/* 各ファイルのプレビュー */}
          {candidates.map((c, index) => {
            const badge = STATUS_BADGES[c.status];
            return (
              <div key={`${c.fileName}-${index}`} className="rounded-2xl border px-4 py-3" style={{ borderColor: '#E8EAF3', background: '#FBFBFE' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all text-[11px]" style={{ color: MUTED }}>{c.fileName}</p>
                    <p className="text-[13px] font-bold" style={{ color: NAVY }}>
                      {c.parsed ? (c.parsed.title || '無題') : '—'}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ backgroundColor: badge.bg, color: badge.color }}>
                    {badge.label}
                  </span>
                </div>

                {c.parsed && (
                  <>
                    {c.parsed.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.parsed.tags.map((tag) => (
                          <span key={tag} className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: LAVENDER, color: PURPLE }}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>
                      作成 {formatMs(c.parsed.createdAt)}（{c.parsed.createdFromFrontmatter ? '元のメモの日時' : '取り込み時刻'}）
                      ／ 更新 {formatMs(c.parsed.updatedAt)}（{c.parsed.updatedFromFrontmatter ? '元のメモの日時' : '取り込み時刻'}）
                    </p>
                    {c.parsed.body.trim().length > 0 && (
                      <p className="mt-2 whitespace-pre-wrap break-words rounded-xl border px-3 py-2 text-[12px] leading-relaxed" style={{ borderColor: '#EEF0F5', backgroundColor: '#ffffff', color: '#1F2937' }}>
                        {excerptBody(c.parsed.body)}
                      </p>
                    )}
                  </>
                )}

                {c.reason && (
                  <p className="mt-2 text-[12px] font-semibold" style={{ color: c.status === 'invalid' ? '#C0392B' : '#9A7B27' }}>
                    {c.reason}
                  </p>
                )}

                {/* 「重複の可能性」のみ、新しいメモとして取り込むかを選べる（既定 OFF・設計 §10） */}
                {c.status === 'duplicate-content' && (
                  <label className="mt-2 flex items-center gap-2 text-[12px] font-bold" style={{ color: NAVY }}>
                    <input
                      type="checkbox"
                      checked={c.importAsNew}
                      onChange={(e) => toggleImportAsNew(index, e.target.checked)}
                      className="h-4 w-4 accent-[#7B61FF]"
                    />
                    新しいメモとして取り込む
                  </label>
                )}
              </div>
            );
          })}

          {/* 取り込みアクション（IMP2a では保存しない：ボタンは常に無効） */}
          <div className="rounded-2xl border px-4 py-3" style={{ borderColor: '#E8EAF3', background: '#FBFBFE' }}>
            <p className="text-[12px] font-bold" style={{ color: NAVY }}>
              取り込み対象：{counts.importable}件
              （取り込み可能＋「新しいメモとして取り込む」を選んだ重複の可能性）
            </p>
            <button
              type="button"
              disabled
              className="mt-2 rounded-xl px-4 py-2 text-[12px] font-bold text-white opacity-50"
              style={{ background: PURPLE }}>
              保存は次のステップで対応
            </button>
            <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>
              現在は取り込み内容の確認のみできます。まだMyBrainには保存されません。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
