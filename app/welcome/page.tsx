'use client';

import Link from 'next/link';
import Image from 'next/image';

/*
 * MyBrain ウェルカム画面。
 * - デザイン確定版の1枚絵 public/welcome-hero.png（853x1844）をそのまま表示。
 *   （ロゴ・文章・ボタンはすべて画像内。HTML/CSSでは再現しない）
 * - 画像比率にラッパーを固定し、ボタン位置へ透明クリック領域を重ねる。
 * - 100dvh / overflow-hidden（縦横ともスクロールなし）。背景は黒。
 *
 * 開発確認用：debugHotspots を true にすると透明リンク範囲を薄く可視化。
 * 通常は false（透明）。
 */
const debugHotspots = false;

/* 画像内ボタン位置（％）。ズレる場合は top/left/width/height を調整。 */
const HOTSPOTS: {
  label: string;
  href: string;
  top: string;
  left: string;
  width: string;
  height: string;
}[] = [
  // はじめる（青ネオンのメインボタン）
  { label: 'はじめる', href: '/login?mode=signup', top: '77%',   left: '8%',  width: '84%', height: '6.5%' },
  // ログイン（アウトラインボタン）
  { label: 'ログイン', href: '/login',             top: '84.5%', left: '8%',  width: '84%', height: '6%' },
  // 新規登録（右下テキストリンク）
  { label: '新規登録', href: '/login?mode=signup', top: '91.8%', left: '55%', width: '33%', height: '3%' },
];

export default function WelcomePage() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black"
      style={{ height: '100dvh' }}
    >
      {/* 画像比率に固定したラッパー（この中の％＝画像座標と一致） */}
      <div
        className="relative"
        style={{
          height: '100dvh',
          aspectRatio: '853 / 1844',
          maxWidth: '100vw',
        }}
      >
        <Image
          src="/welcome-hero.png"
          alt="MyBrain — あなたの第二の脳"
          fill
          priority
          sizes="(max-width: 768px) 100vw, 480px"
          className="object-contain"
        />

        {/* 透明クリック領域（画像内ボタンの上に重ねる） */}
        {HOTSPOTS.map((h) => (
          <Link
            key={h.label}
            href={h.href}
            aria-label={h.label}
            className="absolute block"
            style={{
              top: h.top,
              left: h.left,
              width: h.width,
              height: h.height,
              ...(debugHotspots
                ? { backgroundColor: 'rgba(0,200,255,0.25)', outline: '1px solid rgba(0,200,255,0.8)' }
                : {}),
            }}
          />
        ))}
      </div>
    </div>
  );
}
