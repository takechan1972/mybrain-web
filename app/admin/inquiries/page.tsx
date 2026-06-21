'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listAllInquiriesForAdmin,
  type AdminInquiry,
} from '@/lib/contact';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';

// アクセスを許可する管理者メールアドレス（当面は許可リスト方式）。
const ADMIN_EMAILS = ['designat5take@gmail.com'];

// 日時(epoch ms) → "YYYY/MM/DD HH:mm"
function formatDateTime(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return '日時不明';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 対応状況のラベル配色（済/完了=緑、中=青、それ以外=アンバー）
function statusChipStyle(s: string): React.CSSProperties {
  if (/済|完了|クローズ/.test(s)) {
    return { background: 'rgba(34,229,168,0.16)', color: '#86efac', border: '1px solid rgba(34,229,168,0.4)' };
  }
  if (/中/.test(s)) {
    return { background: 'rgba(56,189,248,0.16)', color: '#7dd3fc', border: '1px solid rgba(56,189,248,0.4)' };
  }
  return { background: 'rgba(242,213,138,0.16)', color: '#f2d58a', border: '1px solid rgba(242,213,138,0.4)' };
}

function StatusChip({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold" style={statusChipStyle(label)}>
      {label}
    </span>
  );
}

const GLASS: React.CSSProperties = {
  background: 'rgba(12,16,38,0.6)',
  border: '1px solid rgba(120,160,255,0.25)',
  boxShadow: '0 0 18px rgba(99,102,241,0.10), 0 10px 28px rgba(0,0,0,0.35)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
};

type Access = 'checking' | 'denied' | 'granted';

export default function AdminInquiriesPage() {
  const configured = isSupabaseConfigured();
  const [access, setAccess] = useState<Access>('checking');
  const [adminEmail, setAdminEmail] = useState<string | null>(null);

  const [inquiries, setInquiries] = useState<AdminInquiry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminInquiry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listAllInquiriesForAdmin();
    setLoading(false);
    if (res.error) {
      setError(res.error);
      setInquiries([]);
      return;
    }
    setInquiries(res.inquiries);
  }, []);

  // アクセス判定（許可メールのみ）。許可されていれば一覧を取得。
  useEffect(() => {
    if (!configured) {
      setAccess('denied');
      return;
    }
    const sb = getSupabaseBrowserClient();
    sb?.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? null;
      setAdminEmail(email);
      if (email && ADMIN_EMAILS.includes(email.toLowerCase().trim())) {
        setAccess('granted');
        void load();
      } else {
        setAccess('denied');
      }
    });
  }, [configured, load]);

  return (
    // ルートレイアウトの max-w-md モバイルシェルから抜け出して全幅表示にするため fixed で全画面化。
    <div className="fixed inset-0 z-40 overflow-y-auto" style={{ backgroundColor: '#070b1c' }}>
      {/* 背景（控えめなグラデ・管理画面向け） */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(1200px 600px at 20% -10%, rgba(99,102,241,0.12), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(56,189,248,0.10), transparent 55%)',
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {/* ヘッダー */}
        <header className="mb-5 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[20px] font-bold sm:text-[24px]" style={{ color: '#ffffff', textShadow: '0 0 14px rgba(99,102,241,0.4)' }}>
              お問い合わせ管理
            </h1>
            <p className="mt-0.5 text-[12px] sm:text-[13px]" style={{ color: '#9fb0e0' }}>
              運営者用 ・ Supabase: contact_inquiries（確認専用）
            </p>
          </div>
          {access === 'granted' && (
            <div className="flex items-center gap-3">
              <span className="text-[12px]" style={{ color: '#9fb0e0' }}>
                {adminEmail} ・ <span style={{ color: '#c7d2fe', fontWeight: 700 }}>{inquiries.length}件</span>
              </span>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="min-h-[40px] rounded-full px-4 text-[13px] font-bold text-white transition active:scale-95 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 18px rgba(60,120,255,0.35)' }}>
                {loading ? '更新中…' : '再読み込み'}
              </button>
            </div>
          )}
        </header>

        {/* アクセス判定 */}
        {access === 'checking' ? (
          <Centered>
            <Spinner />
            <p className="text-[13px]" style={{ color: '#9fb0e0' }}>確認中…</p>
          </Centered>
        ) : access === 'denied' ? (
          <div className="rounded-3xl p-6 text-center sm:p-10" style={GLASS}>
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(224,85,85,0.16)' }}>
              🔒
            </span>
            <p className="text-[15px] font-bold" style={{ color: '#ffffff' }}>アクセス権限がありません</p>
            <p className="mt-1 text-[12px]" style={{ color: '#9fb0e0' }}>
              {configured
                ? 'この画面は運営者（許可されたアカウント）のみ利用できます。'
                : 'Supabase が未設定のため表示できません。'}
            </p>
          </div>
        ) : (
          // granted
          <>
            {loading ? (
              <Centered>
                <Spinner />
                <p className="text-[13px]" style={{ color: '#9fb0e0' }}>読み込み中…</p>
              </Centered>
            ) : error ? (
              <div className="rounded-3xl p-6 text-center sm:p-10" style={GLASS}>
                <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(224,85,85,0.16)' }}>
                  ⚠️
                </span>
                <p className="text-[15px] font-bold" style={{ color: '#ff9b9b' }}>取得に失敗しました</p>
                <p className="mt-1 text-[12px]" style={{ color: '#9fb0e0' }}>{error}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-4 min-h-[44px] rounded-full px-6 text-[13px] font-bold text-white active:scale-95"
                  style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 18px rgba(60,120,255,0.35)' }}>
                  再読み込み
                </button>
              </div>
            ) : inquiries.length === 0 ? (
              <div className="rounded-3xl p-10 text-center" style={GLASS}>
                <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(99,102,241,0.16)' }}>
                  📭
                </span>
                <p className="text-[15px] font-bold" style={{ color: '#ffffff' }}>お問い合わせはありません</p>
                <p className="mt-1 text-[12px]" style={{ color: '#9fb0e0' }}>ユーザーからの送信があると、ここに表示されます。</p>
              </div>
            ) : (
              <>
                {/* PC / iPad：テーブル表示 */}
                <div className="hidden overflow-hidden rounded-2xl md:block" style={GLASS}>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] border-collapse text-left">
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(120,160,255,0.2)' }}>
                          {['作成日時', 'ユーザー名', 'メール', '項目', '内容', '画像', 'status', 'reply'].map((h) => (
                            <th key={h} className="px-3 py-3 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {inquiries.map((q) => (
                          <tr
                            key={q.id}
                            onClick={() => setSelected(q)}
                            className="cursor-pointer transition hover:bg-white/[0.04]"
                            style={{ borderBottom: '1px solid rgba(120,160,255,0.10)' }}>
                            <td className="whitespace-nowrap px-3 py-3 text-[12px]" style={{ color: '#c7d2fe' }}>{formatDateTime(q.createdAt)}</td>
                            <td className="px-3 py-3 text-[13px] font-semibold" style={{ color: '#ffffff' }}>{q.userName || '—'}</td>
                            <td className="px-3 py-3 text-[12px]" style={{ color: '#9fb0e0' }}>{q.userEmail || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-[12px]" style={{ color: '#d8b4fe' }}>{q.category || '未分類'}</td>
                            <td className="max-w-[280px] px-3 py-3 text-[12px]" style={{ color: '#dbe4ff' }}>
                              <span className="line-clamp-1">{q.message}</span>
                            </td>
                            <td className="max-w-[140px] px-3 py-3 text-[12px]" style={{ color: q.imageFilename ? '#bae6fd' : '#7a86b8' }}>
                              <span className="line-clamp-1">{q.imageFilename || 'なし'}</span>
                            </td>
                            <td className="px-3 py-3"><StatusChip label={q.status} /></td>
                            <td className="px-3 py-3"><StatusChip label={q.replyStatus} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* スマホ：カード表示 */}
                <div className="flex flex-col gap-3 md:hidden">
                  {inquiries.map((q) => (
                    <button key={q.id} type="button" onClick={() => setSelected(q)} className="w-full text-left active:opacity-70">
                      <div className="rounded-2xl p-4" style={GLASS}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px]" style={{ color: '#9fb0e0' }}>{formatDateTime(q.createdAt)}</span>
                          <div className="flex gap-1.5">
                            <StatusChip label={q.status} />
                            <StatusChip label={q.replyStatus} />
                          </div>
                        </div>
                        <p className="mt-1.5 text-[14px] font-bold text-white">{q.userName || '—'}</p>
                        <p className="text-[12px]" style={{ color: '#9fb0e0' }}>{q.userEmail || '—'}</p>
                        <span
                          className="mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                          style={{ background: 'rgba(166,107,255,0.18)', color: '#d8b4fe', border: '1px solid rgba(166,107,255,0.4)' }}>
                          {q.category || '未分類'}
                        </span>
                        <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed" style={{ color: '#dbe4ff' }}>{q.message}</p>
                        {q.imageFilename && (
                          <p className="mt-1 text-[11px]" style={{ color: '#bae6fd' }}>🖼 {q.imageFilename}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* 詳細モーダル */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-black/55" onClick={() => setSelected(null)} />
          <div
            className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl"
            style={{ ...GLASS, background: 'rgba(14,18,40,0.98)' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(120,160,255,0.18)' }}>
              <h2 className="text-[16px] font-bold" style={{ color: '#ffffff' }}>お問い合わせ詳細</h2>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setSelected(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full active:opacity-60"
                style={{ color: '#c7d2fe' }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <DetailField label="作成日時" value={formatDateTime(selected.createdAt)} />
                <DetailField label="お問い合わせ項目" value={selected.category || '未分類'} />
                <DetailField label="ユーザー名" value={selected.userName || '—'} />
                <DetailField label="メールアドレス" value={selected.userEmail || '—'} />
                <DetailField label="添付画像ファイル名" value={selected.imageFilename || 'なし'} muted={!selected.imageFilename} />
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-bold" style={{ color: '#9fb0e0' }}>status</span>
                  <StatusChip label={selected.status} />
                  <span className="ml-2 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>reply</span>
                  <StatusChip label={selected.replyStatus} />
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>お問い合わせ内容</p>
                <div
                  className="whitespace-pre-line rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
                  style={{ background: 'rgba(10,14,32,0.6)', border: '1px solid rgba(120,160,255,0.18)', color: '#e6edff' }}>
                  {selected.message}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>運営からの返信</p>
                {selected.adminReply ? (
                  <div
                    className="whitespace-pre-line rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
                    style={{ background: 'rgba(34,229,168,0.10)', border: '1px solid rgba(34,229,168,0.35)', color: '#d7ffe9' }}>
                    {selected.adminReply}
                  </div>
                ) : (
                  <p className="rounded-2xl px-4 py-3 text-[13px]" style={{ background: 'rgba(10,14,32,0.6)', border: '1px dashed rgba(120,160,255,0.3)', color: '#9fb0e0' }}>
                    まだ返信はありません（返信機能は今後実装予定）
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-3 py-16 text-center">{children}</div>;
}

function Spinner() {
  return (
    <span
      className="h-8 w-8 animate-spin rounded-full"
      style={{ border: '3px solid rgba(120,160,255,0.25)', borderTopColor: '#7B5FFF' }}
    />
  );
}

function DetailField({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-bold" style={{ color: '#9fb0e0' }}>{label}</span>
      <span className="break-words text-[13px] font-semibold" style={{ color: muted ? '#7a86b8' : '#e6edff' }}>{value}</span>
    </div>
  );
}
