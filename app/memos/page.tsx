'use client';

import Link from 'next/link';
import NextImage from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ImageIcon, SendIcon } from '@/components/icons';
import VoiceInput from '@/components/VoiceInput';
import { createMemo, parseTags } from '@/lib/memos';
import DesktopMemos from '@/components/DesktopMemos';

const TITLE_MAX = 100;
const BODY_MAX = 10000;

/** data URI 画像を最大1280pxに縮小し JPEG(0.8) で再エンコード（巨大写真の保存失敗対策） */
function compressDataUri(dataUri: string, maxSize = 1280, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('image load failed'));
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      // 既に小さい画像はそのまま使う
      if (scale >= 1 && dataUri.length < 500_000) {
        resolve(dataUri);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUri;
  });
}

export default function MemosPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // AI質問バー（/consult のマイク付き入力バーと同じ仕組み。VoiceInput で音声入力 → /consult へ受け渡し）
  const [aiAsk, setAiAsk] = useState('');
  const aiBaseRef = useRef('');
  function goConsultFromMemo() {
    const q = aiAsk.trim();
    router.push(q ? `/consult?q=${encodeURIComponent(q)}` : '/consult');
  }

  // 選択画像を縮小して data URI 化（スマホ写真は数MB→base64で巨大になり保存に失敗するため、
  // 最大1280pxへリサイズ＋JPEG圧縮してから images jsonb に保存する）
  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setSaveError(null);
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onerror = () => setSaveError('画像の読み込みに失敗しました。');
      reader.onload = () => {
        const raw = typeof reader.result === 'string' ? reader.result : '';
        if (!raw) return;
        compressDataUri(raw)
          .then((uri) => setImages((prev) => [...prev, uri]))
          .catch(() => setImages((prev) => [...prev, raw]));
      };
      reader.readAsDataURL(file);
    });
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  // 保存完了フラッシュメッセージ（他画面から戻ったとき）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const flash = window.sessionStorage.getItem('memo_flash');
      if (flash) {
        setSaveOk(flash);
        window.sessionStorage.removeItem('memo_flash');
      }
    }
  }, []);

  async function handleSave() {
    setSaveError(null);
    setSaveOk(null);
    if (title.trim().length === 0 && body.trim().length === 0) {
      setSaveError('タイトルか本文を入力してください。');
      return;
    }
    setSaving(true);
    const { error } = await createMemo({ title, body, tags: parseTags(tags), images });
    setSaving(false);
    if (error) {
      setSaveError(`保存できませんでした：${error}`);
      return;
    }
    setSaveOk('保存しました');
    setTitle('');
    setBody('');
    setTags('');
    setImages([]);
  }

  return (
    <>
    {/* ── PC（lg以上）：メモ管理ダッシュボードUI（変更なし） ── */}
    <DesktopMemos />

    {/* ── スマホ／タブレット（lg未満）：ネオン宇宙UI ── */}
    <div className="relative min-h-[100svh] w-full overflow-x-hidden bg-[#050716] lg:hidden">
      {/* 宇宙背景（haikei.png）。全ビューポートを覆う固定レイヤー（端に白を出さない）。 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen"
        style={{
          backgroundColor: '#050716',
          backgroundImage: "url('/haikei.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
        }}
      />
      {/* 可読性確保の暗オーバーレイ（下ほど濃く・全ビューポート固定） */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen"
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,7,22,0.25) 0%, rgba(5,7,22,0.50) 45%, rgba(5,7,22,0.92) 100%)',
        }}
      />

      <div className="relative z-10 flex flex-col gap-5 px-1 pb-4">

        {/* ── 上部：公式ロゴ（透過版・ブレイン＋MYBRAIN＋マイブレインを含む1枚） ── */}
        <header className="relative mt-1 flex flex-col items-center pt-2">
          <NextImage
            src="/mybrain-original-logo-transparent.png"
            alt="MYBRAIN マイブレイン"
            width={556}
            height={508}
            className="h-auto object-contain"
            style={{ width: 'clamp(210px, 58vw, 300px)' }}
            priority
          />
        </header>

        {/* ── タイトル入力 ── */}
        <div className="flex items-center gap-3 rounded-2xl border px-4 py-3.5"
          style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.4)', boxShadow: '0 0 18px rgba(80,140,255,0.12) inset' }}>
          <span style={{ color: '#7BA6FF' }}>✏️</span>
          <input
            ref={titleInputRef}
            className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-[#7A86A8]"
            placeholder="タイトルを入力"
            maxLength={TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {/* タイトルの音声入力（既存 VoiceInput を流用。getInitial で末尾追記） */}
          <VoiceInput
            iconOnly
            onResult={(t) => setTitle(t)}
            getInitial={() => title}
          />
        </div>

        {/* ── 本文入力 ── */}
        <div className="rounded-2xl border px-4 py-3.5"
          style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(120,160,255,0.4)', boxShadow: '0 0 18px rgba(80,140,255,0.1) inset' }}>
          <textarea
            className="min-h-[200px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-white outline-none placeholder:text-[#7A86A8]"
            placeholder="メモの内容を入力してください..."
            maxLength={BODY_MAX}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-between border-t pt-2.5" style={{ borderColor: 'rgba(120,160,255,0.18)' }}>
            <button
              type="button"
              aria-label="画像追加"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: 'rgba(120,160,255,0.12)', color: '#9CC4FF' }}>
              <ImageIcon size={18} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: '#6E7AA0' }}>{body.length}/{BODY_MAX}</span>
              {/* 本文の音声入力（既存 VoiceInput を流用。getInitial で末尾追記） */}
              <VoiceInput
                iconOnly
                onResult={(t) => setBody(t)}
                getInitial={() => body}
              />
            </div>
          </div>
        </div>

        {/* タグ */}
        <input
          className="rounded-2xl border px-4 py-3 text-[14px] text-white outline-none placeholder:text-[#7A86A8]"
          style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.3)' }}
          placeholder="タグ（カンマ区切り 例: アイデア, 仕事）"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />

        {/* 画像入力（隠し）＋選択済みサムネイル */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((uri, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uri}
                  alt={`画像${i + 1}`}
                  onClick={() => setPreviewUri(uri)}
                  className="h-16 w-16 cursor-pointer rounded-xl object-cover"
                />
                <button
                  type="button"
                  aria-label="削除"
                  onClick={() => removeImage(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-[11px] text-white">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {saveError && <p className="text-center text-sm text-red-400">{saveError}</p>}
        {saveOk && <p className="text-center text-sm text-emerald-300">{saveOk}</p>}

        {/* ── 保存（ネオン）＋メモ一覧＋ホーム（コンパクト） ── */}
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex h-[54px] flex-[1.6] items-center justify-center rounded-full px-1 text-[15px] font-extrabold text-white disabled:opacity-60"
            style={{
              background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.1) inset, 0 6px 24px rgba(60,120,255,0.5)',
            }}>
            {saving ? '保存中…' : '💾 メモを保存する'}
          </button>
          <Link
            href="/history?view=memos"
            className="flex h-[54px] flex-1 items-center justify-center rounded-full border border-white/20 bg-black/35 text-[14px] font-bold text-white backdrop-blur-md transition active:scale-95"
            style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.3), 0 0 14px rgba(80,160,255,0.15)' }}>
            メモ一覧
          </Link>
          <Link
            href="/"
            className="flex h-[54px] flex-1 items-center justify-center rounded-full border border-white/20 bg-black/35 text-[14px] font-bold text-white backdrop-blur-md transition active:scale-95"
            style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.3), 0 0 14px rgba(80,160,255,0.15)' }}>
            ホーム
          </Link>
        </div>

        {/* ── AI質問バー（/consult のマイク付き入力バーと同一仕様） ── */}
        <div className="mt-1 flex flex-col gap-1.5">
          <span className="px-1 text-[12px] font-bold" style={{ color: 'rgba(170,200,255,0.85)' }}>
            メモについてAIに質問
          </span>
          <div className="flex items-center gap-2 rounded-2xl border px-3 py-2.5"
            style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(120,160,255,0.4)', boxShadow: '0 0 18px rgba(80,140,255,0.1) inset' }}>
            <input
              type="text"
              value={aiAsk}
              onChange={(e) => setAiAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') goConsultFromMemo();
              }}
              placeholder="メモについてAIに質問..."
              className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-[#7A86A8]"
            />
            <VoiceInput
              iconOnly
              onResult={(t) => setAiAsk(t)}
              getInitial={() => {
                aiBaseRef.current = aiAsk;
                return aiAsk;
              }}
            />
            <button
              type="button"
              aria-label="AIに送信"
              onClick={goConsultFromMemo}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition active:scale-95"
              style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 4px 14px rgba(60,120,255,0.45)' }}>
              <SendIcon size={18} />
            </button>
          </div>
        </div>

        {/* ── 機能カード（メモ＝緑 / 予定＝青 / AI相談＝紫） ── */}
        <div className="mt-2 grid grid-cols-3 gap-3">
          <NeonCard
            color="#22E5A8"
            title="メモ"
            icon={<NeonMemoIcon color="#22E5A8" />}
            onClick={() => titleInputRef.current?.focus()}
            active
          />
          <NeonCard
            color="#38BDF8"
            title="予定"
            icon={<NeonCalendarIcon color="#38BDF8" />}
            href="/reservations"
          />
          <NeonCard
            color="#A66BFF"
            title="AI"
            icon={<NeonChatIcon color="#A66BFF" />}
            href="/ai-assist"
          />
        </div>
      </div>

      {/* 画像拡大プレビュー */}
      {previewUri && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPreviewUri(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUri} alt="プレビュー" className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            onClick={() => setPreviewUri(null)}
            className="absolute right-4 top-6 rounded-full bg-white/15 px-4 py-2 text-sm font-bold text-white">
            ✕ 閉じる
          </button>
        </div>
      )}
    </div>
    </>
  );
}

