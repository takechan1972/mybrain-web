'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { listMemos } from '@/lib/memos';
import { listReservations } from '@/lib/reservations';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import DesktopDashboard from '@/components/DesktopDashboard';
import type { Memo, Reservation } from '@/lib/types';

// ホームの案内メッセージ（AIがユーザーに話しかける入口画面）。
const GUIDE_TEXT = 'なにからはじめますか';

/** 案内文を日本語（ja-JP）で読み上げる。重複防止のため開始前に cancel() する。未対応・例外時は何もしない。 */
function speakGuide() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // 重複読み上げ防止
    const u = new SpeechSynthesisUtterance(GUIDE_TEXT);
    u.lang = 'ja-JP';
    u.rate = 0.95;
    u.pitch = 1;
    u.volume = 1;
    const jp = synth.getVoices().find((v) => (v.lang || '').toLowerCase().startsWith('ja'));
    if (jp) u.voice = jp;
    synth.speak(u);
  } catch {
    // 読み上げ失敗は無視（ホーム機能は壊さない）
  }
}

// ── SpeechRecognition の最小型（標準 DOM 型に含まれないため any を使わず定義） ──
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  0: SRAlternative;
}
interface SRResultList {
  0: SRResult;
  length: number;
}
interface SREvent {
  results: SRResultList;
}
interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
}
type SRCtor = new () => SRInstance;

