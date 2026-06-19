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
  micSrc,
}: {
  onResult: (text: string) => void;
  onStop?: (text: string) => void;
  getInitial?: () => string;
  label?: string;
  listeningLabel?: string;
  iconOnly?: boolean;
  /** マイクボタンのアイコンを画像にする（指定時のみ。未指定は従来の MicIcon）。 */
  micSrc?: string;
}) {
  const lastRef = useRef('');
  const [unsupportedMsg, setUnsupportedMsg] = useState<string | null>(null);
  const [permissionMsg, setPermissionMsg] = useState<string | null>(null);
  const { supported, listening, start, stop } = useSpeech(
    (t) => {
      lastRef.current = t;
      onResult(t);
    },
    'ja-JP',
    (err) => {
      console.error('[VoiceInput] speech error:', err);
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setPermissionMsg(
          'マイクの使用が許可されていません。iPhoneの場合はSafariでの利用をおすすめします。またはスマホのキーボードのマイクをご利用ください。',
        );
      } else if (err === 'start-failed') {
        setPermissionMsg(
          'このブラウザではアプリ内音声入力に対応していません。スマホのキーボードのマイクをご利用ください。',
        );
      } else {
        setPermissionMsg('音声入力中に問題が発生しました。もう一度お試しください。');
      }
      setTimeout(() => setPermissionMsg(null), 6000);
    },
  );

  // マイクボタンのアイコン。micSrc 指定時のみ画像（白背景は invert で丸型ボタンに馴染ませ中央表示）。
  // 未指定は従来どおり MicIcon（他画面の見た目は変えない）。
  const micVisual = micSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={micSrc} alt="" aria-hidden className="h-full w-full scale-110 object-cover" style={{ filter: 'invert(1)' }} />
  ) : (
    <MicIcon size={18} />
  );

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
            className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-white opacity-50"
            style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.18)' }}>
            {micVisual}
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
    return (
      <div className="relative flex flex-col items-center">
        {listening ? (
          <button
            type="button"
            aria-label="音声入力を停止"
            onClick={() => {
              console.log('[VoiceInput] mic stop tapped');
              stop();
              onStop?.(lastRef.current);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white"
            style={{ background: 'rgba(0,0,0,0.75)', border: '1.5px solid rgba(168,107,255,0.9)', boxShadow: '0 0 14px rgba(168,107,255,0.6)' }}>
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
            className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-white"
            style={{ background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(150,170,255,0.45)', boxShadow: '0 0 10px rgba(99,102,241,0.25)' }}>
            {micVisual}
          </button>
        )}
        {permissionMsg && (
          <div className="absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-xl bg-[#223A70] px-3 py-2 text-[11px] leading-snug text-white shadow-lg">
            {permissionMsg}
          </div>
        )}
      </div>
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
      {permissionMsg && (
        <p className="text-xs text-red-600">{permissionMsg}</p>
      )}
    </div>
  );
}
