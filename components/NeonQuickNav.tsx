'use client';

import Link from 'next/link';

/**
 * 下部ネオンクイックナビ（メモ / 予定 / AI）。
 * メモ画面（app/memos/page.tsx）下部の NeonCard と同じ見た目を、各画面で共通利用するための固定ナビ。
 * - メモ → /memos ・ 予定 → /reservations ・ AI → /consult
 * - 画面最下部に固定。iPhone の safe-area-inset-bottom に対応。
 */
export default function NeonQuickNav() {
  return (
    <nav
      className="fixed inset-x-0 z-30 mx-auto w-full max-w-md px-5"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
      <div className="grid grid-cols-3 gap-3">
        <NeonNavCard href="/memos" color="#22E5A8" title="メモ" icon={<NeonMemoIcon color="#22E5A8" />} />
        <NeonNavCard href="/reservations" color="#38BDF8" title="予定" icon={<NeonCalendarIcon color="#38BDF8" />} />
        <NeonNavCard href="/consult" color="#A66BFF" title="AI" icon={<NeonChatIcon color="#A66BFF" />} />
      </div>
    </nav>
  );
}

/* ネオン機能カード（メモ画面 NeonCard の非アクティブ表示に合わせたリンク版） */
function NeonNavCard({
  href,
  color,
  title,
  icon,
}: {
  href: string;
  color: string;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} aria-label={title} className="block active:scale-95">
      <div
        className="relative flex h-full flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center"
        style={{
          background: 'linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(10,12,28,0.6) 70%)',
          border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: 'none',
        }}>
        <span style={{ opacity: 0.85 }}>{icon}</span>
        <span className="text-[14px] font-bold" style={{ color: 'rgba(255,255,255,0.82)' }}>
          {title}
        </span>
      </div>
    </Link>
  );
}

/* ネオンSVGアイコン（メモ画面と同一） */
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function glow(color: string) {
  return { filter: `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 12px ${hexA(color, 0.5)})` };
}

function NeonMemoIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={glow(color)}>
      <rect x="9" y="5" width="24" height="32" rx="3.5" stroke={color} strokeWidth="2.2" />
      <line x1="14" y1="13" x2="27" y2="13" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="19" x2="27" y2="19" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="25" x2="22" y2="25" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M31 30 L41 20 L44 23 L34 33 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function NeonCalendarIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={glow(color)}>
      <rect x="6" y="9" width="36" height="31" rx="4" stroke={color} strokeWidth="2.2" />
      <line x1="6" y1="18" x2="42" y2="18" stroke={color} strokeWidth="2" />
      <line x1="16" y1="5" x2="16" y2="13" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="32" y1="5" x2="32" y2="13" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="15" cy="26" r="2.3" fill={color} /><circle cx="24" cy="26" r="2.3" fill={color} /><circle cx="33" cy="26" r="2.3" fill={color} />
      <circle cx="15" cy="33" r="2.3" fill={color} /><circle cx="24" cy="33" r="2.3" fill={color} />
    </svg>
  );
}

function NeonChatIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={glow(color)}>
      <path d="M6 10 Q6 6 10 6 H38 Q42 6 42 10 V27 Q42 31 38 31 H15 L7 41 V31 Q6 31 6 27 Z" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="17" cy="19" r="2.6" fill={color} /><circle cx="24" cy="19" r="2.6" fill={color} /><circle cx="31" cy="19" r="2.6" fill={color} />
    </svg>
  );
}
