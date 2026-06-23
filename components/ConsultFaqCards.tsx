'use client';

import { useState } from 'react';
import type { QaRecord } from '@/lib/knowledge';

/**
 * AI相談の回答の下に、関連する公開FAQ（chatbot_knowledge / is_public=true）を
 * 参照カードとして表示する。
 * - カードをタップすると回答をその場で開閉する（FAQには詳細ページが無いためインライン開閉）。
 * - 該当が無ければ何も表示しない。
 * - 表示するのは管理者が公開した（is_public=true）FAQのみ（取得側で限定済み）。
 * - variant: スマホ相談=ダーク宇宙UI / デスクトップ相談=ライトUI。両画面で同じカードを使う。
 */
type Variant = 'dark' | 'light';

const THEME: Record<
  Variant,
  {
    border: string;
    heading: string;
    cardBg: string;
    cardBorder: string;
    badgeBg: string;
    badgeColor: string;
    category: string;
    question: string;
    mark: string;
    answer: string;
  }
> = {
  dark: {
    border: 'rgba(120,160,255,0.15)',
    heading: '#7CA6E8',
    cardBg: 'rgba(20,28,56,0.6)',
    cardBorder: 'rgba(120,160,255,0.28)',
    badgeBg: 'rgba(56,189,248,0.16)',
    badgeColor: '#7dd3fc',
    category: '#9fb0e0',
    question: '#ffffff',
    mark: '#9fb0e0',
    answer: '#dbe4ff',
  },
  light: {
    border: '#EEF0F5',
    heading: '#223A70',
    cardBg: '#FFFFFF',
    cardBorder: '#E8EAF3',
    badgeBg: '#EEF0FF',
    badgeColor: '#7B61FF',
    category: '#A6AEC0',
    question: '#1F2937',
    mark: '#A6AEC0',
    answer: '#54607A',
  },
};

export default function ConsultFaqCards({ items, variant = 'dark' }: { items: QaRecord[]; variant?: Variant }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!items || items.length === 0) return null;
  const c = THEME[variant];

  return (
    <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: c.border }}>
      <p className="text-[11px] font-bold" style={{ color: c.heading }}>関連するよくある質問</p>
      {items.map((q) => {
        const open = openId === q.id;
        return (
          <div
            key={q.id}
            className="overflow-hidden rounded-2xl border"
            style={{ background: c.cardBg, borderColor: c.cardBorder }}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : q.id)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left active:opacity-70">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
                style={{ background: c.badgeBg, color: c.badgeColor }}>
                Q
              </span>
              <span className="min-w-0 flex-1">
                {q.category && (
                  <span className="mr-1 text-[10px] font-bold" style={{ color: c.category }}>[{q.category}]</span>
                )}
                <span className="text-[13px] font-semibold" style={{ color: c.question }}>{q.question}</span>
              </span>
              <span className="shrink-0 text-[14px] font-bold" style={{ color: c.mark }}>{open ? '−' : '＋'}</span>
            </button>
            {open && (
              <div className="px-3 pb-3 pl-12">
                <p className="whitespace-pre-line text-[13px] leading-relaxed" style={{ color: c.answer }}>{q.answer}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
