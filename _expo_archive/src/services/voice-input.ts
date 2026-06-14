/**
 * 音声入力の共通ヘルパー。
 *
 * 音声認識そのものは services/ai-providers.ts の
 * startWebSpeechRecognition / isWebSpeechSupported を利用する。
 * ここでは「話した内容をタイトルと本文に分ける」簡易ルールのみを提供する。
 *
 * - AI API は使わない（mock/簡易AI状態でも動作）
 * - 音声本文を console に出力しない／秘密情報を扱わない
 */

// 先頭・末尾の空白や区切り記号を除去
function clean(s: string): string {
  return (s ?? '')
    .replace(/^[\s　。．.、，,：:〜~ー\-]+/, '')
    .replace(/[\s　]+$/, '')
    .trim();
}

// 本文から仮タイトルを作る（先頭20文字程度）
function autoTitleFromBody(body: string): string {
  const b = clean(body);
  if (b.length === 0) return '';
  return b.length <= 20 ? b : `${b.slice(0, 20)}…`;
}

// タイトルが空なら本文から補完して返す
function finalize(title: string, body: string, fallbackText: string): { title: string; body: string } {
  const t = clean(title);
  const b = clean(body);
  if (t.length > 0) return { title: t, body: b };
  // タイトルが空：本文（無ければ全文）の先頭から仮タイトルを生成
  const base = b.length > 0 ? b : clean(fallbackText);
  return { title: autoTitleFromBody(base), body: b.length > 0 ? b : base };
}

/**
 * 音声テキストをタイトルと本文に分割する（簡易ルール）。
 *  1. 「タイトル〜本文〜」というキーワードがあれば、それを区切りに使う
 *  2. なければ最初の句読点・短い一文をタイトル候補にする
 *  3. うまく分けられない場合は本文へ全文を入れ、タイトルは自動生成する
 */
export function splitTitleBody(raw: string): { title: string; body: string } {
  const text = clean(raw);
  if (text.length === 0) return { title: '', body: '' };

  // 1) 「タイトル … 本文 …」
  const kw = text.match(/タイトル[\s　:：]*([\s\S]+?)[\s　]*本文[\s　:：]*([\s\S]+)/);
  if (kw) {
    return finalize(kw[1], kw[2], text);
  }
  // 「タイトル …」のみ（本文キーワードなし）
  const kwTitleOnly = text.match(/^タイトル[\s　:：]*([\s\S]+)/);
  if (kwTitleOnly) {
    return finalize(kwTitleOnly[1], '', text);
  }

  // 2) 最初の句点・読点（25文字以内）でタイトルと本文に分ける
  const m = text.match(/^([\s\S]{1,25}?)[。．.、，,]\s*([\s\S]+)/);
  if (m && clean(m[1]).length > 0 && clean(m[2]).length > 0) {
    return finalize(m[1], m[2], text);
  }

  // 2b) 句読点が無く空白区切りの場合：先頭の短い語をタイトル、残りを本文
  const sp = text.match(/^([^\s　]{1,15})[\s　]+([\s\S]+)/);
  if (sp && clean(sp[2]).length > 0) {
    return finalize(sp[1], sp[2], text);
  }

  // 3) 区切りなし：短ければ全部タイトル、長ければ本文＋自動タイトル
  if (text.length <= 20) {
    return { title: text, body: '' };
  }
  return finalize('', text, text);
}