/* ────────────────────────────────────────
   ネオン機能カード（上段）
──────────────────────────────────────── */
function NeonCard({
  color,
  title,
  icon,
  href,
  onClick,
  active = false,
}: {
  color: string;
  title: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
  /** 現在のページ（メモ管理）を示すアクティブ表示 */
  active?: boolean;
}) {
  const inner = (
    <div
      className="relative flex h-full flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center"
      style={
        active
          ? {
              background: `linear-gradient(160deg, ${hexA(color, 0.28)} 0%, rgba(10,16,34,0.7) 72%)`,
              border: `1.5px solid ${hexA(color, 0.85)}`,
              boxShadow: `0 0 22px ${hexA(color, 0.4)}, 0 0 18px ${hexA(color, 0.22)} inset`,
            }
          : {
              background: 'linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(10,12,28,0.6) 70%)',
              border: '1px solid rgba(255,255,255,0.15)',
              boxShadow: 'none',
            }
      }>
      {active && (
        <span className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-px text-[8px] font-bold"
          style={{ background: hexA(color, 0.9), color: '#06121f' }}>
          現在
        </span>
      )}
      <span style={active ? undefined : { opacity: 0.85 }}>{icon}</span>
      <span className="text-[14px] font-bold" style={{ color: active ? color : 'rgba(255,255,255,0.82)' }}>{title}</span>
    </div>
  );
  if (href) return <Link href={href} className="block active:scale-95">{inner}</Link>;
  return <button type="button" onClick={onClick} className="block w-full text-left active:scale-95">{inner}</button>;
}

/** #RRGGBB + alpha → rgba() */
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ────────────────────────────────────────
   ネオンSVGアイコン
──────────────────────────────────────── */
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

