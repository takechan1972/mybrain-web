import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * アプリ全体の共有データストア。
 *
 * メモ・予定・チャット履歴を一元管理し、AsyncStorage で永続化する。
 * （DB/API は使わず、Web / iOS / Android 共通の AsyncStorage を利用）
 *
 * メモと予定を一元管理することで、AI チャットが
 * 両方のデータを参照して回答できる設計を維持している。
 */

// ── 保存キー ────────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  memos: 'AI_IPHONE_MEMOS',
  reservations: 'AI_IPHONE_RESERVATIONS',
  chatMessages: 'AI_IPHONE_CHAT_MESSAGES',
  generalChatMessages: 'AI_IPHONE_GENERAL_CHAT_MESSAGES',
} as const;

// ── 型定義 ──────────────────────────────────────────────────────────────────

export type MemoSource = 'manual' | 'voice';

/** メモに添付する画像（将来のOCR対応を見据えた構造） */
export interface MemoImage {
  id: string;
  /** 画像データ（Web/端末共通で永続化できるよう data URI を基本とする） */
  uri: string;
  /** 添付日時 */
  createdAt: number;
  /** OCR状態（将来対応：none=未実施 / pending=実行中 / done=完了 / failed=失敗） */
  ocrStatus?: 'none' | 'pending' | 'done' | 'failed';
  /** OCRで抽出したテキスト（将来対応） */
  ocrText?: string;
}

export interface Memo {
  id: string;
  title: string;
  /** 文字起こし原文（手入力の本文も含む） */
  body: string;
  tags: string[];
  pinned: boolean;
  source: MemoSource;
  /** AI要約（「AI要約」ボタンを押した時のみ生成。未生成なら undefined/空文字） */
  summary?: string;
  /** 添付画像（カメラ撮影・画像選択。将来OCR対応） */
  images?: MemoImage[];
  /** 画像OCR結果（「画像から文字起こし」ボタン押下時のみ生成） */
  ocrText?: string;
  /** メモの日時（記録日時として利用。未設定なら createdAt を使う） */
  dateAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Reservation {
  id: string;
  name: string;
  /** 予定そのものの日時（scheduleDateTime）。例: 2026-06-10 14:00 */
  datetime: string;
  content: string;
  note: string;
  /** 通知ON/OFF（既定 false。実際の通知送信は今後対応） */
  notificationEnabled?: boolean;
  /** 登録日時 */
  createdAt: number;
  /** 更新日時（編集時のみ更新） */
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** AI回答が参照したメモのタイトル（任意・表示用） */
  refTitles?: string[];
  /** AI回答が参照した予約のタイトル（任意・表示用） */
  refScheduleTitles?: string[];
}

export type MemoInput = Pick<Memo, 'title' | 'body' | 'tags'> & {
  dateAt?: number;
  summary?: string;
  images?: MemoImage[];
  ocrText?: string;
};
export type ReservationInput = Pick<Reservation, 'name' | 'datetime' | 'content' | 'note'> & {
  notificationEnabled?: boolean;
};

// ── ユーティリティ ──────────────────────────────────────────────────────────

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Context 定義 ────────────────────────────────────────────────────────────

interface AppDataContextValue {
  hydrated: boolean;
  memos: Memo[];
  reservations: Reservation[];
  chatMessages: ChatMessage[];
  /** 通常AIチャット（メモ・予定を参照しない）の会話履歴 */
  generalChatMessages: ChatMessage[];
  addMemo: (input: MemoInput, source?: MemoSource) => void;
  updateMemo: (id: string, input: MemoInput) => void;
  deleteMemo: (id: string) => void;
  togglePin: (id: string) => void;
  addReservation: (input: ReservationInput) => void;
  updateReservation: (id: string, input: ReservationInput) => void;
  deleteReservation: (id: string) => void;
  appendChatMessages: (messages: ChatMessage[]) => void;
  appendGeneralChatMessages: (messages: ChatMessage[]) => void;
  clearGeneralChatMessages: () => void;
  newChatMessage: (
    role: ChatMessage['role'],
    text: string,
    refTitles?: string[],
    refScheduleTitles?: string[],
  ) => ChatMessage;
  clearChatMessages: () => void;
  importData: (payload: {
    memos?: Memo[];
    reservations?: Reservation[];
    chatMessages?: ChatMessage[];
  }) => void;
  resetAllData: () => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

// ── 初期サンプルデータ（保存データが無いとき / リセット時のフォールバック） ────
// 毎回新しい id・日時で生成できるよう factory 関数にしている。

function makeInitialMemos(): Memo[] {
  const ts = Date.now();
  return [
    {
      id: genId(),
      title: 'はじめてのメモ',
      body: '右上の「＋ 新規」からメモを追加できます。',
      tags: ['サンプル'],
      pinned: false,
      source: 'manual',
      createdAt: ts,
      updatedAt: ts,
    },
  ];
}

function makeInitialReservations(): Reservation[] {
  const ts = Date.now();
  return [
    {
      id: genId(),
      name: '山田太郎',
      datetime: '2026-06-10 14:00',
      content: 'カットの予定',
      note: '初回来店',
      createdAt: ts,
      updatedAt: ts,
    },
  ];
}

function makeInitialChatMessages(): ChatMessage[] {
  return [
    {
      id: genId(),
      role: 'assistant',
      text: 'こんにちは！メモや予定について質問できます。「来週の予定を教えて」などと聞けます。',
    },
  ];
}

function makeInitialGeneralChatMessages(): ChatMessage[] {
  return [
    {
      id: genId(),
      role: 'assistant',
      text: 'こんにちは！一般的な質問・文章作成・アイデア出しなどにお使いください。（メモや予定は参照しません）',
    },
  ];
}

// ── 永続化ヘルパー ──────────────────────────────────────────────────────────

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  // 保存失敗はUIを止めないよう握りつぶす（ベストエフォート）
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

// ── Provider ────────────────────────────────────────────────────────────────

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [memos, setMemos] = useState<Memo[]>(makeInitialMemos);
  const [reservations, setReservations] = useState<Reservation[]>(makeInitialReservations);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(makeInitialChatMessages);
  const [generalChatMessages, setGeneralChatMessages] = useState<ChatMessage[]>(
    makeInitialGeneralChatMessages,
  );

