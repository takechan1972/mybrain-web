/**
 * 自然文からの日時・タイトル抽出（Expo版ロジックを移植・Web用に簡略化）。
 * 完璧でなくてよい。失敗時は手入力修正できる前提。
 */

const WEEKDAY: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

/**
 * 音声認識テキストの表記ゆれを正規化する。
 * モバイル（特に iOS）の音声入力は全角数字「１５時」や数字とマーカーの間に空白
 * 「15 時」「6 月 20 日」を挿入することがあり、そのままだと時刻・日付を抽出できず
 * 全文がタイトルに入ってしまう。半角化＋不要な空白除去で堅牢にする。
 */
export function normalizeForParse(text: string): string {
  let t = text
    // 全角数字 → 半角
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // 全角コロン・全角スペース → 半角
    .replace(/：/g, ':')
    .replace(/　/g, ' ');
  // 数字・時刻/日付マーカーの間に入った空白を詰める（"15 時"→"15時"、"6 月 20 日"→"6月20日"）
  t = t
    .replace(/(\d)\s+(?=\d)/g, '$1')
    .replace(/(\d)\s+(?=[時分秒月日年:])/g, '$1')
    .replace(/([時分秒月日年:])\s+(?=\d)/g, '$1');
  return t;
}

interface YMD {
  y: number;
  m: number;
  d: number;
}

