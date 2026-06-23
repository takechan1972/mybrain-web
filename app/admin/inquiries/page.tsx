'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  generateInquiryReplyDraft,
  listAllInquiriesForAdmin,
  saveAdminReply,
  saveAiDraftReply,
  type AdminInquiry,
} from '@/lib/contact';
import {
  findSimilarQa,
  generateInquiryQaDraft,
  getQaForInquiry,
  listKnowledge,
  saveQaFromInquiry,
  setKnowledgePublic,
  type QaRecord,
} from '@/lib/knowledge';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';

// アクセスを許可する管理者メールアドレス（当面は許可リスト方式）。
const ADMIN_EMAILS = ['designat5take@gmail.com'];

// 左メニュー。今回は inquiries のみ実装済み、他は「準備中」。
type MenuKey = 'home' | 'inquiries' | 'users' | 'plans' | 'plugins' | 'faq' | 'usage';
const MENU: { key: MenuKey; label: string; icon: string; ready?: boolean }[] = [
  { key: 'home', label: '管理画面ホーム', icon: '🏠' },
  { key: 'inquiries', label: 'お問い合わせ管理', icon: '✉️', ready: true },
  { key: 'users', label: '登録者管理', icon: '👥' },
  { key: 'plans', label: 'プラン管理', icon: '🎫' },
  { key: 'plugins', label: 'プラグイン管理', icon: '🧩' },
  { key: 'faq', label: 'チャットボットFAQ管理', icon: '🤖', ready: true },
  { key: 'usage', label: '利用状況', icon: '📊' },
];

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
  const [activeMenu, setActiveMenu] = useState<MenuKey>('inquiries');

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

  function selectMenu(key: MenuKey) {
    setActiveMenu(key);
    setSelected(null);
  }

  // 返信保存後：一覧と選択中の詳細を更新（即時にUIへ反映）
  function handleReplied(updated: AdminInquiry) {
    setInquiries((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
    setSelected(updated);
  }

  return (
    // ルートレイアウトの max-w-md モバイルシェルから抜け出して全幅表示にするため fixed で全画面化。
    // overflow-x-hidden で画面全体の横スクロールは出さない（横スクロールはテーブル内のみ）。
    <div className="fixed inset-0 z-40 overflow-y-auto overflow-x-hidden" style={{ backgroundColor: '#070b1c' }}>
      {/* テーブル横スクロールバーを細く・デザインに馴染む暗色にする */}
      <style>{`
        .admin-scroll { scrollbar-width: thin; scrollbar-color: rgba(120,160,255,0.35) transparent; }
        .admin-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .admin-scroll::-webkit-scrollbar-track { background: transparent; }
        .admin-scroll::-webkit-scrollbar-thumb { background: rgba(120,160,255,0.32); border-radius: 9999px; }
        .admin-scroll::-webkit-scrollbar-thumb:hover { background: rgba(120,160,255,0.5); }
      `}</style>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(1200px 600px at 18% -10%, rgba(99,102,241,0.12), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(56,189,248,0.10), transparent 55%)',
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-[1400px] px-3 py-5 sm:px-4 sm:py-7">
        {/* ヘッダー */}
        <header className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[20px] font-bold sm:text-[24px]" style={{ color: '#ffffff', textShadow: '0 0 14px rgba(99,102,241,0.4)' }}>
              MyBrain 管理コンソール
            </h1>
            <p className="mt-0.5 text-[12px] sm:text-[13px]" style={{ color: '#9fb0e0' }}>
              運営者用 ・ 確認専用
            </p>
          </div>
          {access === 'granted' && adminEmail && (
            <span className="text-[12px]" style={{ color: '#9fb0e0' }}>
              ログイン中：<span style={{ color: '#c7d2fe', fontWeight: 700 }}>{adminEmail}</span>
            </span>
          )}
        </header>

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
            <Link href="/settings" className="mt-4 inline-block text-[13px] font-bold" style={{ color: '#9cc4ff' }}>
              ← 設定へ戻る
            </Link>
          </div>
        ) : (
          // granted：3カラム（PC/iPad）／縦並び（スマホ）
          <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[240px_minmax(0,1fr)_280px] lg:items-start lg:gap-5">
            {/* 左カラム：管理メニュー（PCでは固定風サイドバー） */}
            <aside className="rounded-2xl p-2.5 lg:sticky lg:top-6" style={GLASS}>
              <p className="px-2.5 py-1.5 text-[11px] font-bold tracking-wide" style={{ color: '#7a86b8' }}>
                管理メニュー
              </p>
              <nav className="flex flex-col gap-1">
                {MENU.map((m) => {
                  const active = activeMenu === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => selectMenu(m.key)}
                      className="flex items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-[13px] font-semibold transition active:scale-[0.98]"
                      style={
                        active
                          ? {
                              background: 'linear-gradient(135deg, rgba(46,126,255,0.30), rgba(123,95,255,0.30))',
                              color: '#ffffff',
                              border: '1px solid rgba(130,165,255,0.6)',
                              boxShadow: '0 0 14px rgba(99,102,241,0.35)',
                            }
                          : { color: '#c7d2fe', border: '1px solid transparent' }
                      }>
                      <span className="shrink-0 text-[15px]">{m.icon}</span>
                      <span className="flex-1 whitespace-nowrap">{m.label}</span>
                      {m.ready && (
                        <span className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold" style={{ background: 'rgba(34,229,168,0.2)', color: '#86efac' }}>
                          実装済
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
              <div className="my-2 h-px" style={{ background: 'rgba(120,160,255,0.15)' }} />
              <Link
                href="/settings"
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition active:scale-[0.98]"
                style={{ color: '#9fb0e0' }}>
                <span className="text-[15px]">↩️</span>
                設定へ戻る
              </Link>
            </aside>

            {/* 中央カラム：選択中の管理内容 */}
            <section className="min-w-0">
              {activeMenu === 'inquiries' ? (
                <InquiriesPanel
                  inquiries={inquiries}
                  loading={loading}
                  error={error}
                  selected={selected}
                  onSelect={setSelected}
                  onReload={() => void load()}
                  onReplied={handleReplied}
                />
              ) : activeMenu === 'faq' ? (
                <FaqPanel />
              ) : (
                <SoonPanel label={MENU.find((m) => m.key === activeMenu)?.label ?? ''} />
              )}
            </section>

            {/* 右カラム：AIアシスト（入力欄＋送信のみ・本接続は未実装） */}
            <aside className="lg:sticky lg:top-6">
              <AiAssistPanel selected={selected} />
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 中央：お問い合わせ管理（一覧／詳細） ──────────────────────────
function InquiriesPanel({
  inquiries,
  loading,
  error,
  selected,
  onSelect,
  onReload,
  onReplied,
}: {
  inquiries: AdminInquiry[];
  loading: boolean;
  error: string | null;
  selected: AdminInquiry | null;
  onSelect: (q: AdminInquiry | null) => void;
  onReload: () => void;
  onReplied: (updated: AdminInquiry) => void;
}) {
  // 未対応を先頭に、各グループ内は新しい順（表示だけの並べ替え。取得順・データは変更しない）。
  const pendingRank = (s: string) => (/済|完了|クローズ/.test(s) ? 1 : 0); // 未対応=0（先頭） / 対応済み=1
  const sortedInquiries = [...inquiries].sort(
    (a, b) => pendingRank(a.status) - pendingRank(b.status) || b.createdAt - a.createdAt,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[17px] font-bold" style={{ color: '#ffffff' }}>お問い合わせ管理</h2>
          <p className="text-[12px]" style={{ color: '#9fb0e0' }}>contact_inquiries（{inquiries.length}件）</p>
        </div>
        <button
          type="button"
          onClick={onReload}
          disabled={loading}
          className="min-h-[40px] rounded-full px-4 text-[13px] font-bold text-white transition active:scale-95 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 18px rgba(60,120,255,0.35)' }}>
          {loading ? '更新中…' : '再読み込み'}
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl" style={GLASS}>
          <Centered>
            <Spinner />
            <p className="text-[13px]" style={{ color: '#9fb0e0' }}>読み込み中…</p>
          </Centered>
        </div>
      ) : error ? (
        <div className="rounded-2xl p-6 text-center sm:p-8" style={GLASS}>
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(224,85,85,0.16)' }}>
            ⚠️
          </span>
          <p className="text-[15px] font-bold" style={{ color: '#ff9b9b' }}>取得に失敗しました</p>
          <p className="mt-1 text-[12px]" style={{ color: '#9fb0e0' }}>{error}</p>
          <button
            type="button"
            onClick={onReload}
            className="mt-4 min-h-[44px] rounded-full px-6 text-[13px] font-bold text-white active:scale-95"
            style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 18px rgba(60,120,255,0.35)' }}>
            再読み込み
          </button>
        </div>
      ) : selected ? (
        // 詳細（中央に表示・返信編集つき）。inquiry.id を key にして返信の編集状態を問い合わせごとにリセット。
        <InquiryDetail key={selected.id} inquiry={selected} onBack={() => onSelect(null)} onReplied={onReplied} />
      ) : inquiries.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={GLASS}>
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(99,102,241,0.16)' }}>
            📭
          </span>
          <p className="text-[15px] font-bold" style={{ color: '#ffffff' }}>お問い合わせはありません</p>
          <p className="mt-1 text-[12px]" style={{ color: '#9fb0e0' }}>ユーザーからの送信があると、ここに表示されます。</p>
        </div>
      ) : (
        <>
          {/* PC / iPad：テーブル */}
          <div className="hidden overflow-hidden rounded-2xl md:block" style={GLASS}>
            <div className="admin-scroll overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(120,160,255,0.2)' }}>
                    {['作成日時', 'ユーザー名', 'メール', '項目', '内容', '画像', 'status', 'reply'].map((h) => (
                      <th key={h} className="px-3 py-3 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedInquiries.map((q) => (
                    <tr
                      key={q.id}
                      onClick={() => onSelect(q)}
                      className="cursor-pointer transition hover:bg-white/[0.04]"
                      style={
                        pendingRank(q.status) === 0
                          ? { borderBottom: '1px solid rgba(120,160,255,0.10)', background: 'rgba(242,213,138,0.06)' }
                          : { borderBottom: '1px solid rgba(120,160,255,0.10)' }
                      }>
                      <td className="whitespace-nowrap px-3 py-3 text-[12px]" style={{ color: '#c7d2fe' }}>{formatDateTime(q.createdAt)}</td>
                      <td className="px-3 py-3 text-[13px] font-semibold" style={{ color: '#ffffff' }}>{q.userName || '—'}</td>
                      <td className="px-3 py-3 text-[12px]" style={{ color: '#9fb0e0' }}>{q.userEmail || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-[12px]" style={{ color: '#d8b4fe' }}>{q.category || '未分類'}</td>
                      <td className="max-w-[260px] px-3 py-3 text-[12px]" style={{ color: '#dbe4ff' }}>
                        <span className="line-clamp-1">{q.message}</span>
                      </td>
                      <td className="max-w-[130px] px-3 py-3 text-[12px]" style={{ color: q.imageFilename ? '#bae6fd' : '#7a86b8' }}>
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

          {/* スマホ：カード */}
          <div className="flex flex-col gap-3 md:hidden">
            {sortedInquiries.map((q) => (
              <button key={q.id} type="button" onClick={() => onSelect(q)} className="w-full text-left active:opacity-70">
                <div
                  className="rounded-2xl p-4"
                  style={
                    pendingRank(q.status) === 0
                      ? { ...GLASS, border: '1px solid rgba(242,213,138,0.5)', background: 'rgba(242,213,138,0.07)' }
                      : GLASS
                  }>
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
                  {q.imageFilename && <p className="mt-1 text-[11px]" style={{ color: '#bae6fd' }}>🖼 {q.imageFilename}</p>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── 中央：お問い合わせ詳細＋返信編集 ──────────────────────────
function InquiryDetail({
  inquiry,
  onBack,
  onReplied,
}: {
  inquiry: AdminInquiry;
  onBack: () => void;
  onReplied: (updated: AdminInquiry) => void;
}) {
  const [reply, setReply] = useState(inquiry.adminReply ?? '');
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Q&A（FAQ）登録
  const [qaExisting, setQaExisting] = useState<QaRecord | null>(null);
  const [qaOpen, setQaOpen] = useState(false);
  const [qaGenerating, setQaGenerating] = useState(false);
  const [qaBusy, setQaBusy] = useState(false);
  const [qaCategory, setQaCategory] = useState(inquiry.category || '');
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState('');
  const [qaSimilar, setQaSimilar] = useState<QaRecord[]>([]);
  const [qaMsg, setQaMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 既存Q&Aの有無を取得（重複登録防止＋登録済み表示）。inquiry.id を key にしているため都度実行。
  useEffect(() => {
    let alive = true;
    void getQaForInquiry(inquiry.id).then((res) => {
      if (alive && res.record) setQaExisting(res.record);
    });
    return () => {
      alive = false;
    };
  }, [inquiry.id]);

  // Q&A案を作成：個人情報を除いた案を生成し、編集欄を開く（すぐ保存はしない）。
  // あわせて同カテゴリの類似Q&Aを探し、重複注意を表示する。
  async function openQa() {
    if (qaGenerating || qaBusy) return;
    setQaGenerating(true);
    setQaMsg(null);
    setQaSimilar([]);
    try {
      const draft = await generateInquiryQaDraft({
        category: inquiry.category,
        message: inquiry.message,
        reply: reply.trim() || inquiry.adminReply || '',
        userName: inquiry.userName,
      });
      setQaCategory(draft.category);
      setQaQuestion(draft.question);
      setQaAnswer(draft.answer);
      setQaOpen(true);
      // 類似Q&A（同カテゴリ・自分の問い合わせ由来は除外）。失敗しても作成自体は続行。
      const sim = await findSimilarQa({
        category: draft.category,
        question: draft.question,
        excludeInquiryId: inquiry.id,
      });
      if (sim.records.length > 0) setQaSimilar(sim.records);
    } catch (e) {
      console.error('[admin] generate QA failed:', e);
      setQaMsg({ ok: false, text: 'Q&A案の作成に失敗しました。時間をおいて再度お試しください。' });
    } finally {
      setQaGenerating(false);
    }
  }

  // Q&Aを保存（is_public=false / source_type=inquiry）。重複は一意制約で防止。
  async function saveQa() {
    if (qaBusy) return;
    if (qaQuestion.trim().length === 0 || qaAnswer.trim().length === 0) {
      setQaMsg({ ok: false, text: '質問と回答を入力してください。' });
      return;
    }
    setQaBusy(true);
    setQaMsg(null);
    const res = await saveQaFromInquiry({
      question: qaQuestion.trim(),
      answer: qaAnswer.trim(),
      category: qaCategory.trim(),
      sourceInquiryId: inquiry.id,
    });
    setQaBusy(false);
    if (!res.ok || !res.record) {
      if (res.duplicate) {
        setQaOpen(false);
        void getQaForInquiry(inquiry.id).then((r) => {
          if (r.record) setQaExisting(r.record);
        });
      }
      setQaMsg({ ok: false, text: res.error ?? 'Q&Aの保存に失敗しました。' });
      return;
    }
    setQaExisting(res.record);
    setQaOpen(false);
    setQaMsg({ ok: true, text: 'Q&Aを登録しました（確認用・非公開）。' });
  }

  // AI返信案を作成 → 返信欄に自動入力し、ai_draft_reply にも保存（送信はしない）。
  async function makeDraft() {
    if (drafting || busy) return;
    setDrafting(true);
    setMsg(null);
    try {
      const draft = await generateInquiryReplyDraft({
        userName: inquiry.userName,
        category: inquiry.category,
        message: inquiry.message,
        replyStatus: inquiry.replyStatus,
      });
      setReply(draft); // 返信入力欄に自動入力（管理者が確認・修正できる）
      const res = await saveAiDraftReply(inquiry.id, draft);
      if (res.ok && res.inquiry) {
        onReplied(res.inquiry);
        setMsg({ ok: true, text: 'AI返信案を作成しました。内容を確認・修正のうえ「返信を保存」してください。' });
      } else {
        setMsg({ ok: false, text: res.error ?? 'AI返信案は入力しましたが、保存に失敗しました。' });
      }
    } catch (e) {
      console.error('[admin] generate draft failed:', e);
      setMsg({ ok: false, text: 'AI返信案の作成に失敗しました。時間をおいて再度お試しください。' });
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (busy) return;
    if (reply.trim().length === 0) {
      setMsg({ ok: false, text: '返信内容を入力してください。' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await saveAdminReply(inquiry.id, reply.trim());
    setBusy(false);
    if (!res.ok || !res.inquiry) {
      setMsg({ ok: false, text: res.error ?? '返信の保存に失敗しました。' });
      return;
    }
    setMsg({ ok: true, text: '返信を保存しました。ユーザーのお問い合わせ履歴に表示されます。' });
    onReplied(res.inquiry);
  }

  return (
    <div className="rounded-2xl p-5" style={GLASS}>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-bold active:opacity-70"
        style={{ color: '#9cc4ff' }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        一覧へ戻る
      </button>

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <DetailField label="作成日時" value={formatDateTime(inquiry.createdAt)} />
        <DetailField label="お問い合わせ項目" value={inquiry.category || '未分類'} />
        <DetailField label="ユーザー名" value={inquiry.userName || '—'} />
        <DetailField label="メールアドレス" value={inquiry.userEmail || '—'} />
        <DetailField label="添付画像ファイル名" value={inquiry.imageFilename || 'なし'} muted={!inquiry.imageFilename} />
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold" style={{ color: '#9fb0e0' }}>status</span>
          <StatusChip label={inquiry.status} />
          <span className="ml-2 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>reply</span>
          <StatusChip label={inquiry.replyStatus} />
        </div>
      </div>

      <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>お問い合わせ内容</p>
      <div
        className="whitespace-pre-line rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
        style={{ background: 'rgba(10,14,32,0.6)', border: '1px solid rgba(120,160,255,0.18)', color: '#e6edff' }}>
        {inquiry.message}
      </div>

      {/* 運営からの返信（AI返信案作成・編集・保存） */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-[12px] font-bold" style={{ color: '#c4b5fd' }}>運営からの返信</p>
          {inquiry.adminReply && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(34,229,168,0.16)', color: '#86efac', border: '1px solid rgba(34,229,168,0.4)' }}>
              返信済み
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={makeDraft}
          disabled={drafting || busy}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-[12px] font-bold transition active:scale-95 disabled:opacity-60"
          style={{ background: 'rgba(166,107,255,0.18)', color: '#d8b4fe', border: '1px solid rgba(166,107,255,0.5)' }}>
          {drafting ? '作成中…' : '🤖 AI返信案を作成'}
        </button>
      </div>

      {/* 保存済みのAI返信案（あれば確認・反映） */}
      {inquiry.aiDraftReply && (
        <div className="mt-2 rounded-2xl p-3" style={{ background: 'rgba(166,107,255,0.08)', border: '1px solid rgba(166,107,255,0.3)' }}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold" style={{ color: '#d8b4fe' }}>🤖 保存済みのAI返信案</span>
            <button
              type="button"
              onClick={() => {
                setReply(inquiry.aiDraftReply ?? '');
                setMsg(null);
              }}
              className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold active:opacity-70"
              style={{ background: 'rgba(166,107,255,0.2)', color: '#e9d5ff', border: '1px solid rgba(166,107,255,0.45)' }}>
              返信欄に反映
            </button>
          </div>
          <p className="whitespace-pre-line text-[12.5px] leading-relaxed" style={{ color: '#e9d5ff' }}>{inquiry.aiDraftReply}</p>
        </div>
      )}

      <textarea
        value={reply}
        onChange={(e) => {
          setReply(e.target.value);
          setMsg(null);
        }}
        placeholder="ユーザーへの返信内容を入力..."
        className="mt-1.5 min-h-[130px] w-full resize-none rounded-2xl px-4 py-3 text-[14px] text-white outline-none placeholder:text-[#7a86b8]"
        style={{ background: 'rgba(10,14,32,0.6)', border: '1px solid rgba(120,160,255,0.3)', caretColor: '#818cf8' }}
      />

      {msg && (
        <p
          className="mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold"
          style={
            msg.ok
              ? { background: 'rgba(34,229,168,0.15)', color: '#86efac', border: '1px solid rgba(34,229,168,0.35)' }
              : { background: 'rgba(224,85,85,0.15)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.35)' }
          }>
          {msg.ok ? '✅ ' : '⚠️ '}{msg.text}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="min-h-[46px] rounded-full px-6 text-[14px] font-bold text-white transition active:scale-[0.98] disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 8px 24px rgba(60,120,255,0.4)' }}>
          {busy ? '保存中…' : '返信を保存'}
        </button>
        <span className="text-[11px]" style={{ color: '#7a86b8' }}>
          ※ 保存すると status=対応済み / reply=返信済み になります（メール送信はしません）。
        </span>
      </div>

      {/* Q&A / FAQ 登録（個人情報を除いた一般化Q&A・確認用に保存） */}
      <div className="mt-5 border-t pt-4" style={{ borderColor: 'rgba(120,160,255,0.18)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] font-bold" style={{ color: '#c4b5fd' }}>Q&amp;A / FAQ 登録</p>
          {qaExisting ? (
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: 'rgba(34,229,168,0.16)', color: '#86efac', border: '1px solid rgba(34,229,168,0.4)' }}>
              ✓ Q&amp;A登録済み
            </span>
          ) : !qaOpen ? (
            <button
              type="button"
              onClick={openQa}
              disabled={qaGenerating}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-[12px] font-bold transition active:scale-95 disabled:opacity-60"
              style={{ background: 'rgba(56,189,248,0.16)', color: '#7dd3fc', border: '1px solid rgba(56,189,248,0.5)' }}>
              {qaGenerating ? '作成中…' : '🛠 Q&A案を作成'}
            </button>
          ) : null}
        </div>

        {/* 登録済みQ&A（確認用・非公開） */}
        {qaExisting && (
          <div className="mt-2 rounded-2xl p-3" style={{ background: 'rgba(34,229,168,0.06)', border: '1px solid rgba(34,229,168,0.28)' }}>
            <p className="text-[11px] font-bold" style={{ color: '#86efac' }}>Q（{qaExisting.category || '未分類'}）</p>
            <p className="text-[13px] font-semibold" style={{ color: '#e6edff' }}>{qaExisting.question}</p>
            <p className="mt-2 text-[11px] font-bold" style={{ color: '#86efac' }}>A</p>
            <p className="whitespace-pre-line text-[12.5px] leading-relaxed" style={{ color: '#d7ffe9' }}>{qaExisting.answer}</p>
            <p className="mt-2 text-[10px]" style={{ color: '#7a86b8' }}>is_public: false（確認用・未公開）</p>
          </div>
        )}

        {/* Q&A編集（保存前に管理者が確認・修正） */}
        {qaOpen && !qaExisting && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-[11px] leading-relaxed" style={{ color: '#9fb0e0' }}>
              ※ 個人情報を除いた一般的なQ&amp;A案です。内容を確認・修正してから保存してください（非公開で保存されます）。
            </p>

            {/* 類似Q&Aの重複注意（自動上書きはしない） */}
            {qaSimilar.length > 0 && (
              <div className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(242,213,138,0.10)', border: '1px solid rgba(242,213,138,0.4)' }}>
                <p className="text-[12px] font-bold" style={{ color: '#f2d58a' }}>
                  ⚠️ 似ているQ&amp;Aがあります。重複に注意してください。
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {qaSimilar.map((s) => (
                    <li key={s.id} className="text-[12px] leading-snug" style={{ color: '#e9dcb0' }}>
                      ・<span style={{ color: '#9fb0e0' }}>[{s.category || '未分類'}]</span> {s.question}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold" style={{ color: '#9fb0e0' }}>カテゴリ</span>
              <input
                value={qaCategory}
                onChange={(e) => { setQaCategory(e.target.value); setQaMsg(null); }}
                className="min-h-[40px] rounded-xl px-3 text-[13px] text-white outline-none"
                style={{ background: 'rgba(10,14,32,0.6)', border: '1px solid rgba(120,160,255,0.3)', caretColor: '#818cf8' }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold" style={{ color: '#9fb0e0' }}>質問（Q）</span>
              <textarea
                value={qaQuestion}
                onChange={(e) => { setQaQuestion(e.target.value); setQaMsg(null); }}
                className="min-h-[60px] resize-none rounded-xl px-3 py-2 text-[13px] text-white outline-none"
                style={{ background: 'rgba(10,14,32,0.6)', border: '1px solid rgba(120,160,255,0.3)', caretColor: '#818cf8' }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold" style={{ color: '#9fb0e0' }}>回答（A）</span>
              <textarea
                value={qaAnswer}
                onChange={(e) => { setQaAnswer(e.target.value); setQaMsg(null); }}
                className="min-h-[120px] resize-none rounded-xl px-3 py-2 text-[13px] text-white outline-none"
                style={{ background: 'rgba(10,14,32,0.6)', border: '1px solid rgba(120,160,255,0.3)', caretColor: '#818cf8' }}
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveQa}
                disabled={qaBusy}
                className="min-h-[44px] rounded-full px-5 text-[13px] font-bold text-white active:scale-[0.98] disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 18px rgba(60,120,255,0.35)' }}>
                {qaBusy ? '保存中…' : 'Q&Aを保存'}
              </button>
              <button
                type="button"
                onClick={() => { setQaOpen(false); setQaMsg(null); setQaSimilar([]); }}
                className="min-h-[44px] rounded-full px-5 text-[13px] font-semibold"
                style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
                キャンセル
              </button>
            </div>
          </div>
        )}

        {qaMsg && (
          <p
            className="mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold"
            style={
              qaMsg.ok
                ? { background: 'rgba(34,229,168,0.15)', color: '#86efac', border: '1px solid rgba(34,229,168,0.35)' }
                : { background: 'rgba(224,85,85,0.15)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.35)' }
            }>
            {qaMsg.ok ? '✅ ' : '⚠️ '}{qaMsg.text}
          </p>
        )}
      </div>
    </div>
  );
}

// ── 中央：チャットボットFAQ管理（chatbot_knowledge 一覧・公開トグル） ──────────
function FaqPanel() {
  const [records, setRecords] = useState<QaRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listKnowledge();
    setLoading(false);
    if (res.error) {
      setError(res.error);
      setRecords([]);
      return;
    }
    setRecords(res.records);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 公開/非公開の切り替え（RLSで管理者の update が許可されている場合のみ成功）。
  async function toggle(rec: QaRecord) {
    if (togglingId) return;
    setTogglingId(rec.id);
    setMsg(null);
    const res = await setKnowledgePublic(rec.id, !rec.isPublic);
    setTogglingId(null);
    if (!res.ok || !res.record) {
      setMsg({ ok: false, text: res.error ?? '公開状態の更新に失敗しました。' });
      return;
    }
    setRecords((prev) => prev.map((r) => (r.id === res.record!.id ? res.record! : r)));
    setMsg({ ok: true, text: res.record.isPublic ? '公開にしました。' : '非公開にしました。' });
  }

  const publicCount = records.filter((r) => r.isPublic).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[17px] font-bold" style={{ color: '#ffffff' }}>チャットボットFAQ管理</h2>
          <p className="text-[12px]" style={{ color: '#9fb0e0' }}>
            chatbot_knowledge（{records.length}件 ・ 公開 {publicCount}件）
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="min-h-[40px] rounded-full px-4 text-[13px] font-bold text-white transition active:scale-95 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 18px rgba(60,120,255,0.35)' }}>
          {loading ? '更新中…' : '再読み込み'}
        </button>
      </div>

      {msg && (
        <p
          className="rounded-xl px-3 py-2 text-[12px] font-semibold"
          style={
            msg.ok
              ? { background: 'rgba(34,229,168,0.15)', color: '#86efac', border: '1px solid rgba(34,229,168,0.35)' }
              : { background: 'rgba(224,85,85,0.15)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.35)' }
          }>
          {msg.ok ? '✅ ' : '⚠️ '}{msg.text}
        </p>
      )}

      {loading ? (
        <div className="rounded-2xl" style={GLASS}>
          <Centered>
            <Spinner />
            <p className="text-[13px]" style={{ color: '#9fb0e0' }}>読み込み中…</p>
          </Centered>
        </div>
      ) : error ? (
        <div className="rounded-2xl p-6 text-center sm:p-8" style={GLASS}>
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
      ) : records.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={GLASS}>
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(99,102,241,0.16)' }}>
            🤖
          </span>
          <p className="text-[15px] font-bold" style={{ color: '#ffffff' }}>Q&amp;Aはまだありません</p>
          <p className="mt-1 text-[12px]" style={{ color: '#9fb0e0' }}>お問い合わせ管理から「Q&A案を作成」で登録すると、ここに表示されます。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {records.map((r) => (
            <div key={r.id} className="rounded-2xl p-4" style={GLASS}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                    style={{ background: 'rgba(166,107,255,0.18)', color: '#d8b4fe', border: '1px solid rgba(166,107,255,0.4)' }}>
                    {r.category || '未分類'}
                  </span>
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                    style={
                      r.isPublic
                        ? { background: 'rgba(34,229,168,0.16)', color: '#86efac', border: '1px solid rgba(34,229,168,0.4)' }
                        : { background: 'rgba(242,213,138,0.16)', color: '#f2d58a', border: '1px solid rgba(242,213,138,0.4)' }
                    }>
                    {r.isPublic ? '公開' : '未公開'}
                  </span>
                  <span className="text-[11px]" style={{ color: '#7a86b8' }}>{formatDateTime(r.createdAt)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void toggle(r)}
                  disabled={togglingId === r.id}
                  className="shrink-0 rounded-full px-3.5 py-2 text-[12px] font-bold transition active:scale-95 disabled:opacity-60"
                  style={
                    r.isPublic
                      ? { background: 'rgba(242,213,138,0.14)', color: '#f2d58a', border: '1px solid rgba(242,213,138,0.45)' }
                      : { background: 'rgba(34,229,168,0.14)', color: '#86efac', border: '1px solid rgba(34,229,168,0.45)' }
                  }>
                  {togglingId === r.id ? '更新中…' : r.isPublic ? '非公開にする' : '公開にする'}
                </button>
              </div>

              <p className="mt-3 text-[11px] font-bold" style={{ color: '#9fb0e0' }}>Q</p>
              <p className="text-[14px] font-semibold leading-relaxed" style={{ color: '#ffffff' }}>{r.question}</p>
              <p className="mt-2 text-[11px] font-bold" style={{ color: '#9fb0e0' }}>A</p>
              <p className="whitespace-pre-line text-[13px] leading-relaxed" style={{ color: '#dbe4ff' }}>{r.answer}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 中央：未実装メニューの「準備中」 ──────────────────────────
function SoonPanel({ label }: { label: string }) {
  return (
    <div className="rounded-2xl p-10 text-center" style={GLASS}>
      <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(99,102,241,0.16)' }}>
        🚧
      </span>
      <p className="text-[16px] font-bold" style={{ color: '#ffffff' }}>{label}</p>
      <p className="mt-1 text-[12px]" style={{ color: '#9fb0e0' }}>この管理機能は準備中です。今後のアップデートで利用できるようになります。</p>
    </div>
  );
}

// ── 右：AIアシスト（入力欄＋送信のみ。将来、問い合わせ内容を参考に返信案を作る場所） ──
function AiAssistPanel({ selected }: { selected: AdminInquiry | null }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  function onSend() {
    if (text.trim().length === 0) return;
    setMsg('AI相談機能は準備中です');
  }

  return (
    <div className="rounded-2xl p-4" style={GLASS}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full text-[16px]" style={{ background: 'rgba(166,107,255,0.2)' }}>🤖</span>
        <h2 className="text-[15px] font-bold" style={{ color: '#ffffff' }}>AIアシスト</h2>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed" style={{ color: '#9fb0e0' }}>
        問い合わせ対応の相談や、返信案づくりに使えるAIアシスタント（本接続は今後実装）。
      </p>

      {selected && (
        <div className="mb-2 rounded-xl px-3 py-2 text-[11px]" style={{ background: 'rgba(10,14,32,0.6)', border: '1px solid rgba(120,160,255,0.18)', color: '#c7d2fe' }}>
          対象：{selected.category || '未分類'} ／ {selected.userName || '—'}
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setMsg(null);
        }}
        placeholder="問い合わせ対応についてAIに相談..."
        className="min-h-[120px] w-full resize-none rounded-2xl px-4 py-3 text-[14px] text-white outline-none placeholder:text-[#7a86b8]"
        style={{ background: 'rgba(10,14,32,0.6)', border: '1px solid rgba(120,160,255,0.3)', caretColor: '#818cf8' }}
      />

      {msg && (
        <p className="mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ background: 'rgba(242,213,138,0.12)', color: '#f2d58a', border: '1px solid rgba(242,213,138,0.35)' }}>
          {msg}
        </p>
      )}

      <button
        type="button"
        onClick={onSend}
        className="mt-3 min-h-[46px] w-full rounded-full text-[14px] font-bold text-white transition active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 8px 24px rgba(60,120,255,0.4)' }}>
        AIに相談する
      </button>
    </div>
  );
}

// ── 共通の小コンポーネント ──────────────────────────
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