  // 起動時に保存済みデータを読み込む
  useEffect(() => {
    let active = true;
    (async () => {
      const [savedMemos, savedReservations, savedChat, savedGeneralChat] = await Promise.all([
        loadJson<Memo[]>(STORAGE_KEYS.memos, makeInitialMemos()),
        loadJson<Reservation[]>(STORAGE_KEYS.reservations, makeInitialReservations()),
        loadJson<ChatMessage[]>(STORAGE_KEYS.chatMessages, makeInitialChatMessages()),
        loadJson<ChatMessage[]>(
          STORAGE_KEYS.generalChatMessages,
          makeInitialGeneralChatMessages(),
        ),
      ]);
      if (!active) return;
      // 既存データに pinned / source が無い場合は補完する
      setMemos(
        savedMemos.map((m) => ({ ...m, pinned: m.pinned ?? false, source: m.source ?? 'manual' })),
      );
      // 既存予定に updatedAt が無い場合は createdAt で補完
      setReservations(
        savedReservations.map((r) => ({ ...r, updatedAt: r.updatedAt ?? r.createdAt })),
      );
      setChatMessages(savedChat);
      setGeneralChatMessages(savedGeneralChat);
      setHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // 変更を AsyncStorage へ保存（ロード完了後のみ。初期値での上書きを防ぐ）
  const skip = useRef(true);
  useEffect(() => {
    if (!hydrated) return;
    if (skip.current) {
      // hydrated になった直後の初回 run は保存不要（読み込んだ値そのまま）
      skip.current = false;
      return;
    }
    saveJson(STORAGE_KEYS.memos, memos);
  }, [memos, hydrated]);

  useEffect(() => {
    if (!hydrated || skip.current) return;
    saveJson(STORAGE_KEYS.reservations, reservations);
  }, [reservations, hydrated]);

  useEffect(() => {
    if (!hydrated || skip.current) return;
    saveJson(STORAGE_KEYS.chatMessages, chatMessages);
  }, [chatMessages, hydrated]);

  useEffect(() => {
    if (!hydrated || skip.current) return;
    saveJson(STORAGE_KEYS.generalChatMessages, generalChatMessages);
  }, [generalChatMessages, hydrated]);

  const addMemo = useCallback((input: MemoInput, source: MemoSource = 'manual') => {
    const ts = Date.now();
    setMemos((prev) => [
      { id: genId(), ...input, pinned: false, source, createdAt: ts, updatedAt: ts },
      ...prev,
    ]);
  }, []);

  const togglePin = useCallback((id: string) => {
    setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m)));
  }, []);

  const updateMemo = useCallback((id: string, input: MemoInput) => {
    setMemos((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...input, updatedAt: Date.now() } : m)),
    );
  }, []);

