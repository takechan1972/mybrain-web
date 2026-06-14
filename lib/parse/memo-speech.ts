/**
 * メモ音声入力のテキスト解析。
 * 「タイトルは〇〇、本文は〇〇」だけでなく、音声認識で「は」が抜けた
 * 「タイトル 〇〇 本文 〇〇」のような区切りにも対応する。
 * 完璧でなくてよい（失敗しても手入力で修正できる前提）。
 */

// 「は/：」付き（境界不要・どこでもマッチ）。長いものを先に。
// 音声認識のひらがな表記ゆれ（たいとるは / ないようは / ほんぶんは / だいめいは）にも対応。
// 注：「メモ内容は」等の“メモ”複合は使わない。「仕込みメモ内容は」を「仕込みメモ」+「内容は」と
// 正しく分けるため、内側の「内容は」「タイトルは」でマッチさせる。
const TITLE_IS = ['タイトルは', '題名は', 'たいとるは', 'だいめいは'];
const BODY_IS = ['本文は', '内容は', 'ないようは', 'ほんぶんは'];
// 素のキーワード（直後が区切り文字＝スペース/句読点 のときのみ採用）。長いものを先に。
const TITLE_BARE = ['タイトル', '題名', 'たいとる', 'だいめい'];
const BODY_BARE = ['本文', '内容', 'ないよう', 'ほんぶん'];

const SEP_RE = /[\s、。，．：:]/u;

/** 全角スペース・連続空白・改行を半角1スペースに正規化 */
function normalize(text: string): string {
  return text.replace(/[　\t\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface MarkerLoc {
  kwStart: number;
  valueStart: number;
}

function findMarker(text: string, isVariants: string[], bareVariants: string[]): MarkerLoc | null {
  // 1) 「は/：」付きを優先（境界不要）
  for (const kw of isVariants) {
    const i = text.indexOf(kw);
    if (i >= 0) return { kwStart: i, valueStart: i + kw.length };
  }
  // 2) 素のキーワード（直後が区切り文字 or 末尾のときのみ）
  let best: MarkerLoc | null = null;
  for (const kw of bareVariants) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(kw, from);
      if (i < 0) break;
      const next = text[i + kw.length];
      if (next === undefined || SEP_RE.test(next)) {
        if (!best || i < best.kwStart) best = { kwStart: i, valueStart: i + kw.length };
        break;
      }
      from = i + kw.length;
    }
  }
  return best;
}

/** 先頭の助詞「は」・区切り記号、末尾の句読点/空白を除去 */
function clean(s: string): string {
  let t = s.trim();
  t = t.replace(/^[、。，．：:\-－—\s]+/u, '');
  t = t.replace(/^は[\s、]?/u, ''); // 先頭に残った助詞「は」
  t = t.replace(/^[、。，．：:\-－—\s]+/u, '');
  t = t.replace(/[、。，．\s]+$/u, '');
  return t.trim();
}

/** 本文先頭20〜30文字からタイトルを自動生成 */
export function deriveTitleFromBody(body: string): string {
  const firstLine = body.trim().split('\n')[0]?.trim() ?? '';
  const base = firstLine.length > 0 ? firstLine : body.trim();
  return base.slice(0, 30).trim();
}

export interface ParsedMemoSpeech {
  /** 明示タイトル（「タイトル」系がある場合のみ。無ければ undefined） */
  title?: string;
  /** 本文（マーカーが無ければ全文） */
  body: string;
  /** 「タイトルは」等のタイトルマーカーが検出されたか */
  hasTitleMarker: boolean;
  /** 「内容は」「本文は」等の本文マーカーが検出されたか */
  hasBodyMarker: boolean;
}

/**
 * 音声テキストを title / body に分離する。
 * - タイトル系キーワードの後ろ〜本文系キーワードの前（または句点）を title に
 * - 本文系キーワードの後ろを body に
 * - どちらも無ければ body = 全文（title は undefined）
 */
export function parseMemoSpeechText(text: string): ParsedMemoSpeech {
  const src = normalize(text);
  if (src.length === 0) return { body: '', hasTitleMarker: false, hasBodyMarker: false };

  const titleLoc = findMarker(src, TITLE_IS, TITLE_BARE);
  const bodyLoc = findMarker(src, BODY_IS, BODY_BARE);

  let title: string | undefined;
  let body = src;

  if (titleLoc) {
    const start = titleLoc.valueStart;
    const rest = src.slice(start);
    const sepIdx = rest.search(/[。．.！？!?]/u);
    const candidates: number[] = [];
    if (bodyLoc && bodyLoc.kwStart > start) candidates.push(bodyLoc.kwStart - start);
    if (sepIdx >= 0) candidates.push(sepIdx);
    const end = candidates.length > 0 ? Math.min(...candidates) : -1;
    const seg = end === -1 ? rest : rest.slice(0, end);
    title = clean(seg);
  }

  if (bodyLoc) {
    body = clean(src.slice(bodyLoc.valueStart));
  } else if (titleLoc) {
    // タイトルのみ指定 → 本文は空（おすすめ仕様）
    body = '';
  }

  if (!titleLoc && !bodyLoc) body = src;
  if (title !== undefined && title.length === 0) title = undefined;

  return { title, body, hasTitleMarker: titleLoc !== null, hasBodyMarker: bodyLoc !== null };
}
