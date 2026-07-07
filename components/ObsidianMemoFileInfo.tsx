'use client';

import type { CSSProperties } from 'react';

/**
 * メモ詳細で「Obsidian用ファイル」の情報（ファイル名・保存場所）を表示する読み取り専用の小コンポーネント。
 *
 * - スマホ詳細（ダーク）とデスクトップ詳細（ライト）で重複していた JSX を共通化したもの。
 * - 表示のみ。ボタンや保存処理は持たない（実 Obsidian 保存は未実装）。
 */

type Variant = 'dark' | 'light';

interface ThemeStyle {
  box: CSSProperties;
  boxClass: string;
  heading: CSSProperties;
  text: CSSProperties;
  note: CSSProperties;
}

const THEME: Record<Variant, ThemeStyle> = {
  // スマホ詳細（ダークテーマ）
  dark: {
    boxClass: 'rounded-2xl border px-4 py-3',
    box: { borderColor: 'rgba(120,160,255,0.25)', background: 'rgba(10,14,32,0.5)' },
    heading: { color: '#a5b4fc' },
    text: { color: '#9fb0e0' },
    note: { color: '#8893c4' },
  },
  // デスクトップ詳細（ライトテーマ）
  light: {
    boxClass: 'rounded-xl border border-[#E8EAF3] bg-white px-3 py-2.5',
    box: {},
    heading: { color: '#223A70' },
    text: { color: '#8A94A6' },
    note: { color: '#9aa3b2' },
  },
};

interface Props {
  fileName: string;
  path: string;
  variant?: Variant;
}

export default function ObsidianMemoFileInfo({ fileName, path, variant = 'dark' }: Props) {
  const t = THEME[variant];
  return (
    <div className={t.boxClass} style={t.box}>
      <p className="text-[11px] font-bold" style={t.heading}>Obsidian用ファイル</p>
      <p className="mt-1 text-[11px] break-all" style={t.text}>ファイル名: {fileName}</p>
      <p className="mt-0.5 text-[11px] break-all" style={t.text}>保存場所: {path}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed" style={t.note}>
        ※ MyBrainが本体の保存先です。Markdownをダウンロードして、Obsidianに手動で入れてください。
      </p>
    </div>
  );
}
