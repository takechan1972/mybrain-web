import type { SVGProps } from 'react';

/**
 * 一貫したストロークアイコン（絵文字を使わずプロ仕様に）。
 * 既定サイズ20・stroke 1.8。currentColor で色は親から継承。
 */
type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: P) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

export const SearchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3-3" />
  </svg>
);

export const SlidersIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6h11M19 6h1M4 12h1M9 12h11M4 18h7M15 18h5" />
    <circle cx="17" cy="6" r="2" />
    <circle cx="7" cy="12" r="2" />
    <circle cx="13" cy="18" r="2" />
  </svg>
);

export const ChevronLeftIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m15 6-6 6 6 6" />
  </svg>
);

export const ChevronRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const MicIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const ImageIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m4 18 5-5 4 4 3-3 4 4" />
  </svg>
);

export const PaperclipIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 11.5 12 19a4 4 0 0 1-6-6l8-8a2.6 2.6 0 0 1 4 4l-8 8a1.2 1.2 0 0 1-2-2l7-7" />
  </svg>
);

export const MaximizeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3" />
  </svg>
);

export const SendIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 19V6M6 11l6-6 6 6" />
  </svg>
);

export const HomeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m4 11 8-7 8 7" />
    <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
  </svg>
);

export const ClockIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4l3 2" />
  </svg>
);

export const SettingsIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L16.2 3H7.8l-.4 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 3 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.5h8.4l.4-2.5c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
  </svg>
);

export const BellIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 7h16c0-1-2-2-2-7Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

export const FileTextIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3Z" />
    <path d="M14 3v5h4.5" />
    <path d="M9 12h6M9 16h6" />
  </svg>
);

export const ChatIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z" />
    <path d="M9 11.5h.01M13 11.5h.01M17 11.5h.01" strokeWidth={2.4} />
  </svg>
);

export const CalendarIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
  </svg>
);

export const BrainIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5a3 3 0 0 0-5 2 3 3 0 0 0-1 5 3 3 0 0 0 3 4 3 3 0 0 0 3 2V5Z" />
    <path d="M12 5a3 3 0 0 1 5 2 3 3 0 0 1 1 5 3 3 0 0 1-3 4 3 3 0 0 1-3 2V5Z" />
  </svg>
);
