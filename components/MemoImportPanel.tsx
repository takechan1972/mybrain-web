'use client';

import { useEffect, useRef, useState } from 'react';
import { listMemos } from '@/lib/memos';
import { createMemoWithTimestamps } from '@/lib/storage/supabase-memo-store';
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
 * メモ取り込み（インポート）パネル（IMP2a プレビュー＋IMP2b 保存・デスクトップのみ）。
 *
 * - 設計：docs/memo-import-design.md（OBS43）§12〜§16・§18。
 * - フロー：ファイル選択 → 検証・解析・重複検知（IMP1 の純ヘルパーを再利用）→ プレビュー
 *   → 明示的な確認（window.confirm・10件以上は先に段階的警告）→ insert-only 保存 → 結果サマリ。
 * - 保存対象は listImportTargets(candidates) の結果のみ（選別ルールをここで再実装しない）。
 * - insert は取り込み専用の createMemoWithTimestamps だけを使う。元メモの id・sourceId・source は
 *   決して渡さない（Supabase が新しいメモIDを採番）。既存メモの update・delete は呼ばない。
 *   Obsidian ローカル・Google Drive への書き出しもしない（設計 §14）。
 * - 1件の失敗で残りを止めない。自動リトライ・成功分のロールバックはしない（結果を正直に表示・設計 §16）。
 * - 既存メモ一覧は選択バッチごとに1回だけ読み取り、重複検知にのみ使う（読み取り専用）。
 * - 候補・選択状態・結果は React state のみで保持する（Supabase・localStorage に保存しない）。
 */

const NAVY = '#223A70';
const MUTED = '#8A94A6';
const PURPLE = '#7B61FF';
const LAVENDER = '#EEF0FF';

/** 「⬇ インポート（データ取込）」行からのスクロール先アンカー */
export const MEMO_IMPORT_SECTION_ID = 'memo-import-section';

/** 本文抜粋の長さ（約200字。既存の AI 参照抜粋と同じ長さ基準・設計 §12） */
const IMPORT_PREVIEW_EXCERPT_CHARS = 200;

/** 「多い」とみなす取り込み件数のしきい値（既存の一括エクスポート警告と同じ値・設計 §13） */
const LARGE_IMPORT_WARNING_COUNT = 10;

/** 状態バッジの表示（設計 §12） */
const STATUS_BADGES: Record<ImportCandidateStatus, { label: string; bg: string; color: string }> = {
  ok: { label: '取り込み可能', bg: '#E8F8EE', color: '#1B8A4B' },
  'duplicate-id': { label: '重複（同じメモID）', bg: '#EEF0F5', color: '#54607A' },
  'duplicate-content': { label: '重複の可能性', bg: '#FEFCE8', color: '#9A7B27' },
  invalid: { label: 'エラー', bg: '#FDECEC', color: '#C0392B' },
};

/** 保存に失敗した1件（結果サマリ用） */
interface ImportSaveFailure {
  fileName: string;
  title: string;
  reason: string;
}

/** 保存完了後の結果サマリ（設計 §16。パネル内に常設表示する） */
interface ImportSaveSummary {
  /** 追加できた件数 */
  added: number;
  /** スキップ内訳：重複（同じメモID） */
  skippedDuplicateId: number;
  /** スキップ内訳：「新しいメモとして取り込む」を選ばなかった重複の可能性 */
  skippedDuplicateContent: number;
  /** スキップ内訳：エラー（不正ファイル等） */
  skippedInvalid: number;
  /** insert に失敗した項目（ファイル名・タイトル・理由） */
  failed: ImportSaveFailure[];
  /** 選択したファイルの総数 */
  total: number;
}

