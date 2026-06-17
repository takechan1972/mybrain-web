/** メモ（P1：手入力。将来 Supabase の memos テーブルに対応） */
export interface Memo {
  id: string;
  title: string;
  body: string;
  tags: string[];
  /** 添付画像（data URI の配列。memos.images jsonb に保存） */
  images: string[];
  /** 作成日時（epoch ms。新規作成時のみ設定） */
  createdAt: number;
  /** 更新日時（epoch ms。編集時に更新） */
  updatedAt: number;
}

export type MemoInput = Pick<Memo, 'title' | 'body' | 'tags' | 'images'>;

/** 予定（reservations テーブルに対応） */
export interface Reservation {
  id: string;
  title: string;
  content: string;
  /** 開始日時（epoch ms。未設定は null）。新カラム start_at。 */
  startAt: number | null;
  /** 終了日時（epoch ms。未設定は null）。新カラム end_at。 */
  endAt: number | null;
  /** 終日フラグ。新カラム all_day。 */
  allDay: boolean;
  /**
   * 予定日時（epoch ms。未設定は null）。
   * 後方互換のため残す＝原則 startAt と同値（旧 schedule_at からのフォールバック含む）。
   * 既存の表示・相談ロジックはこのフィールドを引き続き参照できる。
   */
  scheduleAt: number | null;
  /** 通知ON/OFF */
  notificationEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 予定の作成・更新入力。
 * - 新フォーム：startAt / endAt / allDay を渡す。
 * - 後方互換：旧呼び出し（scheduleAt のみ）も許容（startAt 未指定時は scheduleAt を開始日時として使用）。
 */
export interface ReservationInput {
  title: string;
  content: string;
  notificationEnabled: boolean;
  startAt?: number | null;
  endAt?: number | null;
  allDay?: boolean;
  /** 旧API互換。startAt 未指定時のフォールバックとして使われる。 */
  scheduleAt?: number | null;
}
