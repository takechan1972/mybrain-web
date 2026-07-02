import type { RefTarget } from './consult-store';
import type { Memo, Reservation } from './types';

/**
 * AI相談のローカル回答エンジン。
 * 保存済みのメモ・予定（Supabase から取得済みの配列）を参照して回答文を組み立てる。
 *
 * NOTE: 将来 AI API（Claude など）を接続する場合は、buildConsultAnswer の代わりに
 * API 呼び出し関数を用意し、ここで組み立てている「参照データの抽出結果」を
 * プロンプトのコンテキストとして渡す構成に差し替えられる。
 */

export interface ConsultAnswer {
  answer: string;
  /** 回答が参照したメモ件数 */
  memoCount: number;
  /** 回答が参照した予定件数 */
  scheduleCount: number;
  /** 回答が参照した予定ID（タップで詳細へ遷移するため） */
  scheduleIds: string[];
  /** 回答が参照したメモID（タップで詳細へ遷移するため） */
  memoIds: string[];
}

type DateScope = 'today' | 'tomorrow' | 'thisweek' | 'future' | null;

/** どんな値でも安全に文字列化（null/undefined/数値などで落ちないように） */
function s(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

/** 配列でない値が来ても安全に配列として扱う */
function arr<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

// 質問からキーワードを抽出する際に無視する語
const STOP_WORDS = [
  '教えてください', '教えて', 'ください', '下さい',
  'まとめてください', 'まとめて', 'まとめ',
  '整理してください', '整理して', '整理',
  '要約してください', '要約して', '要約',
  '一覧', 'リスト', '表示して', '表示', '確認して', '確認',
  'について', 'ですか', 'ますか', 'です', 'ます', 'して',
  'やること', '何がある', 'ある', 'あります', '何', 'なに',
  '最近', 'これまで', '直近',
];
const DATE_WORDS = ['明後日', '明日', '今日', '本日', '今後', '来週', '今週'];
const GENERIC_WORDS = ['スケジュール', '予定', 'メモ', 'タスク'];

function detectDateScope(question: string): DateScope {
  if (question.includes('明日')) return 'tomorrow';
  if (question.includes('今日') || question.includes('本日')) return 'today';
  if (question.includes('今週')) return 'thisweek';
  if (question.includes('今後') || question.includes('来週')) return 'future';
  return null;
}

type RecentIntent = 'latest' | 'recent' | null;

// 「直近1件」を求める表現（さっき入力した／今登録した／最新／最後 など）。
// メモ・予定で共通。ドメイン（メモ/予定）は別途キーワードで判定する。
const LATEST_WORDS = [
  'さっき', 'たった今',
  '今入力', 'いま入力', '今登録', 'いま登録', '今保存', 'いま保存', '今作成', 'いま作成',
  '入力した', '登録した', '保存した', '作成した', '入れた',
  '最新', '最後', 'last memo', 'latest memo', 'last schedule', 'latest schedule',
  'just added', 'just entered',
];
// 「最近の複数件」を求める表現
const RECENT_WORDS = ['最近', 'さいきん', '直近', 'recent memo', 'recent memos', 'recent schedule', 'recent schedules'];

/**
 * 「さっき入力した」「最近の」「最新の」のような“直近参照”の意図を検出する（ドメイン非依存）。
 * これらの語は本文・タイトルには含まれないため、キーワード検索ではなく
 * 作成日時の新しい順で返すべき、という判定に使う。
 */
function detectRecentWord(question: string): RecentIntent {
  const q = s(question).toLowerCase();
  if (LATEST_WORDS.some((w) => q.includes(w.toLowerCase()))) return 'latest';
  if (RECENT_WORDS.some((w) => q.includes(w.toLowerCase()))) return 'recent';
  return null;
}

/** 作成日時（なければ更新日時）の新しい順に並べて先頭 n 件 */
function recentSorted(memos: Memo[], n: number): Memo[] {
  return [...memos]
    .sort((a, b) => {
      const ta = Math.max(a.createdAt || 0, a.updatedAt || 0);
      const tb = Math.max(b.createdAt || 0, b.updatedAt || 0);
      return tb - ta;
    })
    .slice(0, n);
}

/** 質問文から検索キーワードを抽出（日時語・指示語・助詞を除去） */
export function extractKeywords(question: string): string[] {
  let q = s(question).replace(/[?？!！。、．，]/g, ' ');
  for (const w of [...STOP_WORDS, ...DATE_WORDS, ...GENERIC_WORDS]) {
    q = q.split(w).join(' ');
  }
  return q
    .split(/[\s　]+/)
    .map((t) => t.replace(/^[はをがのにへとでからまで]+/u, '').replace(/[はをがのにへとでからまで]+$/u, ''))
    .filter((t) => t.length >= 2);
}

function dayRange(offsetDays: number): { from: number; to: number } {
  const n = new Date();
  const from = new Date(n.getFullYear(), n.getMonth(), n.getDate() + offsetDays).getTime();
  const to = new Date(n.getFullYear(), n.getMonth(), n.getDate() + offsetDays + 1).getTime() - 1;
  return { from, to };
}

/**
 * 「今週」のレンジ：今日の0:00から今週の日曜23:59:59まで（過去日は含めない）。
 * dayRange と同じくローカル日付で計算する。今日が日曜なら今日の終わりまで。
 */
function weekRange(): { from: number; to: number } {
  const n = new Date();
  const from = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const daysUntilSunday = (7 - n.getDay()) % 7; // 日曜=0, 月曜=6, … 土曜=1
  const to = new Date(n.getFullYear(), n.getMonth(), n.getDate() + daysUntilSunday + 1).getTime() - 1;
  return { from, to };
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function mdhm(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** メモ本文を安全に取り出す（標準は body。旧/別構造の content・transcript・summary も拾う） */
function memoText(m: Memo): string {
  const anyM = m as unknown as Record<string, unknown>;
  return s(m.body) || s(anyM.content) || s(anyM.transcript) || s(anyM.summary) || '';
}

function memoPreview(m: Memo): string {
  const body = memoText(m).trim().replace(/\s+/g, ' ');
  return body.length > 60 ? `${body.slice(0, 60)}…` : body;
}

function matchMemo(m: Memo, keywords: string[]): boolean {
  const hay = `${s(m.title)} ${memoText(m)} ${arr(m.tags).map(s).join(' ')}`.toLowerCase();
  return keywords.some((k) => hay.includes(s(k).toLowerCase()));
}

function matchReservation(r: Reservation, keywords: string[]): boolean {
  const hay = `${s(r.title)} ${s(r.content)}`.toLowerCase();
  return keywords.some((k) => hay.includes(s(k).toLowerCase()));
}

/** 明示コマンド（「メモ検索: X」「タグ検索: X」）。半角/全角コロン両対応。 */
type AssistCommand =
  | { kind: 'memo-search'; term: string }
  | { kind: 'tag-search'; term: string };

/**
 * 質問文の先頭が「メモ検索:」「タグ検索:」（半角/全角コロン）で始まる場合だけコマンドとして解釈する。
 * - 一致しなければ null（呼び出し側は従来ロジックへフォールスルー＝自由文の挙動は不変）。
 * - プレフィックスは取り除き、後続の語だけを検索語として返す（メモ検索/タグ検索/検索 は検索語に含めない）。
 */
function parseAssistCommand(question: string): AssistCommand | null {
  const q = s(question).trim();
  const memoMatch = q.match(/^メモ検索\s*[:：]\s*(.+)$/);
  if (memoMatch) {
    const term = memoMatch[1].trim();
    if (term.length > 0) return { kind: 'memo-search', term };
  }
  const tagMatch = q.match(/^タグ検索\s*[:：]\s*(.+)$/);
  if (tagMatch) {
    const term = tagMatch[1].trim();
    if (term.length > 0) return { kind: 'tag-search', term };
  }
  return null;
}

/** メモの「タグのみ」を対象に部分一致（大文字小文字無視）。本文・タイトルは見ない。先頭 # は無視。 */
function matchMemoTag(m: Memo, term: string): boolean {
  const t = s(term).replace(/^#/, '').toLowerCase();
  if (t.length === 0) return false;
  return arr(m.tags).map(s).some((tag) => tag.toLowerCase().includes(t));
}

/** 予定パート（参照予定リストと文）を作る */
function buildScheduleSection(
  reservations: Reservation[],
  scope: DateScope,
  keywords: string[],
): { text: string; used: Reservation[] } {
  let list = reservations.filter((r) => r.scheduleAt !== null);
  let label = '予定';
  if (scope === 'today') {
    const { from, to } = dayRange(0);
    list = list.filter((r) => (r.scheduleAt as number) >= from && (r.scheduleAt as number) <= to);
    label = '今日の予定';
  } else if (scope === 'tomorrow') {
    const { from, to } = dayRange(1);
    list = list.filter((r) => (r.scheduleAt as number) >= from && (r.scheduleAt as number) <= to);
    label = '明日の予定';
  } else if (scope === 'thisweek') {
    const { from, to } = weekRange();
    list = list.filter((r) => (r.scheduleAt as number) >= from && (r.scheduleAt as number) <= to);
    label = '今週の予定';
  } else if (scope === 'future') {
    const { to } = dayRange(0);
    list = list.filter((r) => (r.scheduleAt as number) > to);
    label = '今後の予定';
  }
  if (keywords.length > 0) list = list.filter((r) => matchReservation(r, keywords));
  list = list.sort((a, b) => (a.scheduleAt as number) - (b.scheduleAt as number));

  if (list.length === 0) {
    if (keywords.length > 0) {
      return { text: `「${keywords.join('、')}」に関する予定は見つかりませんでした。`, used: [] };
    }
    return { text: `${label}は登録されていません。`, used: [] };
  }

  const fmt = scope === 'today' || scope === 'tomorrow' ? hhmm : mdhm;
  if (list.length === 1) {
    const r = list[0];
    const c = s(r.content).trim();
    const detail = c.length > 0 ? `（${c}）` : '';
    return {
      text: `${label}は${fmt(r.scheduleAt as number)}に${s(r.title) || '無題の予定'}があります。${detail}`,
      used: list,
    };
  }
  const lines = list.map((r) => `・${fmt(r.scheduleAt as number)}　${s(r.title) || '無題の予定'}`);
  return { text: `${label}は${list.length}件あります。\n${lines.join('\n')}`, used: list };
}

function startOfTodayMs(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

/**
 * キーワードで予定を検索する（日付スコープなしの「歯医者は何時？」等）。
 * 今後の予定を優先し（近い順）、無ければ最新の過去予定を返す。
 * → 同名の古い予定ではなく、新しく保存した予定を優先して答えられる。
 */
function buildScheduleKeyword(reservations: Reservation[], keywords: string[]): { text: string; used: Reservation[] } {
  const hits = reservations.filter((r) => r.scheduleAt !== null && matchReservation(r, keywords));
  if (hits.length === 0) return { text: '', used: [] };
  const today0 = startOfTodayMs();
  const upcoming = hits
    .filter((r) => (r.scheduleAt as number) >= today0)
    .sort((a, b) => (a.scheduleAt as number) - (b.scheduleAt as number));
  const past = hits
    .filter((r) => (r.scheduleAt as number) < today0)
    .sort((a, b) => (b.scheduleAt as number) - (a.scheduleAt as number));
  const ordered = upcoming.length > 0 ? upcoming : past;
  if (ordered.length === 1) {
    const r = ordered[0];
    const c = s(r.content).trim();
    const detail = c.length > 0 ? `（${c}）` : '';
    return { text: `「${s(r.title) || '無題の予定'}」の予定は${mdhm(r.scheduleAt as number)}です。${detail}`, used: [r] };
  }
  const lines = ordered.map((x) => `・${mdhm(x.scheduleAt as number)}　${s(x.title) || '無題の予定'}`);
  return {
    text: `「${keywords.join('、')}」に関する予定が${ordered.length}件あります。\n${lines.join('\n')}`,
    used: ordered,
  };
}

/** 作成日時（なければ更新日時）の新しい順に予定を並べて先頭 n 件 */
function reservationRecentSorted(reservations: Reservation[], n: number): Reservation[] {
  return [...reservations]
    .sort((a, b) => Math.max(b.createdAt || 0, b.updatedAt || 0) - Math.max(a.createdAt || 0, a.updatedAt || 0))
    .slice(0, n);
}

/** 予定日時の読みやすいラベル（今日/明日は時刻、それ以外は月日＋時刻、未設定は「日時未設定」） */
function whenLabel(ms: number | null): string {
  if (ms === null) return '日時未設定';
  const t = dayRange(0);
  const tm = dayRange(1);
  if (ms >= t.from && ms <= t.to) return `今日 ${hhmm(ms)}`;
  if (ms >= tm.from && ms <= tm.to) return `明日 ${hhmm(ms)}`;
  return mdhm(ms);
}

/** 直近1件の予定（「さっき入力した予定」「最新の予定」など）。作成日時の新しい順。 */
function buildLatestSchedule(reservations: Reservation[]): { text: string; used: Reservation[] } {
  const recent = reservationRecentSorted(reservations, 1);
  if (recent.length === 0) return { text: '登録済みの予定が見つかりませんでした。', used: [] };
  const r = recent[0];
  const c = s(r.content).trim();
  const detail = c.length > 0 ? ` 内容は「${c}」です。` : '';
  return {
    text: `直近に登録した予定は、${whenLabel(r.scheduleAt)}の「${s(r.title) || '無題の予定'}」です。${detail}`,
    used: [r],
  };
}

/** 最近登録した予定を最大5件（作成日時の新しい順） */
function buildRecentSchedules(reservations: Reservation[]): { text: string; used: Reservation[] } {
  const recent = reservationRecentSorted(reservations, 5);
  if (recent.length === 0) return { text: '登録済みの予定が見つかりませんでした。', used: [] };
  const lines = recent.map((r) => `・${whenLabel(r.scheduleAt)}　${s(r.title) || '無題の予定'}`);
  return { text: `最近登録した予定は${recent.length}件です。\n${lines.join('\n')}`, used: recent };
}

/** メモパート（参照メモリストと文）を作る */
function buildMemoSection(memos: Memo[], keywords: string[]): { text: string; used: Memo[] } {
  if (keywords.length > 0) {
    const hit = memos.filter((m) => matchMemo(m, keywords));
    if (hit.length === 0) {
      return { text: `「${keywords.join('、')}」に関するメモは見つかりませんでした。`, used: [] };
    }
    if (hit.length === 1) {
      const m = hit[0];
      const preview = memoPreview(m);
      const body = preview.length > 0 ? `、${preview}と記録されています` : 'が保存されています';
      return { text: `「${s(m.title) || '無題のメモ'}」のメモには${body}。`, used: hit };
    }
    const lines = hit.slice(0, 5).map((m) => `・${s(m.title) || '無題のメモ'}：${memoPreview(m) || '（本文なし）'}`);
    return {
      text: `「${keywords.join('、')}」に関するメモが${hit.length}件あります。\n${lines.join('\n')}`,
      used: hit,
    };
  }
  // キーワードなし（「最近のメモを整理して」など）→ 最近のメモを要約
  return buildRecentMemos(memos);
}

/** 直近1件のメモを返す（「さっき保存したメモ」「最新のメモ」など） */
function buildLatestMemo(memos: Memo[]): { text: string; used: Memo[] } {
  const recent = recentSorted(memos, 1);
  if (recent.length === 0) return { text: 'メモはまだ保存されていません。', used: [] };
  const m = recent[0];
  const preview = memoPreview(m);
  const detail = preview.length > 0 ? `\n内容：${preview}` : '';
  return { text: `直近に保存したメモは「${s(m.title) || '無題のメモ'}」です。${detail}`, used: [m] };
}

/** 最近のメモを最大5件返す（「最近のメモ」「直近のメモ」など） */
function buildRecentMemos(memos: Memo[]): { text: string; used: Memo[] } {
  const recent = recentSorted(memos, 5);
  if (recent.length === 0) return { text: 'メモはまだ保存されていません。', used: [] };
  const lines = recent.map((m) => `・${s(m.title) || '無題のメモ'}：${memoPreview(m) || '（本文なし）'}`);
  return { text: `最近のメモは${recent.length}件です。\n${lines.join('\n')}`, used: recent };
}

/**
 * 質問＋参照対象＋保存データからローカル回答を生成する。
 * （将来はこの関数の置き換えで AI API 連携に移行できる）
 */
export function buildConsultAnswer(
  question: string,
  refTarget: RefTarget,
  memosInput: Memo[],
  reservationsInput: Reservation[],
): ConsultAnswer {
  // 入力が null/undefined や非配列でも落ちないように正規化
  const memos = arr(memosInput);
  const reservations = arr(reservationsInput);

  // 明示コマンド（「メモ検索: X」「タグ検索: X」）を最優先で処理する。
  // - プレフィックスに一致したときだけ発火。一致しなければ従来ロジックへフォールスルー（自由文の挙動は不変）。
  // - どちらもメモ限定。タグ検索はタグのみを対象（本文・タイトルは見ない）。
  const command = parseAssistCommand(question);
  if (command) {
    if (command.kind === 'memo-search') {
      const sec = buildMemoSection(memos, [command.term]);
      return {
        answer: sec.text,
        memoCount: sec.used.length,
        scheduleCount: 0,
        scheduleIds: [],
        memoIds: sec.used.map((m) => m.id),
      };
    }
    // タグ検索：タグのみ一致（本文・タイトルは対象外）
    const tag = command.term.replace(/^#/, '');
    const hits = memos.filter((m) => matchMemoTag(m, command.term));
    if (hits.length === 0) {
      return { answer: `タグ「${tag}」のメモは見つかりませんでした。`, memoCount: 0, scheduleCount: 0, scheduleIds: [], memoIds: [] };
    }
    const lines = hits.slice(0, 5).map((m) => `・${s(m.title) || '無題のメモ'}：${memoPreview(m) || '（本文なし）'}`);
    return {
      answer: `タグ「${tag}」のメモが${hits.length}件あります。\n${lines.join('\n')}`,
      memoCount: hits.length,
      scheduleCount: 0,
      scheduleIds: [],
      memoIds: hits.map((m) => m.id),
    };
  }

  const useMemos = refTarget === 'both' || refTarget === 'memos';
  const useSched = refTarget === 'both' || refTarget === 'schedule';

  // 参照対象のデータが空の場合の案内
  if (useMemos && useSched && memos.length === 0 && reservations.length === 0) {
    return { answer: '保存されたメモや予定はまだありません。メモや予定を登録すると、その内容をもとにお答えできます。', memoCount: 0, scheduleCount: 0, scheduleIds: [], memoIds: [] };
  }
  if (useMemos && !useSched && memos.length === 0) {
    return { answer: '保存されたメモはまだありません。メモを登録すると、その内容をもとにお答えできます。', memoCount: 0, scheduleCount: 0, scheduleIds: [], memoIds: [] };
  }
  if (!useMemos && useSched && reservations.length === 0) {
    return { answer: '保存された予定はまだありません。予定を登録すると、その内容をもとにお答えできます。', memoCount: 0, scheduleCount: 0, scheduleIds: [], memoIds: [] };
  }

  const scope = detectDateScope(question);
  const keywords = extractKeywords(question);
  const wantsSummary = /まとめ|整理|要約/.test(question);
  const explicitSchedule = /予定|スケジュール/.test(question); // 「予定」という語の明示（日付スコープとは別）
  const mentionsSchedule = scope !== null || explicitSchedule;
  const mentionsMemo = /メモ|記録/.test(question);

  // 「さっき入力した予定」「最新のメモ」等の直近参照。ドメインは 予定/メモ の語で振り分ける。
  // - 予定の語あり → 予定の直近参照
  // - メモの語あり、または両ドメイン非明示 → メモの直近参照（従来動作を維持）
  const recentWord = detectRecentWord(question);
  const recentScheduleIntent: RecentIntent =
    recentWord && useSched && (mentionsSchedule || (!mentionsMemo && !useMemos)) ? recentWord : null;
  const recentMemoIntent: RecentIntent =
    recentWord && useMemos && recentScheduleIntent === null && (mentionsMemo || !mentionsSchedule) ? recentWord : null;

  const parts: string[] = [];
  let memoCount = 0;
  let scheduleCount = 0;
  // 参照した実データ（タップ遷移用に ID を取り出す）
  let usedSchedules: Reservation[] = [];
  let usedMemos: Memo[] = [];

  // 純粋なキーワード質問（「歯医者は何時？」など。日付指定・要約・直近意図・明示ドメインなし）
  // → 予定とメモの両方をキーワード検索し、ヒットした側を答える（予定の取りこぼし防止）。
  const pureKeyword =
    recentMemoIntent === null &&
    recentScheduleIntent === null &&
    !wantsSummary &&
    scope === null &&
    !mentionsSchedule &&
    !mentionsMemo &&
    keywords.length > 0;
  if (pureKeyword) {
    let answered = false;
    if (useSched) {
      const sec = buildScheduleKeyword(reservations, keywords);
      if (sec.used.length > 0) {
        parts.push(sec.text);
        scheduleCount = sec.used.length;
        usedSchedules = sec.used;
        answered = true;
      }
    }
    if (useMemos) {
      const sec = buildMemoSection(memos, keywords);
      if (sec.used.length > 0) {
        parts.push(sec.text);
        memoCount = sec.used.length;
        usedMemos = sec.used;
        answered = true;
      }
    }
    if (!answered) {
      const domain = useSched && useMemos ? '予定・メモ' : useSched ? '予定' : 'メモ';
      parts.push(`「${keywords.join('、')}」に関する${domain}は見つかりませんでした。`);
    }
    return {
      answer: parts.join('\n\n'),
      memoCount,
      scheduleCount,
      scheduleIds: usedSchedules.map((r) => r.id),
      memoIds: usedMemos.map((m) => m.id),
    };
  }

  // どのパートを答えるか：明示された方を優先。どちらも明示なしなら参照対象の両方。
  // 「さっき入力した予定」等の直近予定意図 / 「さっき保存したメモ」等の直近メモ意図を尊重する。
  const answerSchedule =
    useSched &&
    recentMemoIntent === null &&
    (recentScheduleIntent !== null ||
      mentionsSchedule ||
      (!mentionsMemo && (wantsSummary || keywords.length === 0 || !useMemos)));
  const answerMemo =
    useMemos &&
    recentScheduleIntent === null &&
    (recentMemoIntent !== null ||
      mentionsMemo ||
      // 「予定」と明示された質問はメモ側を答えない（予定のみ検索）
      (keywords.length > 0 && !explicitSchedule) ||
      wantsSummary ||
      !useSched);

  if (answerSchedule && reservations.length > 0) {
    // 直近予定意図 → キーワード/日付でなく作成日時順で返す
    let sec: { text: string; used: Reservation[] };
    if (recentScheduleIntent === 'latest') {
      sec = buildLatestSchedule(reservations);
    } else if (recentScheduleIntent === 'recent') {
      sec = buildRecentSchedules(reservations);
    } else {
      // 「今日やることをまとめて」のような要約では日付指定がなければ今日の予定を見る
      const effScope = scope ?? (wantsSummary ? 'today' : scope);
      // 内容キーワードがあれば（日付/要約以外）予定をそのキーワードで絞り込む
      const schedKeywords = !wantsSummary && keywords.length > 0 && !mentionsMemo ? keywords : [];
      sec = buildScheduleSection(reservations, effScope, schedKeywords);
    }
    parts.push(sec.text);
    scheduleCount = sec.used.length;
    usedSchedules = sec.used;
  } else if (answerSchedule) {
    parts.push('登録済みの予定が見つかりませんでした。');
  }

  if (answerMemo && memos.length > 0) {
    // 直近メモ意図 → キーワード検索せず作成日時順で返す
    const sec =
      recentMemoIntent === 'latest'
        ? buildLatestMemo(memos)
        : recentMemoIntent === 'recent'
          ? buildRecentMemos(memos)
          : buildMemoSection(memos, keywords);
    parts.push(sec.text);
    memoCount = sec.used.length;
    usedMemos = sec.used;
  } else if (answerMemo && useMemos) {
    parts.push('保存されたメモはまだありません。');
  }

  if (parts.length === 0) {
    // どのパートにも該当しない質問 → 参照対象の概況を答える
    if (useSched && reservations.length > 0) {
      const sec = buildScheduleSection(reservations, 'today', []);
      parts.push(sec.text);
      scheduleCount = sec.used.length;
      usedSchedules = sec.used;
    }
    if (useMemos && memos.length > 0) {
      const sec = buildMemoSection(memos, []);
      parts.push(sec.text);
      memoCount = sec.used.length;
      usedMemos = sec.used;
    }
  }

  return {
    answer: parts.join('\n\n'),
    memoCount,
    scheduleCount,
    scheduleIds: usedSchedules.map((r) => r.id),
    memoIds: usedMemos.map((m) => m.id),
  };
}