type PanelState =
  | { kind: 'idle' }
  | { kind: 'loading'; total: number }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; candidates: ImportCandidate[] }
  | { kind: 'saving'; candidates: ImportCandidate[]; done: number; total: number }
  | { kind: 'done'; candidates: ImportCandidate[]; summary: ImportSaveSummary };

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
  // 選択バッチ・保存ループの世代番号。新しい選択・クリア・アンマウントで進め、古い非同期処理を止める。
  const batchIdRef = useRef(0);

  // アンマウント時は世代を無効化し、進行中の保存ループを「次の insert の前」で停止させる。
  // 実行中の insert は完了を待ち、保存済みのメモはそのまま残す（ロールバックしない・設計 §16）。
  // 世代が変わった後は setState もしない（アンマウント後の state 更新をしない）。
  useEffect(() => {
    return () => {
      batchIdRef.current += 1;
    };
  }, []);

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    if (state.kind === 'saving') return; // 保存中はバッチを変更しない（ボタン無効化と二重の防御）
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
    if (state.kind === 'saving') return; // 保存中はクリアできない（ボタン無効化と二重の防御）
    batchIdRef.current += 1; // 進行中の読み取り結果があっても捨てる
    setState({ kind: 'idle' });
  }

  /**
   * 取り込みの実行（IMP2b・設計 §13・§15・§16）。
   * - 確認（10件以上は段階的警告→件数入り確認）を経たときだけ保存を開始する。
   * - 対象は listImportTargets のスナップショットのみ。1件ずつ順に insert し、失敗しても残りを続ける。
   * - 各 insert の開始前と await 後に世代を確認し、無効なら次の insert を始めずに停止する。
   */
  async function handleImport() {
    if (state.kind !== 'loaded') return; // 状態ガード（二重送信防止）
    // スナップショット：確認・保存中に候補が変わらないよう、この時点の配列で固定する
    const candidates = state.candidates;
    const targets = listImportTargets(candidates);
    if (targets.length === 0) return;

    // 10件以上は先に段階的警告（既存の一括エクスポートと同じ方式・設計 §13）
    if (targets.length >= LARGE_IMPORT_WARNING_COUNT) {
      const proceed = window.confirm(
        `取り込み件数が多いため、保存に少し時間がかかる場合があります。${targets.length}件を取り込みます。続けますか？`,
      );
      if (!proceed) return;
    }
    const ok = window.confirm(
      `${targets.length}件のメモをMyBrainに新しいメモとして取り込みます。既存のメモは変更されません。よろしいですか？`,
    );
    if (!ok) return;

    const batchId = batchIdRef.current; // この保存の世代（クリア・新選択・アンマウントで無効になる）
    setState({ kind: 'saving', candidates, done: 0, total: targets.length });

    let added = 0;
    const failed: ImportSaveFailure[] = [];
    for (const target of targets) {
      // insert の開始前に世代を確認：無効ならこれ以上 insert を始めない（保存済み分はそのまま残す）
      if (batchId !== batchIdRef.current) return;
      const parsed = target.parsed;
      if (!parsed) continue; // listImportTargets が parsed 非 null を保証（型ガードのみ）

      try {
        // 取り込み専用の insert-only 保存。元メモの id・sourceId・source は渡さない（新IDはDB採番）。
        const result = await createMemoWithTimestamps(
          {
            title: parsed.title,
            body: parsed.body,
            tags: parsed.tags,
            images: [],
          },
          {
            createdAtMs: parsed.createdAt,
            updatedAtMs: parsed.updatedAt,
          },
        );
        if (result.memo) {
          added += 1;
        } else {
          failed.push({
            fileName: target.fileName,
            title: parsed.title || '無題',
            reason: result.error || '保存結果を確認できませんでした。',
          });
        }
      } catch {
        // 予期しない例外もそのファイルの失敗として記録し、次の対象へ続ける
        failed.push({
          fileName: target.fileName,
          title: parsed.title || '無題',
          reason: '保存中に予期しないエラーが発生しました。',
        });
      }

      // await 後にも世代を確認してから state を更新する（アンマウント後の setState をしない）
      if (batchId !== batchIdRef.current) return;
      setState({ kind: 'saving', candidates, done: added + failed.length, total: targets.length });
    }

    if (batchId !== batchIdRef.current) return;
    setState({
      kind: 'done',
      candidates,
      summary: {
        added,
        skippedDuplicateId: candidates.filter((c) => c.status === 'duplicate-id').length,
        skippedDuplicateContent: candidates.filter((c) => c.status === 'duplicate-content' && !c.importAsNew).length,
        skippedInvalid: candidates.filter((c) => c.status === 'invalid').length,
        failed,
        total: candidates.length,
      },
    });
  }

  const busy = state.kind === 'loading' || state.kind === 'saving';
  const candidates =
    state.kind === 'loaded' || state.kind === 'saving' || state.kind === 'done' ? state.candidates : null;
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
        Obsidian互換のMarkdownファイル（.md）を選んで、内容を確認したうえでMyBrainのメモとして取り込めます。
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
          disabled={busy}
          className="rounded-xl px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50"
          style={{ background: PURPLE }}>
          Markdownファイルを選択
        </button>
        {state.kind !== 'idle' && state.kind !== 'loading' && (
          <button
            type="button"
            onClick={clearSelection}
            disabled={state.kind === 'saving'}
            className="rounded-xl border px-3 py-2 text-[12px] font-bold disabled:opacity-50"
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

          {/* 各ファイルのプレビュー（保存中・完了後も表示を保つ） */}
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

                {/* 「重複の可能性」のみ、新しいメモとして取り込むかを選べる（既定 OFF・設計 §10）。保存中・完了後は変更不可 */}
                {c.status === 'duplicate-content' && (
                  <label className="mt-2 flex items-center gap-2 text-[12px] font-bold" style={{ color: NAVY }}>
                    <input
                      type="checkbox"
                      checked={c.importAsNew}
                      disabled={state.kind !== 'loaded'}
                      onChange={(e) => toggleImportAsNew(index, e.target.checked)}
                      className="h-4 w-4 accent-[#7B61FF] disabled:opacity-50"
                    />
                    新しいメモとして取り込む
                  </label>
                )}
              </div>
            );
          })}

          {/* 取り込みアクション（loaded のみ。確認 OK のときだけ保存を開始する・設計 §13） */}
          {state.kind === 'loaded' && (
            <div className="rounded-2xl border px-4 py-3" style={{ borderColor: '#E8EAF3', background: '#FBFBFE' }}>
              <p className="text-[12px] font-bold" style={{ color: NAVY }}>
                取り込み対象：{counts.importable}件
                （取り込み可能＋「新しいメモとして取り込む」を選んだ重複の可能性）
              </p>
              <button
                type="button"
                onClick={handleImport}
                disabled={counts.importable === 0}
                className="mt-2 rounded-xl px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50"
                style={{ background: PURPLE }}>
                {counts.importable}件をMyBrainに取り込む
              </button>
              <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>
                ボタンを押した後の確認でOKしたときだけ保存されます。ファイル選択だけでは保存されません。
              </p>
            </div>
          )}

          {/* 保存中の進捗（1件ごとに更新） */}
          {state.kind === 'saving' && (
            <div className="rounded-2xl border px-4 py-3" style={{ borderColor: '#E8EAF3', background: '#FBFBFE' }}>
              <p className="text-[12px] font-bold" style={{ color: NAVY }}>
                取り込み中… {state.done} / {state.total}件
              </p>
              <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>
                保存が終わるまで、この画面を開いたままお待ちください。
              </p>
            </div>
          )}

          {/* 結果サマリ（完了後は「選択をクリア」か新しい選択まで表示し続ける。取り込みボタンは出さない＝同じバッチの再送信不可） */}
          {state.kind === 'done' && (() => {
            const { summary } = state;
            const skippedTotal = summary.skippedDuplicateId + summary.skippedDuplicateContent + summary.skippedInvalid;
            const failedCount = summary.failed.length;
            return (
              <div className="rounded-2xl border px-4 py-3" style={{ borderColor: '#E8EAF3', background: '#FBFBFE' }}>
                <p className="text-[13px] font-extrabold" style={{ color: NAVY }}>取り込み結果</p>

                {summary.added > 0 && failedCount === 0 && (
                  <p className="mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#E8F8EE', color: '#1B8A4B' }}>
                    取り込みが完了しました。{summary.added}件を新しいメモとして追加しました。
                  </p>
                )}
                {summary.added > 0 && failedCount > 0 && (
                  <p className="mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#FEFCE8', color: '#9A7B27' }}>
                    一部のメモは追加済みです。追加済みのメモはそのまま残ります。失敗した分だけ、ファイルを選び直してやり直せます。
                  </p>
                )}
                {summary.added === 0 && failedCount > 0 && (
                  <p className="mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#FDECEC', color: '#C0392B' }}>
                    メモは1件も追加されませんでした。時間をおいて、もう一度お試しください。
                  </p>
                )}
                {summary.added === 0 && failedCount === 0 && (
                  <p className="mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#EEF0F5', color: '#54607A' }}>
                    取り込み対象がなかったため、メモは追加されませんでした。
                  </p>
                )}

                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                  <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: '#E8F8EE', color: '#1B8A4B' }}>追加 {summary.added}件</span>
                  <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: '#EEF0F5', color: '#54607A' }}>スキップ {skippedTotal}件</span>
                  <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: '#FDECEC', color: '#C0392B' }}>失敗 {failedCount}件</span>
                </div>
                <p className="mt-1.5 text-[11px]" style={{ color: MUTED }}>
                  スキップ内訳：重複（同じメモID） {summary.skippedDuplicateId}件・
                  重複の可能性（未選択） {summary.skippedDuplicateContent}件・
                  エラー {summary.skippedInvalid}件
                </p>

                {failedCount > 0 && (
                  <div className="mt-2">
                    <p className="text-[12px] font-bold" style={{ color: '#C0392B' }}>失敗したファイル</p>
                    <ul className="mt-1 flex flex-col gap-1 text-[11px]" style={{ color: '#C0392B' }}>
                      {summary.failed.map((f, i) => (
                        <li key={`${f.fileName}-${i}`} className="break-all">
                          ・{f.fileName}（{f.title}）：{f.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.added > 0 && (
                  <p className="mt-2 text-[11px]" style={{ color: MUTED }}>
                    追加したメモは、メモ画面を開くと一覧に表示されます。
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