  const deleteMemo = useCallback((id: string) => {
    setMemos((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const addReservation = useCallback((input: ReservationInput) => {
    const ts = Date.now();
    setReservations((prev) => [{ id: genId(), ...input, createdAt: ts, updatedAt: ts }, ...prev]);
  }, []);

  const updateReservation = useCallback((id: string, input: ReservationInput) => {
    setReservations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...input, updatedAt: Date.now() } : r)),
    );
  }, []);

  const deleteReservation = useCallback((id: string) => {
    setReservations((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const appendChatMessages = useCallback((msgs: ChatMessage[]) => {
    setChatMessages((prev) => [...prev, ...msgs]);
  }, []);

  const appendGeneralChatMessages = useCallback((msgs: ChatMessage[]) => {
    setGeneralChatMessages((prev) => [...prev, ...msgs]);
  }, []);

  const clearGeneralChatMessages = useCallback(() => {
    setGeneralChatMessages([]);
  }, []);

  const newChatMessage = useCallback(
    (
      role: ChatMessage['role'],
      text: string,
      refTitles?: string[],
      refScheduleTitles?: string[],
    ): ChatMessage => ({
      id: genId(),
      role,
      text,
      ...(refTitles && refTitles.length > 0 ? { refTitles } : {}),
      ...(refScheduleTitles && refScheduleTitles.length > 0 ? { refScheduleTitles } : {}),
    }),
    [],
  );

  // 会話履歴のみを空にする（メモ・予定・設定は変更しない）
  const clearChatMessages = useCallback(() => {
    setChatMessages([]);
  }, []);

  // id でアップサート（既存は上書き、新規は追加）
  const importData = useCallback(
    (payload: { memos?: Memo[]; reservations?: Reservation[]; chatMessages?: ChatMessage[] }) => {
      function upsert<T extends { id: string }>(prev: T[], incoming: T[]): T[] {
        const map = new Map(prev.map((item) => [item.id, item]));
        for (const item of incoming) {
          map.set(item.id, item);
        }
        return Array.from(map.values());
      }
      if (payload.memos && payload.memos.length > 0) {
        setMemos((prev) => upsert(prev, payload.memos!));
      }
      if (payload.reservations && payload.reservations.length > 0) {
        setReservations((prev) => upsert(prev, payload.reservations!));
      }
      if (payload.chatMessages && payload.chatMessages.length > 0) {
        setChatMessages((prev) => upsert(prev, payload.chatMessages!));
      }
    },
    [],
  );

  // 全データ削除 → 保存キーを消し、Context state を初期サンプルに戻す
  const resetAllData = useCallback(async () => {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.memos,
        STORAGE_KEYS.reservations,
        STORAGE_KEYS.chatMessages,
        STORAGE_KEYS.generalChatMessages,
      ]);
    } catch {
      // 削除失敗時も state は初期化する（ベストエフォート）
    }
    // state を初期サンプルへ。直後の保存 effect が新しい初期値を書き戻す
    setMemos(makeInitialMemos());
    setReservations(makeInitialReservations());
    setChatMessages(makeInitialChatMessages());
    setGeneralChatMessages(makeInitialGeneralChatMessages());
  }, []);

  const value = useMemo<AppDataContextValue>(
    () => ({
      hydrated,
      memos,
      reservations,
      chatMessages,
      generalChatMessages,
      addMemo,
      updateMemo,
      deleteMemo,
      togglePin,
      addReservation,
      updateReservation,
      deleteReservation,
      appendChatMessages,
      appendGeneralChatMessages,
      clearGeneralChatMessages,
      newChatMessage,
      clearChatMessages,
      importData,
      resetAllData,
    }),
    [
      hydrated,
      memos,
      reservations,
      chatMessages,
      generalChatMessages,
      addMemo,
      updateMemo,
      deleteMemo,
      togglePin,
      addReservation,
      updateReservation,
      deleteReservation,
      appendChatMessages,
      appendGeneralChatMessages,
      clearGeneralChatMessages,
      newChatMessage,
      clearChatMessages,
      importData,
      resetAllData,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error('useAppData must be used within an AppDataProvider');
  }
  return ctx;
}
