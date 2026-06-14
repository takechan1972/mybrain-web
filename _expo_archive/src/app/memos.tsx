import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pickImageFromLibrary, takePhoto } from '@/services/image-attach';
import { isOcrSupported, runOcr } from '@/services/ocr';
import { useAppData, type Memo, type MemoImage } from '@/store/app-data';
import VoiceRecorder from '@/components/voice-recorder';
import {
  classifyMemo,
  extractSchedules,
  summarizeMemo,
  type MemoClassificationResult,
  type ScheduleCandidate,
} from '@/services/ai-client';
import { transcribeAudio } from '@/services/ai-providers';
import {
  isSpeechSupported,
  startSpeechRecognition,
  type SpeechController,
} from '@/services/speech';
import { loadAiSettings, type TranscriptionLanguage } from '@/services/ai-settings';
import { deleteRecordingFile } from '@/services/recording-cleanup';
import { checkLimit, LIMIT_MESSAGES, recordUsage } from '@/services/usage-limits';
import { suggestTags, generateAutoTags, mergeTags } from '@/utils/auto-tags';
import { splitTitleBody } from '@/services/voice-input';
import { DateTimePicker } from '@/components/datetime-picker';
import { nowParts, partsFromMs, partsToMs, type DateTimeValue } from '@/components/datetime-picker.shared';
import { getTagStyle, normalizeTag } from '@/utils/tag-style';

// Web では上部にタブバー（position:absolute）があるため余白を確保
const TopInset = Platform.OS === 'web' ? 72 : Spacing.three;

const SOURCE_FILTERS: { key: 'all' | 'manual' | 'voice'; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'manual', label: '通常メモ' },
  { key: 'voice', label: '音声メモ' },
];

// 既存データに残る「予約」タグは表示上「予定」として扱う（データ自体は変更しない）
function tagLabel(tag: string): string {
  return normalizeTag(tag);
}

// 添付画像などの簡易ID生成
function genImageId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 文字起こし本文から自動タイトルを生成（最初の1行 or 先頭20文字。空なら「音声メモ」）
function deriveTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
  const base = firstLine.length > 0 ? firstLine : text.trim();
  const t = base.slice(0, 20).trim();
  return t.length > 0 ? t : '音声メモ';
}

// 音声内の「タイトルは〇〇」「件名：〇〇」「内容は〇〇」「本文：〇〇」などの指定を解析する。
// 長いマーカーを先に並べ、同じ位置では長いマーカーを優先採用する。
const TITLE_MARKERS = ['タイトルは', 'タイトル：', 'タイトル:', 'タイトル、', 'タイトル', '件名は', '件名：', '件名:', '件名'];
const BODY_MARKERS = ['内容は', '内容：', '内容:', '本文は', '本文：', '本文:', 'メモは'];

function firstMarker(
  text: string,
  markers: string[],
): { index: number; marker: string } | null {
  let best: { index: number; marker: string } | null = null;
  for (const m of markers) {
    const idx = text.indexOf(m);
    if (idx < 0) continue;
    if (!best || idx < best.index || (idx === best.index && m.length > best.marker.length)) {
      best = { index: idx, marker: m };
    }
  }
  return best;
}

// 本文先頭に残る不要文字（読点・句点・コロン・各種ハイフン・空白・全角空白・改行）を除去
function trimBody(s: string): string {
  return s.replace(/^[、。，．：:\-－—\s　]+/u, '').trim();
}

// タイトル末尾の句読点・丁寧表現（です/でした）を取り除く
function cleanTitle(s: string): string {
  let t = s.trim();
  t = t.replace(/[。．.！？!?、,：:\s]+$/u, '');
  t = t.replace(/(です|でした)$/u, '');
  t = t.replace(/[。．.！？!?、,：:\s]+$/u, '');
  return t.trim();
}

/**
 * 文字起こし本文から title / body を同時に抽出する。
 * - タイトルは「タイトル/件名」マーカー直後から、句点（。.！？/改行）または
 *   本文マーカー（内容は/本文は/メモは等）の手前までを採用（取りすぎない）
 * - body は本文マーカーがあればその後ろ、無ければタイトル文より後ろ
 * - タイトル指定も本文指定も無ければ title=undefined / body=全文（従来動作）
 */