export default function HomePage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [name, setName] = useState('ゲスト');
  const [memos, setMemos] = useState<Memo[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  // タイプライター表示用（1文字ずつ表示）
  const [typed, setTyped] = useState('');
  // 音声入力の状態・ガイド表示
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  // データ読み込み（PC版 DesktopDashboard 用）。スマホ入口画面では使わないが、PCは従来どおり。
  useEffect(() => {
    if (!configured) return;
    const sb = getSupabaseBrowserClient();
    sb?.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? '';
      if (email) setName(email.split('@')[0]);
    });
    const load = () => {
      void listMemos().then(({ memos }) => setMemos(memos));
      void listReservations().then(({ reservations }) => setReservations(reservations));
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [configured]);

  // タイプライター：案内文を1文字ずつ表示
  useEffect(() => {
    setTyped('');
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(GUIDE_TEXT.slice(0, i));
      if (i >= GUIDE_TEXT.length) window.clearInterval(id);
    }, 120);
    return () => window.clearInterval(id);
  }, []);

  // 初回表示時に自動読み上げ（iOS 等の制限環境では枠タップで読み上げ）
  useEffect(() => {
    speakGuide();
  }, []);

  // 認識結果から遷移先を判定（「メモ／めも」→/memos、「予定／よてい」→/reservations、「設定／せってい」→/settings）。
  // 部分一致なので「メモを書く」「めもを書く」「メモたメモを書く」等でも「メモ」を含めばOK。
  function routeFromTranscript(text: string): boolean {
    const t = text;
    if (t.includes('メモ') || t.includes('めも')) {
      router.push('/memos');
      return true;
    }
    if (t.includes('予定') || t.includes('よてい')) {
      router.push('/reservations');
      return true;
    }
    if (t.includes('設定') || t.includes('せってい')) {
      router.push('/settings');
      return true;
    }
    return false;
  }

  // マイクボタン：音声入力を開始し、結果に応じてページ遷移する。
  function startVoiceInput() {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setHint('この端末では音声入力に対応していません');
      return;
    }
    try {
      // 読み上げ中は認識へ影響するので止める
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      const rec = new Ctor();
      rec.lang = 'ja-JP';
      rec.continuous = false;
      rec.interimResults = false;
      setHint(null);
      setListening(true);
      rec.onresult = (e: SREvent) => {
        const transcript = e.results?.[0]?.[0]?.transcript ?? '';
        const ok = routeFromTranscript(transcript);
        if (!ok) setHint('メモ、予定、設定のどれかを話してください');
      };
      rec.onerror = () => {
        setListening(false);
      };
      rec.onend = () => {
        setListening(false);
      };
      rec.start();
    } catch {
      setListening(false);
      setHint('この端末では音声入力に対応していません');
    }
  }

  return (
    <>
    {/* ── PC（lg以上）：ダッシュボードUI（変更なし） ── */}
    <DesktopDashboard memos={memos} reservations={reservations} userName={name} />

    {/* ── スマホ／タブレット（lg未満）：AIが話しかける入口画面 ── */}
    <div className="relative lg:hidden">
      {/* カーソル点滅アニメーション */}
      <style>{`@keyframes mbBlink{0%,49%{opacity:1}50%,100%{opacity:0}}`}</style>

      {/* 宇宙背景（haikei.png）＋暗オーバーレイ（他画面と統一） */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen lg:hidden"
        style={{
          backgroundColor: '#050716',
          backgroundImage: "url('/haikei.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen lg:hidden"
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,7,22,0.30) 0%, rgba(5,7,22,0.55) 45%, rgba(5,7,22,0.92) 100%)',
        }}
      />

      {/* 本体：ロゴ → 表示枠 → マイク。下部ネオンナビ分の余白を確保 */}
      <div
        className="relative z-10 flex flex-col items-center gap-6"
        style={{ paddingBottom: 'calc(124px + env(safe-area-inset-bottom))' }}>

        {/* 1. MyBrainロゴ */}
        <header className="flex flex-col items-center pt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mybrain-original-logo-transparent.png"
            alt="MYBRAIN マイブレイン"
            className="h-auto object-contain"
            style={{ width: 'clamp(200px, 58vw, 300px)' }}
          />
        </header>

        {/* 2. 案内メッセージ表示枠（メモ本文枠に近い雰囲気・表示専用・タップで読み上げ） */}
        <button
          type="button"
          onClick={speakGuide}
          aria-label="案内を読み上げる"
          className="flex min-h-[220px] w-full items-center justify-center rounded-2xl border px-5 py-8 text-center transition active:opacity-90"
          style={{
            background: 'rgba(8,10,24,0.78)',
            borderColor: 'rgba(120,160,255,0.4)',
            boxShadow: '0 0 18px rgba(80,140,255,0.12) inset, 0 10px 28px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}>
          <span className="text-[22px] font-bold leading-relaxed" style={{ color: '#e6edff' }}>
            {typed}
            <span aria-hidden style={{ color: '#7BA6FF', animation: 'mbBlink 1s step-end infinite' }}>
              ｜
            </span>
          </span>
        </button>

        {/* 認識できなかった/未対応のときの案内（表示枠の下） */}
        {hint && (
          <p className="-mt-3 text-center text-[13px] font-semibold" style={{ color: '#f2d58a' }}>
            {hint}
          </p>
        )}

        {/* 3. マイクボタン（音声入力を開始 → 結果で遷移）。大きめ・聞き取り中は発光強め */}
        <button
          type="button"
          onClick={startVoiceInput}
          aria-label={listening ? '音声入力中' : '音声入力を開始'}
          className="flex h-20 w-20 items-center justify-center rounded-full text-white transition active:scale-95"
          style={{
            background: listening
              ? 'linear-gradient(135deg, #7B5FFF, #C06BFF)'
              : 'linear-gradient(135deg, #2E7EFF, #7B5FFF)',
            boxShadow: listening
              ? '0 0 34px rgba(140,90,255,0.7), 0 10px 28px rgba(0,0,0,0.4)'
              : '0 0 26px rgba(60,120,255,0.5), 0 10px 28px rgba(0,0,0,0.4)',
          }}>
          {/* マイク画像（メイン操作として大きめ・中央表示）。invert＋screen でネオングラデ上に白マイクとして自然に重ねる */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mic-icon.jpg"
            alt=""
            aria-hidden
            className="h-14 w-14 object-contain"
            style={{ filter: 'invert(1)', mixBlendMode: 'screen' }}
          />
        </button>
        <span className="-mt-2 text-[12px] font-semibold" style={{ color: 'rgba(170,200,255,0.85)' }}>
          {listening ? '聞き取り中…' : 'マイクで話す'}
        </span>
      </div>

      {/* 4. 下部固定ナビ（メモ / 予定 / 設定）。メモ管理画面の下部ボタンと同じネオンデザイン */}
      <nav
        className="fixed inset-x-0 z-30 mx-auto w-full max-w-md px-5"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <div className="grid grid-cols-3 gap-3">
          <NeonNavCard href="/memos" color="#22E5A8" title="メモ" icon={<NeonMemoIcon color="#22E5A8" />} />
          <NeonNavCard href="/reservations" color="#38BDF8" title="予定" icon={<NeonCalendarIcon color="#38BDF8" />} />
          <NeonNavCard href="/settings" color="#A66BFF" title="設定" icon={<NeonSettingsIcon color="#A66BFF" />} />
        </div>
      </nav>
    </div>
    </>
  );
}

/* ── 下部ネオンナビカード（メモ管理画面 NeonCard 非アクティブ表示と同一デザイン） ── */
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

/* ── ネオンSVGアイコン（メモ管理画面と同一） ── */
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

function NeonSettingsIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={glow(color)}>
      <circle cx="24" cy="24" r="6.5" stroke={color} strokeWidth="2.2" />
      <path
        d="M24 6 v5 M24 37 v5 M6 24 h5 M37 24 h5 M11.3 11.3 l3.6 3.6 M33.1 33.1 l3.6 3.6 M36.7 11.3 l-3.6 3.6 M14.9 33.1 l-3.6 3.6"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
