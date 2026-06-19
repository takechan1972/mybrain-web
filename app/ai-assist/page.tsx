'use client';

import Link from 'next/link';
import NextImage from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import VoiceInput from '@/components/VoiceInput';
import {
  DEFAULT_AI_ASSIST_SETTINGS,
  loadAiAssistSettings,
  saveAiAssistSettings,
  type AiAssistSettings,
} from '@/lib/ai-assist-store';

export default function AiAssistPage() {
  const router = useRouter();
  const [s, setS] = useState<AiAssistSettings>(DEFAULT_AI_ASSIST_SETTINGS);
  const [ask, setAsk] = useState('');
  const [askHint, setAskHint] = useState<string | null>(null);

  useEffect(() => {
    setS(loadAiAssistSettings());
  }, []);

  function update(patch: Partial<AiAssistSettings>) {
    setS((prev) => {
      const next = { ...prev, ...patch };
      saveAiAssistSettings(next);
      return next;
    });
  }

  // 入力内容を /consult へ受け渡す。/consult は ?q= を読み取って入力欄へ反映する既存仕様を利用。
  function goConsult() {
    const q = ask.trim();
    if (q.length === 0) {
      setAskHint('AIに相談したい内容を入力してください。');
      return;
    }
    setAskHint(null);
    router.push(`/consult?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="relative min-h-[100svh] w-full overflow-x-hidden bg-[#050716]">
      {/* 宇宙背景（全ビューポート固定・端に白を出さない） */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen"
        style={{
          backgroundColor: '#050716',
          backgroundImage: "url('/haikei.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen"
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,7,22,0.25) 0%, rgba(5,7,22,0.50) 45%, rgba(5,7,22,0.92) 100%)',
        }}
      />

      <div className="relative z-10 flex flex-col gap-5 px-1 pb-4 pt-3">
        {/* 上部：公式ロゴ（透過版・メモ／予定画面と統一） */}
        <header className="relative mt-1 flex flex-col items-center pt-2">
          <NextImage
            src="/mybrain-original-logo-transparent.png"
            alt="MYBRAIN マイブレイン"
            width={556}
            height={508}
            className="h-auto object-contain"
            style={{ width: 'clamp(210px, 58vw, 300px)' }}
            priority
          />
          <p className="mt-1 text-[13px] font-bold tracking-[0.08em]" style={{ color: 'rgba(170,200,255,0.85)' }}>
            AIアシスト管理
          </p>
        </header>

        {/* ステータス ＋ ON/OFF */}
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full text-[20px]"
                style={{ background: s.enabled ? 'rgba(34,229,168,0.18)' : 'rgba(120,130,160,0.2)' }}>
                {s.enabled ? '⚡' : '💤'}
              </span>
              <div className="flex flex-col">
                <span className="text-[15px] font-bold text-white">AIアシスト</span>
                <span className="text-[12px]" style={{ color: s.enabled ? '#7DF5CC' : '#9AA4C0' }}>
                  {s.enabled ? '有効：あなたの情報をもとに支援します' : '無効：AI支援は停止中です'}
                </span>
              </div>
            </div>
            <Switch on={s.enabled} onColor="#22E5A8" onClick={() => update({ enabled: !s.enabled })} />
          </div>
        </Panel>

        {/* 参照コンテキスト */}
        <SectionTitle>AIが参照する情報</SectionTitle>
        <Panel>
          <ToggleRow
            icon="📝" label="メモ" desc="保存したメモを参照"
            on={s.useMemos} onColor="#22E5A8" disabled={!s.enabled}
            onClick={() => update({ useMemos: !s.useMemos })}
          />
          <Divider />
          <ToggleRow
            icon="📅" label="予定" desc="登録した予定を参照"
            on={s.useSchedules} onColor="#38BDF8" disabled={!s.enabled}
            onClick={() => update({ useSchedules: !s.useSchedules })}
          />
          <Divider />
          <ToggleRow
            icon="🕘" label="アシスト履歴" desc="過去のAIアシストを参照"
            on={s.useHistory} onColor="#A66BFF" disabled={!s.enabled}
            onClick={() => update({ useHistory: !s.useHistory })}
          />
        </Panel>

        {/* AIアシスト入力（/consult へ受け渡し） */}
        <SectionTitle>AIに相談する</SectionTitle>
        <div className="rounded-2xl border px-4 py-3.5"
          style={{ background: 'rgba(8,10,24,0.78)', borderColor: 'rgba(120,160,255,0.4)', boxShadow: '0 0 18px rgba(80,140,255,0.1) inset' }}>
          <textarea
            className="min-h-[120px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-white outline-none placeholder:text-[#7A86A8]"
            placeholder="AIに相談したいことを入力してください"
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-end border-t pt-2.5" style={{ borderColor: 'rgba(120,160,255,0.18)' }}>
            {/* AI相談入力の音声入力（既存 VoiceInput を流用。getInitial で末尾追記） */}
            <VoiceInput
              iconOnly
              micSrc="/mic-icon.jpg"
              onResult={(t) => setAsk(t)}
              getInitial={() => ask}
            />
          </div>
          {askHint && <p className="mt-1 text-[12px]" style={{ color: '#F2D58A' }}>{askHint}</p>}
          {/* AIのアシスト（メイン）｜ アシスト一覧 ｜ ホーム */}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={goConsult}
              className="flex h-[50px] flex-[1.6] items-center justify-center rounded-full px-1 text-[14px] font-extrabold text-white transition active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.1) inset, 0 6px 24px rgba(60,120,255,0.5)',
              }}>
              💬 AIのアシスト
            </button>
            <Link
              href="/history"
              className="flex h-[50px] flex-1 items-center justify-center rounded-full border border-white/20 bg-black/35 text-[13px] font-bold text-white backdrop-blur-md transition active:scale-95"
              style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.3), 0 0 14px rgba(80,160,255,0.15)' }}>
              アシスト一覧
            </Link>
            <Link
              href="/"
              className="flex h-[50px] flex-1 items-center justify-center rounded-full border border-white/20 bg-black/35 text-[13px] font-bold text-white backdrop-blur-md transition active:scale-95"
              style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.3), 0 0 14px rgba(80,160,255,0.15)' }}>
              ホーム
            </Link>
          </div>
        </div>

        {/* プライバシー注記 */}
        <div className="rounded-2xl border px-4 py-3.5"
          style={{ background: 'rgba(8,10,24,0.6)', borderColor: 'rgba(120,160,255,0.2)' }}>
          <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(180,200,235,0.7)' }}>
            🔒 AIが参照する情報は上のトグルでいつでも制御できます。データは端末内に保存され、
            AI処理はあなたの設定（ローカルAI等）に従います。参照をオフにした情報はAIに渡されません。
          </p>
        </div>

        {/* 下部ナビカード（メモ／予定／AI・メモ管理画面と同一デザイン） */}
        <div className="mt-2 grid grid-cols-3 gap-3">
          <NeonCard color="#22E5A8" title="メモ" icon={<NeonMemoIcon color="#22E5A8" />} href="/memos" />
          <NeonCard color="#38BDF8" title="予定" icon={<NeonCalendarIcon color="#38BDF8" />} href="/reservations" />
          <NeonCard color="#A66BFF" title="AI" icon={<NeonChatIcon color="#A66BFF" />} href="/ai-assist" active />
        </div>
      </div>
    </div>
  );
}

/* 小コンポーネント */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 text-[13px] font-bold" style={{ color: 'rgba(170,200,255,0.85)' }}>{children}</h2>;
}

function Panel({ children }: { children: React.ReactNode }) {
  // メモ／予定画面の入力カードと同じ配色（中立ブルーの枠）に統一
  return (
    <div className="rounded-2xl border px-4 py-3.5"
      style={{ background: 'rgba(10,14,32,0.7)', borderColor: 'rgba(120,160,255,0.4)', boxShadow: '0 0 18px rgba(80,140,255,0.12) inset' }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="my-2.5 h-px" style={{ background: 'rgba(120,160,255,0.15)' }} />;
}

function ToggleRow({
  icon, label, desc, on, onColor, disabled, onClick,
}: {
  icon: string; label: string; desc: string; on: boolean; onColor: string; disabled?: boolean; onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3" style={{ opacity: disabled ? 0.45 : 1 }}>
      <div className="flex items-center gap-3">
        <span className="text-[18px]">{icon}</span>
        <div className="flex flex-col">
          <span className="text-[14px] font-bold text-white">{label}</span>
          <span className="text-[11px]" style={{ color: 'rgba(200,215,245,0.6)' }}>{desc}</span>
        </div>
      </div>
      <Switch on={on} onColor={onColor} disabled={disabled} onClick={onClick} />
    </div>
  );
}

function Switch({
  on, onColor, disabled, onClick,
}: { on: boolean; onColor: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className="relative h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed"
      style={{ background: on ? onColor : 'rgba(120,160,255,0.25)' }}>
      <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all"
        style={{ left: on ? '22px' : '2px' }} />
    </button>
  );
}

/* ネオン機能カード（下段ナビ・メモ管理画面と同一） */
function NeonCard({
  color,
  title,
  icon,
  href,
  active = false,
}: {
  color: string;
  title: string;
  icon: React.ReactNode;
  href: string;
  active?: boolean;
}) {
  return (
    <Link href={href} className="block active:scale-95">
      <div
        className="relative flex h-full flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center"
        style={
          active
            ? {
                background: `linear-gradient(160deg, ${hexA(color, 0.28)} 0%, rgba(10,16,34,0.7) 72%)`,
                border: `1.5px solid ${hexA(color, 0.85)}`,
                boxShadow: `0 0 22px ${hexA(color, 0.4)}, 0 0 18px ${hexA(color, 0.22)} inset`,
              }
            : {
                background: 'linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(10,12,28,0.6) 70%)',
                border: '1px solid rgba(255,255,255,0.15)',
              }
        }>
        {active && (
          <span className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-px text-[8px] font-bold"
            style={{ background: hexA(color, 0.9), color: '#06121f' }}>
            現在
          </span>
        )}
        <span style={active ? undefined : { opacity: 0.85 }}>{icon}</span>
        <span className="text-[14px] font-bold" style={{ color: active ? color : 'rgba(255,255,255,0.82)' }}>{title}</span>
      </div>
    </Link>
  );
}

/** #RRGGBB + alpha → rgba() */
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function neonGlow(color: string) {
  return { filter: `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 12px ${hexA(color, 0.5)})` };
}

function NeonMemoIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={neonGlow(color)}>
      <rect x="9" y="5" width="24" height="32" rx="3.5" stroke={color} strokeWidth="2.2" />
      <line x1="14" y1="13" x2="27" y2="13" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="19" x2="27" y2="19" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="25" x2="22" y2="25" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M31 30 L41 20 L44 23 L34 33 Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function NeonCalendarIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={neonGlow(color)}>
      <rect x="6" y="9" width="36" height="31" rx="4" stroke={color} strokeWidth="2.2" />
      <line x1="6" y1="18" x2="42" y2="18" stroke={color} strokeWidth="2" />
      <line x1="16" y1="5" x2="16" y2="13" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="32" y1="5" x2="32" y2="13" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="15" cy="26" r="2.3" fill={color} /><circle cx="24" cy="26" r="2.3" fill={color} /><circle cx="33" cy="26" r="2.3" fill={color} />
      <circle cx="15" cy="33" r="2.3" fill={color} /><circle cx="24" cy="33" r="2.3" fill={color} />
    </svg>
  );
}

function NeonChatIcon({ color }: { color: string }) {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" style={neonGlow(color)}>
      <path d="M6 10 Q6 6 10 6 H38 Q42 6 42 10 V27 Q42 31 38 31 H15 L7 41 V31 Q6 31 6 27 Z" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="17" cy="19" r="2.6" fill={color} /><circle cx="24" cy="19" r="2.6" fill={color} /><circle cx="31" cy="19" r="2.6" fill={color} />
    </svg>
  );
}
