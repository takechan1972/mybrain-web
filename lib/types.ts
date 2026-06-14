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
  /** 予定日時（epoch ms。未設定は null） */
  scheduleAt: number | null;
  /** 通知ON/OFF */
  notificationEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ReservationInput = Pick<
  Reservation,
  'title' | 'content' | 'scheduleAt' | 'notificationEnabled'
>;
