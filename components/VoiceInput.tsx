'use client';

import { useRef, useState } from 'react';
import { useSpeech } from '@/lib/useSpeech';
import { MicIcon } from './icons';

const FALLBACK_MSG =
  'このブラウザではアプリ内音声入力に対応していません。スマホのキーボードのマイクをご利用ください。';

/**
 * 音声入力ボタン（Web Speech API）。
 * - onResult：認識テキスト（確定＋暫定）を都度通知（ライブ反映用）
 * - onStop：停止時に最終テキストを通知（予定の日時抽出などに使用）
 * - getInitial：開始時の既存テキスト（末尾に追記したい場合に渡す）
 * - 非対応ブラウザ（iOSSafari等）ではマイクアイコンを薄く表示し、
 *   タップ時にフォールバックメッセージを表示する（サイレント失敗しない）
 */
export default function VoiceInput({
  onResult,
  onStop,
  getInitial,
  label = '🎤 音声入力',
  listeningLabel = '■ 聞き取り中…（停止）',
  iconOnly = false,
}: {
  onResult: (text: string) => void;
  onStop?: (text: string) => void;
  getInitial?: () => string;
  label?: string;
  listeningLabel?: string;
  iconOnly?: boolean;
}) {
  const lastRef = useRef('');
  const [unsupportedMsg, setUnsupportedMsg] = useState<string | null>(null);
  const { supported, listening, start, stop } = useSpeech((t) => {
    lastRef.current = t;
    onResult(t);
  });

  // 非対応ブラウザ（iOS Safari 等）
  if (!supported) {
    if (iconOnly) {
      return (
        <div className="relative flex flex-col items-center">
          <button
            type="button"
            aria-label="音声入力（このブラウザでは非対応）"
            onClick={() => {
              console.warn('[VoiceInput] SpeechRecognition not supported — showing fallback');
              setUnsupportedMsg(FALLBACK_MSG);
              // 3秒後に自動消去
              setTimeout(() => setUnsupportedMsg(null), 4000);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F3F5FA] text-[#8A94A6] opacity-50">
            <MicIcon size={18} />
          </button>
          {unsupportedMsg && (
            <div className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-xl bg-[#223A70] px-3 py-2 text-[11px] leading-snug text-white shadow-lg">
              {unsupportedMsg}
            </div>
          )}
        </div>
      );
    }
    return (
      <p className="text-xs text-[#8A94A6]">
        {FALLBACK_MSG}
      </p>
    );
  }

  if (iconOnly) {
    return listening ? (
      <button
        type="button"
        aria-label="音声入力を停止"
        onClick={() => {
          console.log('[VoiceInput] mic stop tapped');
          stop();
          onStop?.(lastRef.current);
        }}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[#7B61FF] text-white">
        <span className="h-2.5 w-2.5 rounded-sm bg-white" />
      </button>
    ) : (
      <button
        type="button"
        aria-label="音声入力"
        onClick={() => {
          console.log('[VoiceInput] mic start tapped, supported =', supported);
          const initial = getInitial?.() ?? '';
          lastRef.current = initial;
          start(initial);
        }}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F3F5FA] text-[#223A70]">
        <MicIcon size={18} />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {!listening ? (
          <button
            type="button"
            onClick={() => {
              console.log('[VoiceInput] label-mic start tapped, supported =', supported);
              const initial = getInitial?.() ?? '';
              lastRef.current = initial;
              start(initial);
            }}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-bold">
            {label}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              console.log('[VoiceInput] label-mic stop tapped');
              stop();
              onStop?.(lastRef.current);
            }}
            className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-bold text-white">
            {listeningLabel}
          </button>
        )}
      </div>
    </div>
  );
}
