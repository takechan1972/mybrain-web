/**
 * 音声メモ用の仮処理。
 *
 * 今回は本物の録音・Whisper/OpenAI などの文字起こし/要約 API は使わない。
 * 将来、録音ファイルや文字起こし API に差し替えやすいよう、
 * 関数シグネチャを「入力 → 出力」の純関数として用意している。
 *
 *   mockTranscribeAudio()  : 録音 → 文字起こし の仮実装
 *   mockSummarizeText()    : 文字起こし → 要約 の仮実装
 */

// サンプルの文字起こし文（自動タグが付くようキーワードを含む）
const SAMPLE_TRANSCRIPTS: string[] = [
  '本日お客様より予約のお電話をいただきました。来週の打合せの日程調整と、先月分の売上の入金確認についてもご相談を受けました。次回までに資料を準備しておきます。',
  'スタッフ会議のメモです。新メニューのケーキのレシピを試作し、材料の仕入れ先を見直すことになりました。締切は今週末までです。',
  'お客様からクレームの連絡がありました。対応に不満があったとのことで、トラブルを避けるため改善案を検討します。',
];

/**
 * 録音音声を文字起こしする（仮実装）。
 * 将来は audioUri などを受け取り、文字起こし API を呼ぶ想定。
 */
export async function mockTranscribeAudio(): Promise<string> {
  const idx = Math.floor(Math.random() * SAMPLE_TRANSCRIPTS.length);
  return SAMPLE_TRANSCRIPTS[idx];
}

/**
 * 文字起こし結果を要約する（仮実装）。
 * 今は先頭 80〜100 文字程度を抜き出す簡易処理。
 * 将来は要約 API を呼ぶ想定。
 */
export function mockSummarizeText(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  const LIMIT = 90;
  if (trimmed.length <= LIMIT) return trimmed;
  return `${trimmed.slice(0, LIMIT)}…`;
}