export function extractMemoFields(text: string): { title?: string; body: string } {
  const src = text.trim();
  const tm = firstMarker(src, TITLE_MARKERS);
  const bm = firstMarker(src, BODY_MARKERS);

  let title: string | undefined;
  let body = src;

  if (tm) {
    const afterTitle = src.slice(tm.index + tm.marker.length);
    // タイトル終了位置 = 句点 か 本文マーカー のうち早い方
    const sepIdx = afterTitle.search(/[。．.！？!?\n]/u);
    const bmIn = firstMarker(afterTitle, BODY_MARKERS);
    const ends = [sepIdx, bmIn ? bmIn.index : -1].filter((i) => i >= 0);
    const end = ends.length > 0 ? Math.min(...ends) : -1;
    const titleSeg = end === -1 ? afterTitle : afterTitle.slice(0, end);
    title = cleanTitle(titleSeg);
    // 本文マーカーが無い場合の body は「タイトル文の後ろ」
    body = trimBody(sepIdx === -1 ? '' : afterTitle.slice(sepIdx + 1));
  }

  if (bm) {
    // 本文マーカーがあれば、その後ろだけを body に（ラベル・先頭の記号は含めない）
    body = trimBody(src.slice(bm.index + bm.marker.length));
  }

  if (!tm && !bm) body = src;
  if (title !== undefined && title.length === 0) title = undefined;

  return { title, body };
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function MemoScreen() {
  const theme = useTheme();
  const { memos, addMemo, updateMemo, deleteMemo, togglePin, addReservation } = useAppData();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  // メモの日時（記録日時。選択式）
  const [memoDt, setMemoDt] = useState<DateTimeValue>(nowParts());
  // メモ編集フォームのAI要約（「AI要約」ボタンを押した時のみ生成。保存で原文＋要約を保存）
  const [formSummary, setFormSummary] = useState('');
  const [formSummarizing, setFormSummarizing] = useState(false);
  const [formSummaryNotice, setFormSummaryNotice] = useState<string | null>(null);
  // 添付画像（手入力・編集フォーム / 音声メモ）
  const [formImages, setFormImages] = useState<MemoImage[]>([]);
  const [voiceImages, setVoiceImages] = useState<MemoImage[]>([]);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  // 画像拡大プレビュー（タップで全画面表示）
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // 画像OCR（「画像から文字起こし」ボタン押下時のみ実行）
  const [formOcrText, setFormOcrText] = useState('');
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrNotice, setOcrNotice] = useState<string | null>(null);
  // メモフォームの入力方法（手入力／音声で入力）
  const [memoInputMode, setMemoInputMode] = useState<'manual' | 'voice'>('manual');
  // 音声入力中の対象（null=停止中）
  const [memoListening, setMemoListening] = useState<null | 'title' | 'body' | 'combined'>(null);
  const [memoVoiceNotice, setMemoVoiceNotice] = useState<string | null>(null);
  const memoSpeechRef = useRef<SpeechController | null>(null);
  const memoBaseRef = useRef('');
  // メモ分類（自動タグ）
  const [classifying, setClassifying] = useState(false);
  const [classifyResult, setClassifyResult] = useState<MemoClassificationResult | null>(null);
  const [classifyNotice, setClassifyNotice] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedSourceFilter, setSelectedSourceFilter] = useState<'all' | 'manual' | 'voice'>('all');

  // 音声メモ登録エリア
  const [voiceOpen, setVoiceOpen] = useState(false);
  // タイトル（自動生成・編集可）と本文（文字起こし全文）を分離して保持
  const [voiceTitle, setVoiceTitle] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceSummary, setVoiceSummary] = useState('');
  // 音声メモのタグ（登録前に編集可。カンマ区切り）
  const [voiceTags, setVoiceTags] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  // 予定抽出
  const [extracting, setExtracting] = useState(false);
  const [scheduleCandidates, setScheduleCandidates] = useState<ScheduleCandidate[]>([]);
  const [scheduleSource, setScheduleSource] = useState('');
  // 録音ファイル URI を保持（将来 transcribeAudio(uri) に渡す）
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  // 認識言語（設定値）と音声入力中の状態
  const [transcriptionLanguage, setTranscriptionLanguage] = useState<TranscriptionLanguage>('ja-JP');
  const [listening, setListening] = useState(false);
  const speechRef = useRef<SpeechController | null>(null);
  const transcriptBaseRef = useRef('');

  // 音声メモエリアを開いたとき設定取得。閉じたら認識を停止。
  useEffect(() => {
    if (!voiceOpen) {
      speechRef.current?.stop();
      speechRef.current = null;
      setListening(false);
      return;
    }
    loadAiSettings().then((s) => {
      setTranscriptionLanguage(s.transcriptionLanguage);
    });
  }, [voiceOpen]);

  // 種別ごとの件数（全メモ数ベース。タグ絞り込み・検索とは独立）
  const sourceCounts = useMemo(() => {
    let voice = 0;
    for (const m of memos) {
      if ((m.source ?? 'manual') === 'voice') voice += 1;
    }
    return { all: memos.length, voice, manual: memos.length - voice };
  }, [memos]);

  // 登録済みメモから一意なタグを自動抽出（メモの追加・編集・削除に自動追随）
  const allTags = useMemo(() => {
    const set = new Set<string>();
    memos.forEach((m) => m.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [memos]);

  // タグ絞り込み + キーワード検索（タイトル・本文・タグ、大文字小文字無視）を併用し、
  // ピン留め優先 → 更新日時の新しい順 で並べ替える。
  const visibleMemos = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = memos.filter((m) => {
      // 1) 種別フィルター（source が無い古いメモは manual 扱い）
      const source = m.source ?? 'manual';
      if (selectedSourceFilter !== 'all' && source !== selectedSourceFilter) return false;
      // 2) タグフィルター
      if (selectedTag && !m.tags.includes(selectedTag)) return false;
      // 3) キーワード検索
      if (q.length === 0) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    // 4) ピン留め優先ソート（元配列を壊さないようコピーしてから）
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1; // ピン留めを上に
      return b.updatedAt - a.updatedAt; // 新しい順
    });
  }, [memos, selectedSourceFilter, selectedTag, query]);

  function openNew() {
    setEditingId(null);
    setTitle('');
    setBody('');
    setTags('');
    setMemoDt(nowParts());
    setFormSummary('');
    setFormSummaryNotice(null);
    setFormImages([]);
    setImageNotice(null);
    setFormOcrText('');
    setOcrNotice(null);
    setClassifyResult(null);
    setClassifyNotice(null);
    stopMemoVoice();
    setMemoInputMode('manual');
    setMemoVoiceNotice(null);
    setFormOpen(true);
  }

  function openEdit(memo: Memo) {
    setEditingId(memo.id);
    setTitle(memo.title);
    setBody(memo.body);
    setTags(memo.tags.join(', '));
    setMemoDt(partsFromMs(memo.dateAt ?? memo.createdAt));
    setFormSummary(memo.summary ?? '');
    setFormSummaryNotice(null);
    setFormImages(memo.images ?? []);
    setImageNotice(null);
    setFormOcrText(memo.ocrText ?? '');
    setOcrNotice(null);
    setClassifyResult(null);
    setClassifyNotice(null);
    stopMemoVoice();
    setMemoInputMode('manual');
    setMemoVoiceNotice(null);
    setFormOpen(true);
  }

  // フォームを閉じる（音声認識を停止）
  function closeForm() {
    stopMemoVoice();
    setFormOpen(false);
  }

  function parseTags(input: string): string[] {
    return input
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  // ── メモフォームの音声入力 ──────────────────────────────────────────────
  function stopMemoVoice() {
    memoSpeechRef.current?.stop();
    memoSpeechRef.current = null;
    setMemoListening(null);
  }

  // 入力方法を切り替え（内容は保持。音声→手入力で認識は停止）
  function setMemoMode(mode: 'manual' | 'voice') {
    setMemoVoiceNotice(null);
    if (mode === 'manual') stopMemoVoice();
    if (mode === 'voice' && !isSpeechSupported()) {
      setMemoVoiceNotice('この環境では音声入力に対応していません。手入力をご利用ください。');
      setMemoInputMode('manual');
      return;
    }
    setMemoInputMode(mode);
  }

  // target ごとに音声認識を開始（既存内容に追記）
  async function startMemoVoice(target: 'title' | 'body' | 'combined') {
    setMemoVoiceNotice(null);
    if (!isSpeechSupported()) {
      setMemoVoiceNotice('この環境では音声入力に対応していません。手入力をご利用ください。');
      setMemoInputMode('manual');
      return;
    }
    // プラン別の1日の上限チェック（手入力は常に利用可）
    const limit = await checkLimit('memoVoiceInput');
    if (!limit.allowed) {
      setMemoVoiceNotice(LIMIT_MESSAGES.voiceInput);
      return;
    }
    // 進行中の認識があれば止めてから開始
    stopMemoVoice();
    // 追記の基準（タイトル/本文は既存内容の後ろに足す）
    memoBaseRef.current =
      target === 'title' ? (title ? `${title} ` : '') : target === 'body' ? (body ? `${body} ` : '') : '';

    const controller = startSpeechRecognition({
      lang: 'ja-JP',
      onResult: (text) => {
        if (target === 'title') {
          setTitle(memoBaseRef.current + text);
        } else if (target === 'body') {
          setBody(memoBaseRef.current + text);
        } else {
          // まとめて：話した内容をタイトルと本文へ自動分割（手動修正可）
          const { title: t, body: b } = splitTitleBody(text);
          setTitle(t);
          setBody(b);
        }
      },
      onError: () => {
        setMemoVoiceNotice('聞き取りできませんでした。もう一度お試しください。');
        setMemoListening(null);
      },
      onEnd: () => setMemoListening(null),
    });
    if (!controller) {
      setMemoVoiceNotice('この環境では音声入力に対応していません。手入力をご利用ください。');
      setMemoInputMode('manual');
      return;
    }
    memoSpeechRef.current = controller;
    setMemoListening(target);
    // 音声入力1回分として記録（本文・認識結果は保存しない）
    recordUsage('memoVoiceInput');
  }

  // AIメモ分類：本文（無ければタイトル）を分類し、タグへ統合＋結果表示
  async function handleClassifyMemo() {
    const source = body.trim() || title.trim();
    if (source.length === 0) {
      setClassifyResult(null);
      setClassifyNotice('分類する文字がありません');
      return;
    }
    setClassifying(true);
    setClassifyNotice('メモを分類中…');
    try {
      const settings = await loadAiSettings();
      const result = await classifyMemo(source, settings);
      if (result.rateLimited) {
        setClassifyResult(null);
        setClassifyNotice(
          `メモ分類AIの利用上限に達しました。\n${result.message ?? ''}\nAI接続設定やプラン設定をご確認ください。`,
        );
        return;
      }
      setClassifyResult(result);
      // 分類タグを既存タグへ統合（重複排除）。既存タグ機能を優先利用。
      const merged = parseTags(tags);
      result.tags.forEach((t) => {
        if (t.length > 0 && !merged.includes(t)) merged.push(t);
      });
      setTags(merged.join(', '));
      setClassifyNotice(result.message ?? 'メモ分類が完了しました');
    } catch {
      // 失敗してもメモ本文は保存できる
      setClassifyNotice('分類に失敗しました。分類なしで保存できます。');
    } finally {
      setClassifying(false);
    }
  }

  // タイトル＋本文から自動タグ候補を生成し、既存タグへ統合（重複排除）
  function addAutoTags() {
    const suggested = suggestTags(`${title} ${body}`);
    if (suggested.length === 0) return;
    const current = parseTags(tags);
    const merged = [...current];
    suggested.forEach((t) => {
      if (!merged.includes(t)) merged.push(t);
    });
    setTags(merged.join(', '));
  }

  // タイトル自動生成：タイトルが空、または「音声メモ」のままのときだけ本文から再生成
  // （ユーザーが編集したタイトルは上書きしない＝追加音声入力でも保持）
  function autoFillTitle(text: string) {
    setVoiceTitle((prev) => {
      const p = prev.trim();
      return p === '' || p === '音声メモ' ? deriveTitle(text) : prev;
    });
  }

  // 音声メモ：文字起こし生成（設定値の方式で。mock 以外は未対応メッセージ）
  async function handleMockTranscribe() {
    setVoiceNotice(null);
    // 文字起こしは月間の利用時間（分）で管理。上限到達時は案内のみ。
    const limit = await checkLimit('transcriptionMinutes');
    if (!limit.allowed) {
      setVoiceNotice(LIMIT_MESSAGES.transcription);
      return;
    }
    setTranscribing(true);
    const settings = await loadAiSettings();
    const res = await transcribeAudio(recordedUri, settings);
    if (res.ok) {
      // 本物の音声認識ではなく仮（サンプル）文字起こしであることを画面に明示
      setVoiceNotice('※ この環境では本物の音声認識に対応していないため、仮（サンプル）文字起こしです。実際の発話とは一致しません。');
      // タイトル/内容指定を解析して title欄・body欄に分けて反映（新規扱い）
      const { title, body } = extractMemoFields(res.value);
      setVoiceTranscript(body);
      setVoiceTitle((prev) => {
        const p = prev.trim();
        if (p !== '' && p !== '音声メモ') return prev;
        return title && title.length > 0 ? title : deriveTitle(body);
      });
      // AI推定タグを初期表示（未編集のときのみ）
      setVoiceTags((prev) => (prev.trim().length > 0 ? prev : suggestTags(body).join(', ')));
      // 利用時間を加算（概算1分。本文・認識結果は保存しない）
      recordUsage('transcriptionMinutes', 1);
    } else {
      setVoiceNotice('文字起こしに失敗しました。もう一度録音してください。（設定の「文字起こし方式」もご確認ください）');
    }
    setTranscribing(false);
  }

  // 音声メモ：追加音声入力（録音し直して文字起こしし、既存本文の末尾へ追記）
  async function handleAppendTranscribe() {
    setVoiceNotice(null);
    const limit = await checkLimit('transcriptionMinutes');
    if (!limit.allowed) {
      setVoiceNotice(LIMIT_MESSAGES.transcription);
      return;
    }
    setTranscribing(true);
    const settings = await loadAiSettings();
    const res = await transcribeAudio(recordedUri, settings);
    if (res.ok) {
      // 既存の文字起こし文章の末尾へ追記（改行区切り）
      setVoiceTranscript((prev) => {
        const merged = prev.trim().length > 0 ? `${prev.trim()}\n${res.value}` : res.value;
        // タイトルは自動上書きしない。空/「音声メモ」のときだけ本文から再生成
        autoFillTitle(merged);
        return merged;
      });
      recordUsage('transcriptionMinutes', 1);
      setVoiceNotice('追加分を本文の末尾に追記しました。');
    } else {
      setVoiceNotice('この文字起こし方式は現在準備中です。設定の「文字起こし方式」を標準に戻してご利用ください。');
    }
    setTranscribing(false);
  }

  // 音声メモ：統一音声入力（話す→停止で文字起こし）。
  // Web: Web Speech API、iOS/Android: 端末標準認識（expo-speech-recognition）を共通APIで使用。
  // mode='append' のときは既存の文字起こし末尾へ追記する。
  async function startVoiceInput(mode: 'new' | 'append') {
    setVoiceNotice(null);
    if (!isSpeechSupported()) {
      // 非対応環境（古いブラウザ等）は録音＋仮文字起こしのフォールバックへ案内
      setVoiceNotice(
        'この環境では音声認識に対応していません。下の「仮で文字起こし生成」をご利用ください。',
      );
      return;
    }
    const limit = await checkLimit('memoVoiceInput');
    if (!limit.allowed) {
      setVoiceNotice(LIMIT_MESSAGES.voiceInput);
      return;
    }
    // 進行中の認識があれば停止してから開始
    stopVoiceInput();
    // append 時は既存本文の末尾へ追記（改行区切り）
    transcriptBaseRef.current =
      mode === 'append' && voiceTranscript.trim().length > 0 ? `${voiceTranscript.trim()}\n` : '';
    const controller = startSpeechRecognition({
      lang: transcriptionLanguage,
      onResult: (text) => setVoiceTranscript(transcriptBaseRef.current + text),
      onError: () => {
        // 失敗理由を画面に表示（console だけで終わらせない）
        setVoiceNotice('文字起こしに失敗しました。もう一度録音してください。');
        setListening(false);
      },
      onEnd: () => {
        setListening(false);
        // 認識結果が空なら画面に案内、非空なら結果画面を表示
        setVoiceTranscript((cur) => {
          if (cur.trim().length === 0) {
            setVoiceNotice('音声を認識できませんでした。もう一度録音してください。');
            return cur;
          }
          if (mode === 'new') {
            // 新規：タイトル/内容指定を解析し、title欄・body欄に分けて反映
            const { title, body } = extractMemoFields(cur);
            setVoiceTitle((prev) => {
              const p = prev.trim();
              if (p !== '' && p !== '音声メモ') return prev; // ユーザー編集は保持
              return title && title.length > 0 ? title : deriveTitle(body);
            });
            return body;
          }
          // 追加音声入力：本文はそのまま（末尾追記済み）。タイトルは空/音声メモのみ再生成
          autoFillTitle(cur);
          return cur;
        });
      },
    });
    if (!controller) {
      setVoiceNotice('文字起こしに失敗しました。もう一度録音してください。');
      return;
    }
    speechRef.current = controller;
    setListening(true);
    // 音声入力1回分として記録（本文・認識結果は保存しない）
    recordUsage('memoVoiceInput');
  }

  // 音声メモ：音声入力停止（onEnd で結果が確定する）
  function stopVoiceInput() {
    speechRef.current?.stop();
    speechRef.current = null;
    setListening(false);
  }

  // 音声メモ：Web Speech リアルタイム認識 停止
  function stopRealtimeRecognition() {
    speechRef.current?.stop();
    speechRef.current = null;
    setListening(false);
  }

  // 音声メモ：要約生成（summarySettings 経由。無効/未設定/未対応は安全にフォールバック）
  async function handleMockSummarize() {
    if (voiceTranscript.trim().length === 0) {
      setVoiceNotice('要約する文字がありません');
      return;
    }
    setSummarizing(true);
    setVoiceNotice('要約中…');
    try {
      const settings = await loadAiSettings();
      const result = await summarizeMemo(voiceTranscript, settings);
      if (result.rateLimited) {
        // 上限時は mock 処理せず案内のみ
        setVoiceNotice(
          `要約AIの利用上限に達しました。\n${result.message ?? ''}\nAI接続設定やプラン設定をご確認ください。`,
        );
      } else {
        setVoiceSummary(result.summary);
        // AI推定タグを初期表示（ユーザーが未編集のときのみ自動セット）
        setVoiceTags((prev) =>
          prev.trim().length > 0 ? prev : suggestTags(`${result.summary} ${voiceTranscript}`).join(', '),
        );
        setVoiceNotice(result.message ?? '要約完了');
      }
    } catch {
      // 何があってもアプリは落とさない
      setVoiceNotice('要約処理でエラーが発生しました。簡易要約をご利用ください。');
    } finally {
      setSummarizing(false);
    }
  }

  // 予定候補を抽出（要約本文 > 文字起こし > メモ本文 の優先で抽出元を決定）
  async function handleExtractSchedule() {
    const source = voiceSummary.trim() || voiceTranscript.trim() || body.trim();
    if (source.length === 0) {
      setScheduleCandidates([]);
      setVoiceNotice('予定抽出する文字がありません');
      return;
    }
    setExtracting(true);
    setVoiceNotice('予定候補を抽出中…');
    try {
      const settings = await loadAiSettings();
      const result = await extractSchedules(source, settings);
      if (result.rateLimited) {
        setScheduleCandidates([]);
        setVoiceNotice(
          `予定抽出AIの利用上限に達しました。\n${result.message ?? ''}\nAI接続設定やプラン設定をご確認ください。`,
        );
        return;
      }
      setScheduleCandidates(result.schedules);
      setScheduleSource(source);
      if (result.message) setVoiceNotice(result.message);
      else if (result.schedules.length === 0) setVoiceNotice('予定候補が見つかりませんでした');
      else setVoiceNotice('予定候補を抽出しました');
    } catch {
      setVoiceNotice('予定抽出でエラーが発生しました。');
    } finally {
      setExtracting(false);
    }
  }

  function updateCandidate(index: number, partial: Partial<ScheduleCandidate>) {
    setScheduleCandidates((prev) => prev.map((c, i) => (i === index ? { ...c, ...partial } : c)));
  }

  function discardCandidate(index: number) {
    setScheduleCandidates((prev) => prev.filter((_, i) => i !== index));
  }

  // 予定候補を既存の予定管理（addReservation）へ登録（予約自動登録は月間上限で管理）
  async function registerCandidate(index: number) {
    const limit = await checkLimit('autoReservationFromVoice');
    if (!limit.allowed) {
      setVoiceNotice(LIMIT_MESSAGES.autoReservation);
      return;
    }
    try {
      const c = scheduleCandidates[index];
      const datetime =
        [c.date ?? '', c.startTime ?? ''].filter((s) => s.length > 0).join(' ') +
        (c.endTime ? `-${c.endTime}` : '');
      addReservation({
        name: c.title.trim() || '予定',
        datetime: datetime.trim(),
        content: (c.description ?? c.location ?? '').trim(),
        note: `【AI抽出元】\n${scheduleSource}`,
      });
      recordUsage('autoReservationFromVoice', 1);
      discardCandidate(index);
      setVoiceNotice('予定に登録しました');
    } catch {
      setVoiceNotice('予定登録に失敗しました');
    }
  }

  // 音声メモ：メモへ登録
  // - 文字起こし原文をそのまま本文(body)に保存（保存時の自動要約はしない）
  // - AI要約は「AI要約」ボタンを押したとき(voiceSummary)のみ summary として保存
  async function registerVoiceMemo() {
    const transcript = voiceTranscript.trim();
    if (transcript.length === 0) return;
    // 「AI要約」ボタンを押した時のみ要約が入る（押していなければ空 → 原文のみ保存）
    const summaryText = voiceSummary.trim();

    // タイトル：結果画面で編集されたタイトル欄を使用（空なら本文から自動生成）
    const title = voiceTitle.trim() || deriveTitle(transcript);

    // 手動タグ（編集済み）＋ title/body からの自動タグを統合（重複除去・上限あり）
    const tagList = mergeTags(parseTags(voiceTags), generateAutoTags(title, transcript));

    addMemo(
      {
        title,
        body: transcript, // 文字起こし原文
        tags: tagList,
        ...(summaryText.length > 0 ? { summary: summaryText } : {}),
        ...(voiceImages.length > 0 ? { images: voiceImages } : {}),
      },
      'voice',
    );

    // メモ登録後、録音データを端末から削除（失敗してもメモ登録は成功扱い）
    const uriToDelete = recordedUri;
    let deleteWarning: string | null = null;
    try {
      const deleted = await deleteRecordingFile(uriToDelete);
      if (!deleted) deleteWarning = '※ メモは登録しました。録音データの削除に失敗しました（容量にご注意ください）。';
    } catch {
      deleteWarning = '※ メモは登録しました。録音データの削除に失敗しました（容量にご注意ください）。';
    }

    // 入力欄クリア＆エリアを閉じる
    setVoiceTitle('');
    setVoiceTranscript('');
    setVoiceSummary('');
    setVoiceTags('');
    setVoiceImages([]);
    setScheduleCandidates([]);
    setRecordedUri(null);
    // 削除に失敗した場合のみ警告を残す（成功時はエリアを閉じる）
    if (deleteWarning) {
      setVoiceNotice(deleteWarning);
    } else {
      setVoiceNotice(null);
      setVoiceOpen(false);
    }
  }

  // 削除は誤操作防止のため確認してから実行（Webはwindow.confirm）
  function confirmDeleteMemo(memo: Memo) {
    const title = 'このメモを削除しますか？';
    const message = `「${memo.title || '無題'}」を削除します。元に戻せません。`;
    const doDelete = () => deleteMemo(memo.id);
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) doDelete();
      return;
    }
    Alert.alert(title, message, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: doDelete },
    ]);
  }

  // 後付けAI要約：編集中メモの本文をAI要約し、フォームの要約欄へ反映（保存で原文＋要約を保存）
  async function handleFormSummarize() {
    const source = body.trim();
    if (source.length === 0) {
      setFormSummaryNotice('要約する本文がありません');
      return;
    }
    setFormSummarizing(true);
    setFormSummaryNotice('要約中…');
    try {
      const settings = await loadAiSettings();
      const result = await summarizeMemo(source, settings);
      if (result.rateLimited) {
        setFormSummaryNotice(
          `要約AIの利用上限に達しました。\n${result.message ?? ''}\nAI接続設定やプラン設定をご確認ください。`,
        );
      } else {
        setFormSummary(result.summary);
        setFormSummaryNotice(result.message ?? '要約しました。保存すると原文＋要約が保存されます。');
      }
    } catch {
      setFormSummaryNotice('要約処理でエラーが発生しました。');
    } finally {
      setFormSummarizing(false);
    }
  }

  // 画像添付（カメラ撮影／画像選択）。target でフォーム用 / 音声メモ用を切替。
  async function attachImage(target: 'form' | 'voice', source: 'camera' | 'library') {
    setImageNotice(null);
    const uri = source === 'camera' ? await takePhoto() : await pickImageFromLibrary();
    if (!uri) {
      setImageNotice('画像を取得できませんでした（権限・キャンセルの可能性があります）。');
      return;
    }
    // OCR対応準備：ocrStatus を 'none' で保持（将来 pending→done に更新）
    const img: MemoImage = { id: genImageId(), uri, createdAt: Date.now(), ocrStatus: 'none' };
    if (target === 'form') setFormImages((prev) => [...prev, img]);
    else setVoiceImages((prev) => [...prev, img]);
  }

  function removeImage(target: 'form' | 'voice', id: string) {
    if (target === 'form') setFormImages((prev) => prev.filter((i) => i.id !== id));
    else setVoiceImages((prev) => prev.filter((i) => i.id !== id));
  }

  // 画像から文字起こし（OCR）。ボタン押下時のみ実行（自動実行しない・API最小限）。
  async function handleRunOcr() {
    if (!isOcrSupported()) {
      setOcrNotice('この環境ではOCRに対応していません。');
      return;
    }
    if (formImages.length === 0) {
      setOcrNotice('文字起こしする画像がありません。');
      return;
    }
    setOcrRunning(true);
    setOcrNotice('文字起こし中…（画像によっては時間がかかります）');
    try {
      const texts: string[] = [];
      let failed = 0;
      let empty = 0;
      for (const img of formImages) {
        const res = await runOcr(img.uri);
        if (res.ok) texts.push(res.text);
        else if (res.reason === 'empty') empty += 1;
        else failed += 1;
      }
      if (texts.length > 0) {
        const combined = texts.join('\n');
        setFormOcrText((prev) => (prev.trim().length > 0 ? `${prev.trim()}\n${combined}` : combined));
        setOcrNotice('画像から文字起こししました。内容を確認・編集できます。');
      } else if (empty > 0) {
        setOcrNotice('文字が読み取れませんでした。');
      } else if (failed > 0) {
        setOcrNotice('画像文字起こしに失敗しました。');
      } else {
        setOcrNotice('文字が読み取れませんでした。');
      }
    } catch {
      setOcrNotice('画像文字起こしに失敗しました。');
    } finally {
      setOcrRunning(false);
    }
  }

  // OCR結果を本文末尾へ追記（【画像文字起こし】見出し付き）
  function addOcrToBody() {
    const ocr = formOcrText.trim();
    if (ocr.length === 0) {
      setOcrNotice('追加するOCR結果がありません。');
      return;
    }
    setBody((prev) => `${prev.trim()}\n\n【画像文字起こし】\n${ocr}`.trim());
    setOcrNotice('本文に追記しました。');
  }

  // 画像添付UI（撮影・選択ボタン＋サムネイル一覧）
  function renderImageAttach(target: 'form' | 'voice', images: MemoImage[]) {
    return (
      <>
        <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
          画像（カメラ撮影・画像選択）
        </ThemedText>
        <ThemedView style={styles.imageBtnRow}>
          <Pressable onPress={() => attachImage(target, 'camera')} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundSelected" style={styles.autoTagBtn}>
              <ThemedText type="smallBold">📷 カメラ撮影</ThemedText>
            </ThemedView>
          </Pressable>
          <Pressable onPress={() => attachImage(target, 'library')} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundSelected" style={styles.autoTagBtn}>
              <ThemedText type="smallBold">🖼 画像を選択</ThemedText>
            </ThemedView>
          </Pressable>
        </ThemedView>
        {images.length > 0 && (
          <ThemedView style={styles.thumbRow}>
            {images.map((img) => (
              <ThemedView key={img.id} style={styles.thumbBox}>
                {/* タップで拡大プレビュー */}
                <Pressable onPress={() => setPreviewUri(img.uri)} style={({ pressed }) => pressed && styles.pressed}>
                  <Image source={{ uri: img.uri }} style={styles.thumb} contentFit="cover" />
                </Pressable>
                <Pressable
                  onPress={() => removeImage(target, img.id)}
                  style={({ pressed }) => [styles.thumbRemove, pressed && styles.pressed]}>
                  <ThemedText type="smallBold" style={styles.btnLight}>×</ThemedText>
                </Pressable>
              </ThemedView>
            ))}
          </ThemedView>
        )}
        {imageNotice && (
          <ThemedText type="small" style={styles.noticeText}>
            {imageNotice}
          </ThemedText>
        )}

        {/* 画像OCR（フォーム＝詳細/編集のみ。ボタン押下時のみ実行） */}
        {target === 'form' && images.length > 0 && (
          <>
            {isOcrSupported() ? (
              <Pressable
                onPress={handleRunOcr}
                disabled={ocrRunning}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView
                  type="backgroundSelected"
                  style={[styles.autoTagBtn, ocrRunning && styles.btnDisabled]}>
                  <ThemedText type="smallBold">
                    {ocrRunning ? '文字起こし中…' : '🔤 画像から文字起こし'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            ) : (
              <ThemedText type="small" style={styles.noticeText}>
                ※ この環境ではOCRに対応していません（Web版でご利用ください）。
              </ThemedText>
            )}

            {ocrNotice && (
              <ThemedText type="small" style={styles.noticeText}>
                {ocrNotice}
              </ThemedText>
            )}

            {(formOcrText.length > 0 || ocrRunning) && (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                  画像文字起こし結果（編集できます）
                </ThemedText>
                <TextInput
                  style={[inputStyle, styles.multiline]}
                  placeholder="画像から読み取ったテキスト"
                  placeholderTextColor={theme.textSecondary}
                  value={formOcrText}
                  onChangeText={setFormOcrText}
                  multiline
                />
                <ThemedView style={styles.imageBtnRow}>
                  <Pressable onPress={addOcrToBody} style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView type="backgroundSelected" style={styles.autoTagBtn}>
                      <ThemedText type="smallBold">＋ 本文に追加</ThemedText>
                    </ThemedView>
                  </Pressable>
                  <Pressable
                    onPress={() => setOcrNotice('OCR結果はメモ保存時に一緒に保存されます。')}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView type="backgroundSelected" style={styles.autoTagBtn}>
                      <ThemedText type="smallBold">💾 OCR結果を保存</ThemedText>
                    </ThemedView>
                  </Pressable>
                </ThemedView>
              </>
            )}
          </>
        )}
      </>
    );
  }

  function save() {
    const titleText = title.trim() || '無題';
    const bodyText = body.trim();
    // 手動タグ＋ title/body からの自動タグを統合（重複除去・上限あり）
    const tagList = mergeTags(parseTags(tags), generateAutoTags(titleText, bodyText));
    const summaryText = formSummary.trim();
    // 原文(body)＋（あれば）AI要約(summary)を保存。要約未生成なら summary は空文字で保持。
    const input = {
      title: titleText,
      body: bodyText,
      tags: tagList,
      dateAt: partsToMs(memoDt),
      summary: summaryText,
      images: formImages,
      ocrText: formOcrText.trim(),
    };
    if (editingId) {
      // 編集・追記・要約追加・再保存はいずれも updatedAt を更新（updateMemo 側で更新）
      updateMemo(editingId, input);
    } else {
      // 新規作成時のみ createdAt が作成される（addMemo 側で createdAt=updatedAt）
      addMemo(input);
    }
    setClassifyResult(null);
    setClassifyNotice(null);
    setFormSummaryNotice(null);
    closeForm();
  }

  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];
  // 音声認識が使える環境か（Web: Web Speech / 端末: expo-speech-recognition）
  const speechSupported = isSpeechSupported();
  // デバッグ：利用中の音声認識方式
  const speechMode = Platform.OS === 'web'
    ? (speechSupported ? 'web-speech' : 'mock')
    : (speechSupported ? 'native-speech' : 'mock');
  // 文字起こし結果（結果画面）を表示するか
  const showVoiceResult = voiceTranscript.trim().length > 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <ThemedView style={styles.header}>
            <ThemedText type="subtitle">メモ</ThemedText>
            {!formOpen && (
              <ThemedView style={styles.headerActions}>
                <Pressable
                  onPress={() => setVoiceOpen((v) => !v)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundSelected" style={styles.addBtn}>
                    <ThemedText type="smallBold">🎤 音声</ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable onPress={openNew} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundSelected" style={styles.addBtn}>
                    <ThemedText type="smallBold">＋ 新規</ThemedText>
                  </ThemedView>
                </Pressable>
              </ThemedView>
            )}
          </ThemedView>

          {voiceOpen && (
            <ThemedView type="backgroundElement" style={styles.form}>
              <ThemedText type="smallBold">🎤 音声からメモ作成</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                ※「🎙 話す」を押して話し、「停止」を押すと文字起こし結果が下に表示されます。結果は編集でき、「💾 保存」で保存します。AI要約は「🪄 AI要約」を押した時だけ作成されます（押さなければ原文のみ保存）。
              </ThemedText>

              {speechSupported ? (
                // 音声認識が使える環境：話す→停止で文字起こし（Web Speech / 端末標準認識）
                !listening ? (
                  <Pressable onPress={() => startVoiceInput('new')} style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView style={[styles.autoTagBtn, styles.voiceBtn]}>
                      <ThemedText type="smallBold">🎙 話す（タップで録音開始）</ThemedText>
                    </ThemedView>
                  </Pressable>
                ) : (
                  <Pressable onPress={stopVoiceInput} style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView style={[styles.autoTagBtn, styles.listeningBtn]}>
                      <ThemedText type="smallBold" style={styles.btnLight}>🔴 録音中（停止ボタンを押すまで継続）</ThemedText>
                    </ThemedView>
                  </Pressable>
                )
              ) : (
                // 非対応環境：録音＋仮文字起こしのフォールバック
                <>
                  <ThemedText type="small" style={styles.noticeText}>
                    ※ この環境では本物の音声認識（{speechMode}）に対応していません。下の文字起こしは仮（サンプル）で、実際の発話とは一致しません。Chrome / Edge の localhost でご利用ください。
                  </ThemedText>
                  <VoiceRecorder
                    onRecordingChange={setRecordedUri}
                  />
                  <Pressable
                    onPress={handleMockTranscribe}
                    disabled={transcribing}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView type="backgroundSelected" style={[styles.autoTagBtn, transcribing && styles.btnDisabled]}>
                      <ThemedText type="smallBold">{transcribing ? '文字起こし中…' : '① 仮で文字起こし生成'}</ThemedText>
                    </ThemedView>
                  </Pressable>
                </>
              )}

              {/* 文字起こし結果（タイトル／内容に分けて表示。空のうちは結果ラベルを出さない） */}
              {showVoiceResult && (
                <ThemedText type="smallBold" style={styles.settingLabel}>
                  📝 文字起こし結果（編集できます）
                </ThemedText>
              )}
              {showVoiceResult && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                  タイトル（自動生成・編集できます）
                </ThemedText>
              )}
              {showVoiceResult && (
                <TextInput
                  style={inputStyle}
                  placeholder="タイトル"
                  placeholderTextColor={theme.textSecondary}
                  value={voiceTitle}
                  onChangeText={setVoiceTitle}
                />
              )}
              {showVoiceResult && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                  内容（文字起こし全文）
                </ThemedText>
              )}
              <TextInput
                style={[inputStyle, styles.multiline]}
                placeholder="文字起こし結果がここに表示されます"
                placeholderTextColor={theme.textSecondary}
                value={voiceTranscript}
                onChangeText={setVoiceTranscript}
                multiline
              />

              {/* 追加音声入力：もう一度話して（または録音して）本文末尾へ追記 */}
              <Pressable
                onPress={() => (speechSupported ? startVoiceInput('append') : handleAppendTranscribe())}
                disabled={transcribing || listening}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView
                  type="backgroundSelected"
                  style={[styles.autoTagBtn, (transcribing || listening) && styles.btnDisabled]}>
                  <ThemedText type="smallBold">＋ 追加音声入力（末尾へ追記）</ThemedText>
                </ThemedView>
              </Pressable>

              {/* AI要約：このボタンを押した時のみ要約を生成（保存時は自動要約しない） */}
              <Pressable
                onPress={handleMockSummarize}
                disabled={summarizing}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundSelected" style={[styles.autoTagBtn, summarizing && styles.btnDisabled]}>
                  <ThemedText type="smallBold">{summarizing ? '要約中…' : '🪄 AI要約'}</ThemedText>
                </ThemedView>
              </Pressable>

              <TextInput
                style={[inputStyle, styles.multiline]}
                placeholder="AI要約結果（仮入力）"
                placeholderTextColor={theme.textSecondary}
                value={voiceSummary}
                onChangeText={setVoiceSummary}
                multiline
              />

              {/* タグ（登録前に確認・編集。AI推定タグを初期表示） */}
              <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                タグ（登録前に編集できます・カンマ区切り）
              </ThemedText>
              <TextInput
                style={inputStyle}
                placeholder="例: お客様, 打ち合わせ, 予約"
                placeholderTextColor={theme.textSecondary}
                value={voiceTags}
                onChangeText={setVoiceTags}
              />
              {voiceTags.trim().length > 0 && (
                <ThemedView style={styles.tagRow}>
                  {parseTags(voiceTags).map((tag) => {
                    const ts = getTagStyle(tag);
                    return (
                      <ThemedView key={tag} style={[styles.tag, { backgroundColor: ts.bg }]}>
                        <ThemedText type="small" numberOfLines={1} style={{ color: ts.text }}>
                          #{tagLabel(tag)}
                        </ThemedText>
                      </ThemedView>
                    );
                  })}
                </ThemedView>
              )}

              {/* 画像添付（カメラ撮影・画像選択） */}
              {renderImageAttach('voice', voiceImages)}

              <Pressable
                onPress={handleExtractSchedule}
                disabled={extracting}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundSelected" style={[styles.autoTagBtn, extracting && styles.btnDisabled]}>
                  <ThemedText type="smallBold">{extracting ? '抽出中…' : '③ 予定候補を抽出'}</ThemedText>
                </ThemedView>
              </Pressable>

              {scheduleCandidates.map((c, index) => (
                <ThemedView key={index} type="background" style={styles.candidateCard}>
                  <ThemedText type="smallBold">予定候補 {index + 1}</ThemedText>
                  <TextInput
                    style={inputStyle}
                    placeholder="タイトル"
                    placeholderTextColor={theme.textSecondary}
                    value={c.title}
                    onChangeText={(t) => updateCandidate(index, { title: t })}
                  />
                  <TextInput
                    style={inputStyle}
                    placeholder="日付 (YYYY-MM-DD)"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="none"
                    value={c.date ?? ''}
                    onChangeText={(t) => updateCandidate(index, { date: t })}
                  />
                  <ThemedView style={styles.candidateRow}>
                    <TextInput
                      style={[inputStyle, styles.candidateHalf]}
                      placeholder="開始 (HH:mm)"
                      placeholderTextColor={theme.textSecondary}
                      autoCapitalize="none"
                      value={c.startTime ?? ''}
                      onChangeText={(t) => updateCandidate(index, { startTime: t })}
                    />
                    <TextInput
                      style={[inputStyle, styles.candidateHalf]}
                      placeholder="終了 (HH:mm)"
                      placeholderTextColor={theme.textSecondary}
                      autoCapitalize="none"
                      value={c.endTime ?? ''}
                      onChangeText={(t) => updateCandidate(index, { endTime: t })}
                    />
                  </ThemedView>
                  <TextInput
                    style={inputStyle}
                    placeholder="場所"
                    placeholderTextColor={theme.textSecondary}
                    value={c.location ?? ''}
                    onChangeText={(t) => updateCandidate(index, { location: t })}
                  />
                  <TextInput
                    style={inputStyle}
                    placeholder="内容"
                    placeholderTextColor={theme.textSecondary}
                    value={c.description ?? ''}
                    onChangeText={(t) => updateCandidate(index, { description: t })}
                  />
                  {typeof c.confidence === 'number' && (
                    <ThemedText type="small" themeColor="textSecondary">
                      信頼度: {Math.round(c.confidence * 100)}%
                    </ThemedText>
                  )}
                  <ThemedView style={styles.formActions}>
                    <Pressable onPress={() => discardCandidate(index)} style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView type="backgroundSelected" style={styles.btn}>
                        <ThemedText type="small" style={styles.deleteText}>破棄</ThemedText>
                      </ThemedView>
                    </Pressable>
                    <Pressable onPress={() => registerCandidate(index)} style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView style={[styles.btn, styles.primaryBtn]}>
                        <ThemedText type="smallBold" style={styles.primaryBtnText}>
                          予定に登録
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  </ThemedView>
                </ThemedView>
              ))}

              {voiceNotice && (
                <ThemedText type="small" style={styles.noticeText}>
                  {voiceNotice}
                </ThemedText>
              )}

              <ThemedView style={styles.formActions}>
                <Pressable onPress={() => setVoiceOpen(false)} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundSelected" style={styles.btn}>
                    <ThemedText type="small">閉じる</ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable onPress={registerVoiceMemo} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView style={[styles.btn, styles.primaryBtn]}>
                    <ThemedText type="smallBold" style={styles.primaryBtnText}>
                      💾 保存
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          <ThemedView style={styles.searchRow}>
            <TextInput
              style={[styles.searchInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
              placeholder="タイトル・本文・タグで検索"
              placeholderTextColor={theme.textSecondary}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundSelected" style={styles.clearBtn}>
                  <ThemedText type="smallBold">✕ クリア</ThemedText>
                </ThemedView>
              </Pressable>
            )}
          </ThemedView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}>
            {SOURCE_FILTERS.map((f) => {
              const active = selectedSourceFilter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setSelectedSourceFilter(f.key)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={active ? 'backgroundSelected' : 'backgroundElement'}
                    style={[styles.filterChip, active && styles.filterChipActive]}>
                    <ThemedText type="smallBold" themeColor={active ? 'text' : 'textSecondary'}>
                      {f.label}（{sourceCounts[f.key]}）
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ScrollView>

          {allTags.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}>
              <Pressable
                onPress={() => setSelectedTag(null)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView
                  type={selectedTag === null ? 'backgroundSelected' : 'backgroundElement'}
                  style={[styles.filterChip, selectedTag === null && styles.filterChipActive]}>
                  <ThemedText
                    type="smallBold"
                    themeColor={selectedTag === null ? 'text' : 'textSecondary'}>
                    すべて
                  </ThemedText>
                </ThemedView>
              </Pressable>
              {allTags.map((tag) => {
                const active = selectedTag === tag;
                const ts = getTagStyle(tag);
                return (
                  <Pressable
                    key={tag}
                    onPress={() => setSelectedTag(active ? null : tag)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView
                      style={[
                        styles.filterChip,
                        { backgroundColor: ts.bg },
                        active && { borderColor: ts.border, borderWidth: 2 },
                      ]}>
                      <ThemedText type="smallBold" style={{ color: ts.text }}>
                        #{tagLabel(tag)}
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {formOpen && (
            <ThemedView type="backgroundElement" style={styles.form}>
              <ThemedText type="smallBold">{editingId ? 'メモを編集' : '新規メモ'}</ThemedText>

              {/* 入力方法の選択 */}
              <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                入力方法を選択
              </ThemedText>
              <ThemedView style={styles.selectorRow}>
                <Pressable onPress={() => setMemoMode('voice')} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={memoInputMode === 'voice' ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, memoInputMode === 'voice' && styles.chipActive]}>
                    <ThemedText type="small">🎤 音声で入力</ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable onPress={() => setMemoMode('manual')} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={memoInputMode === 'manual' ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, memoInputMode === 'manual' && styles.chipActive]}>
                    <ThemedText type="small">⌨ 手入力</ThemedText>
                  </ThemedView>
                </Pressable>
              </ThemedView>

              {/* 音声入力モードの操作 */}
              {memoInputMode === 'voice' && (
                <ThemedView style={styles.voicePanel}>
                  <ThemedText type="small" themeColor="textSecondary">
                    話した内容をもとに、タイトルと本文を自動入力します。音声入力後も、内容は自由に修正できます。
                  </ThemedText>
                  <ThemedView style={styles.voiceBtnRow}>
                    <Pressable
                      onPress={() => (memoListening ? stopMemoVoice() : startMemoVoice('title'))}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView style={[styles.autoTagBtn, memoListening === 'title' ? styles.listeningBtn : styles.voiceBtn]}>
                        <ThemedText type="smallBold" style={memoListening === 'title' ? styles.btnLight : undefined}>
                          {memoListening === 'title' ? '● 停止' : 'タイトルを音声入力'}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                    <Pressable
                      onPress={() => (memoListening ? stopMemoVoice() : startMemoVoice('body'))}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView style={[styles.autoTagBtn, memoListening === 'body' ? styles.listeningBtn : styles.voiceBtn]}>
                        <ThemedText type="smallBold" style={memoListening === 'body' ? styles.btnLight : undefined}>
                          {memoListening === 'body' ? '● 停止' : '本文を音声入力'}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                    <Pressable
                      onPress={() => (memoListening ? stopMemoVoice() : startMemoVoice('combined'))}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView style={[styles.autoTagBtn, memoListening === 'combined' ? styles.listeningBtn : styles.voiceBtn]}>
                        <ThemedText type="smallBold" style={memoListening === 'combined' ? styles.btnLight : undefined}>
                          {memoListening === 'combined' ? '● 停止' : 'タイトルと本文をまとめて音声入力'}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  </ThemedView>
                </ThemedView>
              )}

              {memoVoiceNotice && (
                <ThemedText type="small" style={styles.noticeText}>
                  {memoVoiceNotice}
                </ThemedText>
              )}

              <TextInput
                style={inputStyle}
                placeholder="タイトル"
                placeholderTextColor={theme.textSecondary}
                value={title}
                onChangeText={setTitle}
              />
              <TextInput
                style={[inputStyle, styles.multiline]}
                placeholder="本文"
                placeholderTextColor={theme.textSecondary}
                value={body}
                onChangeText={setBody}
                multiline
              />
              <TextInput
                style={inputStyle}
                placeholder="タグ（カンマ区切り 例: 仕事, 重要）"
                placeholderTextColor={theme.textSecondary}
                value={tags}
                onChangeText={setTags}
              />

              {/* 日時（記録日時・選択式） */}
              <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                日時
              </ThemedText>
              <DateTimePicker value={memoDt} onChange={setMemoDt} />

              {/* AI要約（任意・ボタンを押した時のみ生成。保存で原文＋要約を保存） */}
              <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                AI要約（任意）
              </ThemedText>
              <Pressable
                onPress={handleFormSummarize}
                disabled={formSummarizing}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView
                  type="backgroundSelected"
                  style={[styles.autoTagBtn, formSummarizing && styles.btnDisabled]}>
                  <ThemedText type="smallBold">
                    {formSummarizing ? '要約中…' : '🪄 AI要約（本文を要約）'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
              <TextInput
                style={[inputStyle, styles.multiline]}
                placeholder="AI要約（「AI要約」ボタンで生成。手動編集も可）"
                placeholderTextColor={theme.textSecondary}
                value={formSummary}
                onChangeText={setFormSummary}
                multiline
              />
              {formSummaryNotice && (
                <ThemedText type="small" style={styles.noticeText}>
                  {formSummaryNotice}
                </ThemedText>
              )}

              {/* 画像添付（カメラ撮影・画像選択） */}
              {renderImageAttach('form', formImages)}

              <ThemedView style={styles.formActions}>
                <Pressable onPress={addAutoTags} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundSelected" style={styles.autoTagBtn}>
                    <ThemedText type="smallBold">＋ 自動タグ追加</ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable
                  onPress={handleClassifyMemo}
                  disabled={classifying}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundSelected" style={[styles.autoTagBtn, classifying && styles.btnDisabled]}>
                    <ThemedText type="smallBold">{classifying ? '分類中…' : '🏷 AIで分類'}</ThemedText>
                  </ThemedView>
                </Pressable>
              </ThemedView>

              {classifyResult && (
                <ThemedView type="background" style={styles.classifyCard}>
                  <ThemedText type="small" themeColor="textSecondary">自動分類結果</ThemedText>
                  <ThemedText type="small">カテゴリ：{classifyResult.category}</ThemedText>
                  <ThemedText type="small">
                    タグ：{classifyResult.tags.length > 0 ? classifyResult.tags.join('、') : '（なし）'}
                  </ThemedText>
                  {classifyResult.priority && (
                    <ThemedText type="small">優先度：{classifyResult.priority}</ThemedText>
                  )}
                </ThemedView>
              )}
              {classifyNotice && (
                <ThemedText type="small" style={styles.noticeText}>
                  {classifyNotice}
                </ThemedText>
              )}

              <ThemedView style={styles.formActions}>
                <Pressable onPress={closeForm} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundSelected" style={styles.btn}>
                    <ThemedText type="small">キャンセル</ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable onPress={save} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView style={[styles.btn, styles.primaryBtn]}>
                    <ThemedText type="smallBold" style={styles.primaryBtnText}>
                      保存
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          {visibleMemos.length === 0 && !formOpen && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {query.trim().length > 0
                ? `「${query.trim()}」に一致するメモはありません。`
                : selectedTag
                  ? `「#${selectedTag}」のメモはありません。`
                  : selectedSourceFilter === 'voice'
                    ? '音声メモはまだありません。'
                    : selectedSourceFilter === 'manual'
                      ? '通常メモはまだありません。'
                      : 'メモがありません。「＋ 新規」から追加してください。'}
            </ThemedText>
          )}

          {visibleMemos.map((memo) => (
            <ThemedView
              key={memo.id}
              type="backgroundElement"
              style={[styles.card, memo.pinned && styles.cardPinned]}>
              {/* 1行目：日時＋タイトル（タップで編集。本文は一覧に表示しない） */}
              <Pressable onPress={() => openEdit(memo)} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {formatDate(memo.dateAt ?? memo.updatedAt)}　{memo.pinned ? '📌 ' : ''}
                  {memo.images && memo.images.length > 0 ? '📷 ' : ''}
                  {memo.title.trim().length > 0 ? memo.title : '無題のメモ'}
                </ThemedText>
              </Pressable>
              {/* 2行目：タグ（なければ要約の一部）＋ 画像あり表示 */}
              {memo.tags.length > 0 ? (
                <ThemedView style={styles.tagRow}>
                  {memo.tags.map((tag) => {
                    const ts = getTagStyle(tag);
                    return (
                      <ThemedView key={tag} style={[styles.tag, { backgroundColor: ts.bg }]}>
                        <ThemedText type="small" numberOfLines={1} style={{ color: ts.text }}>
                          #{tagLabel(tag)}
                        </ThemedText>
                      </ThemedView>
                    );
                  })}
                  {memo.images && memo.images.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">📷 画像あり</ThemedText>
                  )}
                </ThemedView>
              ) : memo.summary && memo.summary.trim().length > 0 ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {memo.summary.trim()}
                  {memo.images && memo.images.length > 0 ? '　📷 画像あり' : ''}
                </ThemedText>
              ) : memo.images && memo.images.length > 0 ? (
                <ThemedText type="small" themeColor="textSecondary">📷 画像あり</ThemedText>
              ) : null}
              <ThemedView style={styles.cardActions}>
                <Pressable onPress={() => openEdit(memo)} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="link" themeColor="text">
                    編集
                  </ThemedText>
                </Pressable>
                <Pressable onPress={() => togglePin(memo.id)} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="link" themeColor="text">
                    {memo.pinned ? '📌 ピン解除' : '📌 ピン留め'}
                  </ThemedText>
                </Pressable>
                <Pressable onPress={() => confirmDeleteMemo(memo)} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="link" style={styles.deleteText}>
                    削除
                  </ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          ))}
        </ScrollView>

        {/* 画像拡大プレビュー（全画面モーダル） */}
        <Modal
          visible={previewUri !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewUri(null)}>
          <ThemedView style={styles.previewBackdrop}>
            {/* ピンチズーム（端末）／大きく表示（Web） */}
            <ScrollView
              style={styles.previewScroll}
              contentContainerStyle={styles.previewContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              centerContent>
              {previewUri && (
                <Image source={{ uri: previewUri }} style={styles.previewImage} contentFit="contain" />
              )}
            </ScrollView>
            <Pressable
              onPress={() => setPreviewUri(null)}
              style={({ pressed }) => [styles.previewClose, pressed && styles.pressed]}>
              <ThemedText type="smallBold" style={styles.btnLight}>✕ 閉じる</ThemedText>
            </Pressable>
          </ThemedView>
        </Modal>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scroll: { flex: 1, alignSelf: 'stretch' },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: TopInset,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: { flexDirection: 'row', gap: Spacing.two },
  addBtn: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  btnDisabled: { opacity: 0.5 },
  noticeText: { color: '#9B6400' },
  listeningBtn: { backgroundColor: '#E5484D' },
  btnLight: { color: '#ffffff' },
  candidateCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#3C87F7',
  },
  candidateRow: { flexDirection: 'row', gap: Spacing.two },
  candidateHalf: { flex: 1 },
  classifyCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
    borderWidth: 1,
    borderColor: '#8B5CF6',
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  clearBtn: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  filterRow: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.half },
  filterChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipActive: { borderColor: '#3c87f7' },
  form: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  autoTagBtn: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  settingLabel: { marginTop: Spacing.one },
  selectorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { borderColor: '#3c87f7' },
  voicePanel: { gap: Spacing.two, marginTop: Spacing.one },
  voiceBtnRow: { gap: Spacing.two },
  voiceBtn: { backgroundColor: '#E0E1E6' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  btn: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  primaryBtn: { backgroundColor: '#3c87f7' },
  primaryBtnText: { color: '#ffffff' },
  empty: { textAlign: 'center', paddingVertical: Spacing.four },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  cardPinned: {
    borderWidth: 1.5,
    borderColor: '#3C87F7',
  },
  voiceBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E8E0FB',
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  voiceBadgeText: { color: '#5B2A9B' },
  imageBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' },
  previewScroll: { flex: 1 },
  previewContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '100%', minHeight: 300 },
  previewClose: {
    position: 'absolute',
    top: Spacing.five,
    right: Spacing.four,
    backgroundColor: '#00000080',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
  },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  thumbBox: { position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: Spacing.two, backgroundColor: '#00000010' },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E5484D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  tag: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    maxWidth: '100%',
  },
  date: { marginTop: Spacing.half },
  cardActions: { flexDirection: 'row', gap: Spacing.four },
  deleteText: { color: '#e5484d' },
  pressed: { opacity: 0.6 },
});
