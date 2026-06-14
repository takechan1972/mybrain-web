import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ローカルの Python（faster-whisper）を呼ぶため Node ランタイムで実行
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 文字起こしは時間がかかるため最大実行時間を延長
export const maxDuration = 300;

// PCローカル環境の固定パス（要件で指定）
const PYTHON_EXE = 'C:\\Users\\owner\\Desktop\\whisper_local\\.venv\\Scripts\\python.exe';
const WHISPER_DIR = 'C:\\Users\\owner\\Desktop\\whisper_local';
const SCRIPT = 'transcribe_mybrain.py';

const ALLOWED_EXT = ['m4a', 'mp3', 'wav'];

interface WhisperResult {
  ok: boolean;
  text?: string;
  language?: string;
  error?: string;
}

/** Python を実行して JSON 結果を得る */
function runPython(audioPath: string, model: string): Promise<WhisperResult> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_EXE, [SCRIPT, audioPath, model, 'ja'], {
      cwd: WHISPER_DIR,
      windowsHide: true,
      env: {
        ...process.env,
        // Python の入出力を UTF-8 に固定（日本語の文字化け防止）
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    // 受信バッファは UTF-8 として明示的に文字列化する
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });

    proc.on('error', (err) => {
      // python.exe が見つからない等
      resolve({ ok: false, error: `spawn failed: ${err.message}` });
    });
    proc.on('close', () => {
      // stdout の最後の JSON 行を採用（ログが混ざっても拾えるように）
      const line = stdout.trim().split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop();
      if (!line) {
        resolve({ ok: false, error: stderr.trim() || 'no output from whisper' });
        return;
      }
      try {
        resolve(JSON.parse(line) as WhisperResult);
      } catch {
        resolve({ ok: false, error: 'invalid JSON from whisper' });
      }
    });
  });
}

export async function POST(request: Request) {
  const failMsg = 'Whisperが利用できません。Python環境とffmpegを確認してください';
  let tmpPath: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get('file');
    const model = (form.get('model') as string) || 'small';

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: '音声ファイルがありません。' }, { status: 400 });
    }

    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json(
        { ok: false, error: '対応形式は m4a / mp3 / wav です。' },
        { status: 400 },
      );
    }

    // 一時ファイルに保存
    const dir = join(tmpdir(), 'mybrain-whisper');
    await mkdir(dir, { recursive: true });
    tmpPath = join(dir, `${randomUUID()}.${ext}`);
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(tmpPath, buf);

    const result = await runPython(tmpPath, model);

    if (!result.ok) {
      console.error('[whisper] failed:', result.error);
      return NextResponse.json({ ok: false, error: failMsg }, { status: 200 });
    }
    return NextResponse.json({ ok: true, text: result.text ?? '' });
  } catch (e) {
    console.error('[whisper] route error:', e);
    return NextResponse.json({ ok: false, error: failMsg }, { status: 200 });
  } finally {
    if (tmpPath) {
      void unlink(tmpPath).catch(() => { /* 後始末失敗は無視 */ });
    }
  }
}
