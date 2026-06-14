'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * ブラウザの Web Speech API による音声認識フック。
 * - 対応ブラウザ（Chrome/Edge等）でのみ有効。非対応は supported=false。
 * - 無音で自動終了しても、ユーザーが停止するまで自動再開（取得済みテキストは保持）。
 * - 認識結果（確定＋暫定）は onResult で都度通知。
 * - 音声データやテキストはログに出さない。
 */

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0?: { transcript?: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type Ctor = new () => SpeechRecognitionInstance;

function getCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechSupported(): boolean {
  return getCtor() !== null;
}

export function useSpeech(
  onResult: (text: string) => void,
  lang = 'ja-JP',
  onError?: (error: string) => void,
) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const manualStopRef = useRef(false);
  const accumulatedRef = useRef('');
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    setSupported(isSpeechSupported());
    return () => {
      manualStopRef.current = true;
      recRef.current?.stop();
    };
  }, []);

  const startSession = useCallback(() => {
    const C = getCtor();
    if (!C) {
      console.warn('[useSpeech] SpeechRecognition not available in this browser');
      return false;
    }
    console.log('[useSpeech] SpeechRecognition detected, starting session...');
    const rec = new C();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    let sessionFinal = '';
    rec.onresult = (e) => {
      let interim = '';
      sessionFinal = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) sessionFinal += t;
        else interim += t;
      }
      onResultRef.current(accumulatedRef.current + sessionFinal + interim);
    };
    rec.onerror = (e) => {
      const err = e?.error ?? '';
      console.error('[useSpeech] recognition error:', err);
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        manualStopRef.current = true;
        setListening(false);
        onErrorRef.current?.(err);
      }
    };
    rec.onend = () => {
      console.log('[useSpeech] recognition ended. manualStop =', manualStopRef.current);
      accumulatedRef.current += sessionFinal;
      if (manualStopRef.current) {
        setListening(false);
        return;
      }
      // 無音などによる自動終了 → 手動停止まで継続
      if (!startSession()) setListening(false);
    };
    try {
      rec.start();
      console.log('[useSpeech] rec.start() called');
    } catch (err) {
      console.error('[useSpeech] rec.start() threw:', err);
      onErrorRef.current?.('start-failed');
      return false;
    }
    recRef.current = rec;
    return true;
  }, [lang]);

  const start = useCallback(
    (initialText = '') => {
      if (!isSpeechSupported()) return;
      manualStopRef.current = false;
      accumulatedRef.current = initialText.trim().length > 0 ? `${initialText.trim()}\n` : '';
      if (startSession()) setListening(true);
    },
    [startSession],
  );

  const stop = useCallback(() => {
    manualStopRef.current = true;
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, start, stop };
}
