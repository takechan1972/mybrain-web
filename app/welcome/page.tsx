import Link from 'next/link';

const NAVY = '#1B2F5B';

/** MYBRAIN ランディング（一番最初の画面） */
export default function WelcomePage() {
  return (
    <div className="flex min-h-[88vh] flex-col">
      {/* 中央：ロゴ＋コピー */}
      <div className="flex flex-1 flex-col items-center justify-center px-2 text-center">
        {/* ブレインロゴ（画像ファイルをそのまま表示・縦横比維持・中央） */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mybrain-logo.svg"
          alt="MYBRAIN ロゴ"
          width={184}
          height={153}
          className="mx-auto block h-auto w-[184px] object-contain"
          style={{ overflow: 'visible' }}
        />

        <h1 className="mt-4 text-4xl font-extrabold tracking-[0.2em]" style={{ color: NAVY }}>
          MYBRAIN
        </h1>
        <p className="mt-2 text-sm tracking-[0.4em] text-gray-400">マイブレイン</p>

        <h2 className="mt-8 text-xl font-bold leading-relaxed" style={{ color: NAVY }}>
          すべての知識を、
          <br />
          あなたの脳のように整理する。
        </h2>

        <p className="mt-5 text-sm leading-relaxed text-gray-500">
          アイデア、メモ、情報をひとつにまとめて、
          <br />
          必要なときにすぐ見つけられる。
          <br />
          あなた専用の第二の脳をつくりましょう。
        </p>
      </div>

      {/* 下部：ボタン（ログイン前提のため2つのみ） */}
      <div className="flex flex-col gap-4 pb-6">
        <Link
          href="/login?mode=signup"
          className="rounded-2xl py-4 text-center text-base font-bold text-white"
          style={{ backgroundColor: NAVY }}>
          無料ではじめる
        </Link>
        <Link
          href="/login"
          className="rounded-2xl border-2 py-4 text-center text-base font-bold"
          style={{ borderColor: NAVY, color: NAVY }}>
          ログイン
        </Link>
      </div>
    </div>
  );
}