function parseDate(seg: string, now: Date): YMD | null {
  // ひらがな表記（音声認識が「あした」「きょう」等で返す場合）にも対応
  if (seg.includes('明後日') || seg.includes('あさって')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  if (seg.includes('明日') || seg.includes('あした') || seg.includes('あす')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  if (seg.includes('今日') || seg.includes('本日') || seg.includes('きょう') || seg.includes('ほんじつ')) {
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  }
  const md = seg.match(/(\d{1,2})月(\d{1,2})日/);
  if (md) {
    const m = Number(md[1]);
    const d = Number(md[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y: now.getFullYear(), m, d };
  }
  const wd = seg.match(/(来週|今週|再来週)?\s*([日月火水木金土])曜/);
  if (wd) {
    const target = WEEKDAY[wd[2]];
    const d = new Date(now);
    let diff = (target - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    if (wd[1] === '来週') diff += 7;
    if (wd[1] === '再来週') diff += 14;
    d.setDate(d.getDate() + diff);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  if (seg.includes('来週')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  return null;
}

function parseTime(seg: string): { hour: number; minute: number } | null {
  const apply = (hStr: string, mStr: string | undefined, pm: boolean) => {
    let h = Number(hStr);
    if (pm && h < 12) h += 12;
    const m = mStr ? Number(mStr) : 0;
    return { hour: h, minute: m };
  };
  // HH:mm
  const hhmm = seg.match(/(午前|午後)?\s*(\d{1,2}):(\d{2})/);
  if (hhmm) return apply(hhmm[2], hhmm[3], hhmm[1] === '午後');
  // H時(半|M分)?
  const single = seg.match(/(午前|午後)?\s*(\d{1,2})時(半|(\d{1,2})分)?/);
  if (single) {
    const min = single[3] === '半' ? '30' : single[4];
    return apply(single[2], min, single[1] === '午後');
  }
  return null;
}

// 内容ラベル（漢字＋音声認識のひらがな表記ゆれ）。長い表記を先に並べる。
const CONTENT_LABEL_RE = /内容は|内容|本文は|本文|詳細は|詳細|メモは|メモ|ないようは|ないよう|ほんぶんは|ほんぶん|しょうさいは|しょうさい|めもは/;
// 日付・時刻のノイズ表現（タイトルに残ってはいけない語）
const DATE_NOISE_RE = /明後日|明日|今日|本日|来週|今週|再来週|あさって|あした|あす|きょう|ほんじつ|らいしゅう|こんしゅう/g;
const TIME_NOISE_RE = /(午前|午後)?\s*\d{1,2}\s*時(半|\s*\d{1,2}\s*分)?|(午前|午後)?\s*\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日/g;

/** 日時表現・指示語（「タイトル」「予定」など）・内容ラベル・前後助詞を除去してタイトルを作る */
export function extractScheduleTitle(text: string): string {
  const cleaned = normalizeForParse(text)
    .trim()
    .replace(/(来週|今週|再来週|らいしゅう|こんしゅう)?\s*[日月火水木金土]曜日?/g, '')
    .replace(DATE_NOISE_RE, '')
    .replace(TIME_NOISE_RE, '')
    // 内容ラベル以降が混ざっていても語自体は除去する（保険）
    .replace(CONTENT_LABEL_RE, '')
    // 音声でよく混ざる指示語（タイトル・予定・日時 など）は除去する
    .replace(/タイトルは|タイトル|予定は|予定を|予定|日時は|日時/g, '')
    .replace(/(に|から|まで)/g, '')
    .replace(/^[のへとをはが、,。．\s　]+/u, '')
    // 末尾に残る助詞（「お米 の」→「お米」）も除去する
    .replace(/[のへとをはがにから、,。．\s　]+$/u, '')
    .replace(/[\s　]+/g, ' ')
    .trim();
  return cleaned;
}

/**
 * タイトルに日時・内容ラベルなどの「予定ノイズ」が残っているか判定する。
 * 残っている＝抽出が不完全 or 生テキストの混入。UI/保存前のガードに使う。
 */
export function containsScheduleNoise(text: string): boolean {
  const t = normalizeForParse(text);
  // /g 正規表現は .test() が lastIndex を進めて状態を持つため、毎回リセットしてから判定する
  DATE_NOISE_RE.lastIndex = 0;
  TIME_NOISE_RE.lastIndex = 0;
  return (
    DATE_NOISE_RE.test(t) ||
    TIME_NOISE_RE.test(t) ||
    CONTENT_LABEL_RE.test(t) ||
    /[日月火水木金土]曜/.test(t)
  );
}

/** 内容ラベル（「内容」「メモ」「詳細」「本文」＋ひらがな表記）でタイトル部と詳細部に分割する */
function splitContentLabel(text: string): { head: string; details: string } {
  const m = text.match(CONTENT_LABEL_RE);
  if (!m || m.index === undefined) return { head: text, details: '' };
  return {
    head: text.slice(0, m.index),
    details: text.slice(m.index + m[0].length),
  };
}

/** 詳細メモの前後の助詞・空白・記号を整える */
function cleanDetails(text: string): string {
  return text
    .replace(/^[\s　はの、,。．]+/u, '')
    .replace(/[\s　、,。．]+$/u, '')
    .replace(/[\s　]+/g, ' ')
    .trim();
}

export interface ParsedSchedule {
  title: string;
  scheduleAt: number | null;
  content: string;
}

/**
 * 文（例「明日の15時に歯医者 内容 保険証を持っていく」）から
 * タイトル / 予定日時(ms) / 内容 を抽出。
 * - 「内容」「メモ」「詳細」ラベルがあれば、その前後でタイトルと詳細を分割する。
 * - 日時はラベル前（タイトル部）から解析。取れない場合は scheduleAt=null（手入力で設定可）。
 */
export function parseScheduleFromText(text: string): ParsedSchedule {
  // 音声入力の表記ゆれ（全角数字・余分な空白）を先に正規化
  const src = normalizeForParse(text).trim();
  const now = new Date();

  // 「内容」「メモ」「詳細」でタイトル部（head）と詳細部（details）に分割
  const { head, details } = splitContentLabel(src);

  // 日時はタイトル部から解析（詳細メモ内の数字を誤認識しないため）
  const ymd = parseDate(head, now);
  const time = parseTime(head);

  let scheduleAt: number | null = null;
  if (ymd && time) {
    scheduleAt = new Date(ymd.y, ymd.m - 1, ymd.d, time.hour, time.minute).getTime();
  } else if (time) {
    scheduleAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.hour, time.minute).getTime();
  } else if (ymd) {
    scheduleAt = new Date(ymd.y, ymd.m - 1, ymd.d, 0, 0).getTime();
  }

  // タイトルは head 優先、無ければ全体から抽出。
  // ノイズ（日時・内容ラベル）が残る生テキストは絶対にタイトルにしない（空のまま返す）。
  let title = extractScheduleTitle(head) || extractScheduleTitle(src);
  if (containsScheduleNoise(title)) title = '';
  const content = cleanDetails(details);
  return { title, scheduleAt, content };
}
