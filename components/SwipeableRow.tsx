'use client';

import { useRef, useState, type PointerEvent, type ReactNode } from 'react';

const ACTION_W = 88; // 削除アクションの幅(px)
const OPEN_THRESHOLD = 44; // これ以上 左へスワイプしたら開く
const TAP_TOLERANCE = 8; // この範囲内の移動はタップ扱い（誤操作防止）

/**
 * 左スワイプで右側に赤い「削除」アクションを表示する行コンポーネント。
 * - タップ（ほぼ移動なし）は children のリンク遷移をそのまま通す。
 * - スワイプ中・開いている間はタップ遷移を抑止する。
 * - 開閉状態は親が制御（open / onOpenChange）。別の行を開くと前の行は閉じる。
 * - 縦スクロールは妨げない（touch-action: pan-y）。
 */
export default function SwipeableRow({
  open,
  onOpenChange,
  onDelete,
  children,
  deleteLabel = '削除',
  rounded = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  children: ReactNode;
  deleteLabel?: string;
  /** カード型は角丸(true)、リスト行型は角丸なし(false) */
  rounded?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const horizontal = useRef(false);
  const moved = useRef(false);

  const base = open ? -ACTION_W : 0;
  const translate = Math.max(-ACTION_W, Math.min(0, base + dx));

  function onPointerDown(e: PointerEvent) {
    dragging.current = true;
    horizontal.current = false;
    moved.current = false;
    startX.current = e.clientX;
    startY.current = e.clientY;
    setDx(0);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging.current) return;
    const ddx = e.clientX - startX.current;
    const ddy = e.clientY - startY.current;
    if (!horizontal.current) {
      if (Math.abs(ddx) <= TAP_TOLERANCE && Math.abs(ddy) <= TAP_TOLERANCE) return;
      // 横方向が優勢なときだけスワイプとして扱う（縦は通常スクロール）
      if (Math.abs(ddx) <= Math.abs(ddy)) {
        dragging.current = false;
        return;
      }
      horizontal.current = true;
    }
    moved.current = true;
    setDx(ddx);
  }

  function endDrag() {
    if (!dragging.current) return;
    dragging.current = false;
    const finalX = base + dx;
    onOpenChange(finalX <= -OPEN_THRESHOLD);
    setDx(0);
  }

  return (
    <div className={`relative overflow-hidden ${rounded ? 'rounded-3xl' : ''}`}>
      {/* 背面：赤い削除ボタン（前面が左へずれて現れる） */}
      <button
        type="button"
        aria-label="この予定を削除"
        onClick={onDelete}
        className="absolute inset-y-0 right-0 flex items-center justify-center text-[14px] font-bold text-white active:opacity-80"
        style={{ width: ACTION_W, backgroundColor: '#E05555' }}>
        {deleteLabel}
      </button>
      {/* 前面：本体。スワイプで左右に動く */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(e) => {
          // 開いている／スワイプした直後はタップ遷移を抑止する
          if (open) {
            e.preventDefault();
            e.stopPropagation();
            onOpenChange(false);
          } else if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        style={{
          transform: `translateX(${translate}px)`,
          transition: dragging.current ? 'none' : 'transform 0.2s ease',
          touchAction: 'pan-y',
        }}>
        {children}
      </div>
    </div>
  );
}
