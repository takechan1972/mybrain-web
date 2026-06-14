'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useSpeech } from '@/lib/useSpeech';
import { ChatIcon, MicIcon, SendIcon } from './icons';

const NAVY = '#223A70';
const PURPLE = '#7B61FF';

/**
 * AI相談バー（下部固定・ボトムナビの上に浮かせる）。
 * - バー全体はリンクにしない。入力欄は実際の input でその場で入力できる。
 * - マイクボタンで音声入力（メモ/予定と同じ useSpeech フックを共用）。
 * - 送信ボタンで /consult へ遷移（入力済みテキストは ?q= で引き継ぐ）。
 * - safe-area を考慮し、ボトムナビ（約64px＋safe-area）と重ならない位置に配置。
 */
export default function AiBar() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isDev = process.env.NODE_ENV !== 'production';
  const baseRef = useRef('');

  const {
    supported: speechSupported,
    listening,
    start: startSpeech,
    stop: stopSpeech,
  } = useSpeech(
    (t) => {
      if (isDev) console.log('[aibar] transcript received (len):', t.trim().length);
      setText(t);
    },
    'ja-JP',
    (err) => {
      console.error('[aibar] speech error callback:', err);
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setError('マイクの使用が許可されていません。ブラウザのマイク設定を確認してください。');
      } else if (err === 'start-failed') {
        setError('このブラウザではアプリ内音声入力に対応していません。スマホのキーボードのマイクをご利用ください。');
      } else {
        setError('音声入力中に問題が発生しました。もう一度お試しください。');
      }
    },
  );

  function submit() {
    const q = text.trim();
    router.push(q ? `/consult?q=${encodeURIComponent(q)}` : '/consult');
  }

  function toggleMic() {
    setError(null);
    console.log('[aibar] mic clicked. supported =', speechSupported, 'listening =', listening);
    if (listening) {
      stopSpeech();
      console.log('[aibar] recognition stopped');
      return;
    }
    if (!speechSupported) {
      const msg =
        'このブラウザではアプリ内音声入力に対応していません。スマホのキーボードのマイクをご利用ください。';
      setError(msg);
      console.warn('[aibar] SpeechRecognition not available. UA:', navigator.userAgent);
      return;
    }
    baseRef.current = text;
    startSpeech(text);
    console.log('[aibar] recognition start requested');
  }

  return (
    <div
      className="fixed inset-x-0 z-20 mx-auto w-full max-w-md px-5"
      style={{ bottom: 'calc(72px + env(safe-area-inset-bottom) + 12px)' }}>
      {error && (
        <p className="mb-2 rounded-2xl bg-yellow-50 px-4 py-2 text-[12px] font-semibold text-yellow-800 shadow-sm">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-3 rounded-full border border-[#E5E8F0] bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(31,53,104,0.12)]">
        {/* ラベンダー薄円＋ネイビーのAI相談アイコン（大きめで認識しやすく） */}
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: '#EEF0FF', color: NAVY }}>
          <ChatIcon size={26} />
        </span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder={listening ? '聞き取り中...' : 'AIに何でも相談...'}
          className="min-w-0 flex-1 bg-transparent text-sm text-[#1F2937] outline-none placeholder:text-[#8A94A6]"
        />
        {/* マイク（実際のボタン。タップで音声認識を開始/停止） */}
        <button
          type="button"
          aria-label={listening ? '音声入力を停止' : '音声でAI相談する'}
          onClick={toggleMic}
          className="relative z-30 flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full transition active:opacity-60"
          style={
            listening
              ? { backgroundColor: PURPLE, color: '#fff', pointerEvents: 'auto' }
              : { backgroundColor: '#F3F5FA', color: '#223A70', pointerEvents: 'auto' }
          }>
          {listening ? <span className="h-2.5 w-2.5 rounded-sm bg-white" /> : <MicIcon size={18} />}
        </button>
        <button
          type="submit"
          aria-label="AIに相談する"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: PURPLE }}>
          <SendIcon size={18} />
        </button>
      </form>
    </div>
  );
}
