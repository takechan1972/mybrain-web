'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import {
  DEFAULT_OLLAMA_SETTINGS,
  OLLAMA_MODELS,
  loadOllamaSettings,
  saveOllamaSettings,
  testOllama,
  type OllamaSettings,
} from '@/lib/ai/ollama';
import { isLocalHost } from '@/lib/env';
import { createContactInquiry, listMyInquiries, type ContactInquiry } from '@/lib/contact';
import {
  DEFAULT_ACCOUNT_SETTINGS,
  loadAccountSettings,
  planLabel as planLabelOf,
  saveAccountSettings,
  type AccountSettings,
} from '@/lib/account-store';
import DesktopSettings from '@/components/DesktopSettings';
import {
  DEFAULT_MEMO_STORAGE_TARGET,
  loadMemoStorageTarget,
  saveMemoStorageTarget,
} from '@/lib/storage/memo-storage-target';
import type { MemoStorageTarget } from '@/lib/storage/memo-store';

// サンプルログイン（デモ用アカウント）の判定。
// 専用の課金/アカウント基盤が未実装のため、メールアドレスで暫定判定する。
// 実データ接続時はここを差し替えるだけでよい（戻り値が true のとき編集系UIを無効化する）。
const SAMPLE_EMAILS = new Set([
  'sample@mybrain.app',
  'demo@mybrain.app',
  'guest@mybrain.app',
  'sample@example.com',
  'demo@example.com',
  'test@example.com',
]);
function isSampleUser(email: string | null): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (SAMPLE_EMAILS.has(e)) return true;
  // example.com ドメイン、または sample / demo で始まるローカル部はサンプル扱い
  return e.endsWith('@example.com') || e.startsWith('sample') || e.startsWith('demo');
}

// ホーム／ログインと統一したガラスカード（ダーク・ネオン・グラス）
const GLASS_CARD: React.CSSProperties = {
  background: 'rgba(10,14,35,0.6)',
  border: '1px solid rgba(120,160,255,0.25)',
  boxShadow: '0 0 18px rgba(99,102,241,0.12), 0 10px 28px rgba(0,0,0,0.35)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
};

function LogoutIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// お問い合わせ項目（選択式）
const CONTACT_CATEGORIES = ['アプリについて', 'プランについて', '解約について', 'その他'];

// プライバシーポリシー（簡易版・実装に即した内容）。設定の「プライバシーポリシー」で表示。
const PRIVACY_SECTIONS: { title: string; lines: string[] }[] = [
  {
    title: '取得する情報',
    lines: [
      '本サービスの提供のため、以下の情報を取得します。',
      '・アカウント情報（メールアドレス、ユーザーID、認証に関する情報）',
      '・ご利用情報（メモ、予定、AIアシストの履歴、各種設定）',
      '・お問い合わせ時に入力された情報（氏名・メールアドレス・お問い合わせ内容・添付画像のファイル名）',
      '・端末や利用状況に関する情報',
    ],
  },
  {
    title: '利用目的',
    lines: [
      '取得した情報は、次の目的で利用します。',
      '・本サービスの提供・維持・改善',
      '・メモ／予定／AIアシスト等の機能提供',
      '・お問い合わせへの対応およびご連絡',
      '・不正利用の防止と安全の確保',
    ],
  },
  {
    title: 'AI機能でのデータ利用',
    lines: [
      'AIアシスト等の機能では、回答生成のために、ユーザーが許可した範囲のメモ・予定・履歴を参照します。参照する範囲は設定画面でいつでも変更できます。',
      'ローカルAI（Ollama）を利用する場合、処理はお使いの端末内で行われ、その内容が外部へ送信されることはありません。',
    ],
  },
  {
    title: '画像・音声入力の扱い',
    lines: [
      '・画像：メモやお問い合わせに添付された画像は、機能提供の範囲で取り扱います。お問い合わせではファイル名のみを保存します。',
      '・音声：音声入力は端末（ブラウザ）の音声認識機能でテキスト化されます。音声データそのものを本サービスのサーバーに保存することはありません。',
    ],
  },
  {
    title: 'お問い合わせ情報の保存',
    lines: [
      'お問い合わせフォームから送信された内容（氏名・メールアドレス・ユーザーID・お問い合わせ項目・本文・添付画像のファイル名等）は、対応および品質向上のために保存されます。',
      'お問い合わせ情報は、ご本人のみが自身の内容を参照できるよう管理します。',
    ],
  },
  {
    title: '第三者提供',
    lines: [
      '法令に基づく場合等を除き、ご本人の同意なく個人情報を第三者へ提供することはありません。',
    ],
  },
  {
    title: '外部サービス利用',
    lines: [
      '本サービスは、データの保存や認証等のために外部サービス（例：Supabase）を利用します。必要な範囲で、これらのサービスのサーバーに情報が保存されます。',
      '各外部サービスにおける取り扱いは、それぞれの規約・プライバシーポリシーに従います。',
    ],
  },
  {
    title: '安全管理',
    lines: [
      '取得した情報は、不正アクセス・漏えい・改ざん等を防ぐため、適切な安全管理措置を講じて管理します。',
      'データはユーザーごとに分離し、ご本人のみが参照できる行レベルのアクセス制限等を用いて保護します。',
    ],
  },
  {
    title: '開示・訂正・削除・退会',
    lines: [
      'ご本人からの求めに応じ、保有する個人情報の開示・訂正・削除に対応します。',
      'アカウントの削除（退会）を行った場合、関連するデータは適切に削除または利用停止します。',
    ],
  },
  {
    title: '問い合わせ窓口',
    lines: [
      '本ポリシーに関するお問い合わせは、アプリ内の「お問い合わせ」よりご連絡ください。',
    ],
  },
];

// 会社情報（アプリ内表示用）。設定の「会社情報」で表示。
const COMPANY_INFO: { label: string; value: string }[] = [
  { label: 'サービス名', value: 'MyBrain' },
  { label: '運営者', value: 'MyBrain運営' },
  { label: '所在地', value: '和歌山県和歌山市' },
  { label: '事業内容', value: 'AIメモアプリ・業務支援アプリの開発、AI活用支援' },
  { label: 'お問い合わせ', value: 'アプリ内お問い合わせフォーム' },
];

// 利用規約（簡易版・実装に即した内容）。設定の「利用規約」とお問い合わせ内の「利用規約を確認」で共通表示。
const TERMS_SECTIONS: { title: string; lines: string[] }[] = [
  {
    title: 'はじめに',
    lines: [
      '本規約は、MyBrain（以下「本サービス」）の利用条件を定めるものです。本サービスをご利用いただいた場合、本規約に同意いただいたものとみなします。',
    ],
  },
  {
    title: 'サービス内容',
    lines: [
      '本サービスは、メモ・予定の管理、AIアシスト、その他関連する機能を提供するアプリです。提供内容は、改善等のため予告なく変更・追加・終了する場合があります。',
    ],
  },
  {
    title: 'アカウント管理',
    lines: [
      '一部の機能はアカウント登録が必要です。登録情報は正確に登録し、メールアドレスやパスワード等はご自身で適切に管理してください。',
      '管理不十分や第三者の利用による損害について、当方は責任を負いかねます。',
    ],
  },
  {
    title: 'メモ・予定・入力データの扱い',
    lines: [
      '利用者が入力したメモ・予定等のデータは、サービス提供のために保存・処理されます。データの具体的な取り扱いは、別途定めるプライバシーポリシーに従います。',
    ],
  },
  {
    title: 'AI機能について',
    lines: [
      'AIアシスト等が生成する回答は参考情報であり、正確性・完全性・有用性を保証するものではありません。重要な判断は、利用者ご自身の責任で行ってください。',
    ],
  },
  {
    title: '音声入力・画像添付',
    lines: [
      '音声入力は端末（ブラウザ）の音声認識機能を利用してテキスト化されます。画像添付は、メモやお問い合わせの補助としてご利用いただけます。',
      '法令や第三者の権利を侵害する音声・画像の利用は禁止します。',
    ],
  },
  {
    title: 'お問い合わせ',
    lines: [
      'お問い合わせは、アプリ内のお問い合わせフォームよりご連絡ください。送信された内容は、対応および品質向上のために利用されます。',
    ],
  },
  {
    title: '禁止事項',
    lines: [
      '利用者は、次の行為を行ってはなりません。',
      '・法令または公序良俗に反する行為',
      '・第三者の権利・利益を侵害する行為',
      '・本サービスの運営を妨げる行為、不正アクセス',
      '・虚偽の情報の登録、なりすまし',
    ],
  },
  {
    title: '有料プラン・プラグイン',
    lines: [
      '本サービスでは、将来的に有料プランや追加機能（プラグイン）を提供する場合があります。提供する場合の料金・内容・条件は、別途画面等でご案内します。',
    ],
  },
  {
    title: 'データのバックアップ',
    lines: [
      '利用者は、必要に応じてご自身でデータのバックアップを行ってください。データの消失・破損について、当方は可能な範囲で対応しますが、復旧を保証するものではありません。',
    ],
  },
  {
    title: '免責事項',
    lines: [
      '本サービスは、現状有姿で提供されます。本サービスの利用または利用できないことにより生じた損害について、当方は法令で認められる範囲で責任を負いません。',
    ],
  },
  {
    title: '規約の変更',
    lines: [
      '本規約は、サービスの改善や法令の改正等に応じて予告なく変更される場合があります。変更後の規約は、本画面に表示した時点から効力を生じます。',
    ],
  },
  {
    title: '準拠法・協議',
    lines: [
      '本規約の解釈・適用は、日本法に準拠します。本サービスに関して紛争が生じた場合は、当方と利用者が誠実に協議のうえ、解決を図るものとします。',
    ],
  },
  {
    title: 'お問い合わせ窓口',
    lines: [
      '本規約に関するお問い合わせは、アプリ内のお問い合わせフォームよりご連絡ください。',
    ],
  },
];

type SheetKey =
  | 'billing'
  | 'plugin'
  | 'contact'
  | 'history'
  | 'terms'
  | 'privacy'
  | 'company'
  | 'logout';

// 日時(epoch ms) → "YYYY/MM/DD HH:mm"
function formatInquiryDateTime(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return '日時不明';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 返信日（YYYY-MM-DD）
function formatInquiryDate(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

export default function SettingsPage() {
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState<string | null>(null);
  // 登録者情報の ID（お問い合わせの自動表示用・読み取り専用）
  const [userId, setUserId] = useState<string | null>(null);

  // アカウント情報（氏名・電話番号・利用プラン）の端末ローカル保存
  const [account, setAccount] = useState<AccountSettings>(DEFAULT_ACCOUNT_SETTINGS);

  // メモの保存先（選択の保存・表示のみ。実際の保存先は変更しない＝常にMyBrain/Supabase）
  const [memoStorageTarget, setMemoStorageTarget] = useState<MemoStorageTarget>(DEFAULT_MEMO_STORAGE_TARGET);
  // localStorage はクライアントのみ。マウント後に読み込んでハイドレーション不一致を避ける。
  useEffect(() => {
    setMemoStorageTarget(loadMemoStorageTarget());
  }, []);
  function selectMemoStorageTarget(target: MemoStorageTarget) {
    setMemoStorageTarget(target);
    saveMemoStorageTarget(target);
  }

  // お問い合わせフォーム（アプリ内・送信はモック。登録者情報は自動表示）
  const [contactCategory, setContactCategory] = useState('');
  const [contactCatOpen, setContactCatOpen] = useState(false); // 項目選択ポップアップ
  const [contactBody, setContactBody] = useState('');
  const [contactImageName, setContactImageName] = useState<string | null>(null); // 添付画像（任意）
  const [contactImagePreview, setContactImagePreview] = useState<string | null>(null);
  const [contactAgree, setContactAgree] = useState(false); // 利用規約確認チェック
  const [contactTermsOpen, setContactTermsOpen] = useState(false); // 利用規約ポップアップ
  const [contactStep, setContactStep] = useState<'input' | 'confirm'>('input'); // 入力→確認の段階
  const [contactBusy, setContactBusy] = useState(false); // 送信中（Supabase保存中）
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactDone, setContactDone] = useState(false);

  // お問い合わせ履歴（本人分のみ）
  const [inquiries, setInquiries] = useState<ContactInquiry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedInquiry, setSelectedInquiry] = useState<ContactInquiry | null>(null);

  // パスワード変更（入力UIのみ。認証ストアの実際の現在パスワードは取得・表示しない）
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Ollama（ローカルAI）設定
  const [ollama, setOllama] = useState<OllamaSettings>(DEFAULT_OLLAMA_SETTINGS);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [local, setLocal] = useState(false);
  // カテゴリ設定トップ：開いているボトムシート／AI設定・アカウント情報の展開状態
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  // アカウント情報は既定で折りたたみ
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    sb?.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
    });
    setAccount(loadAccountSettings());
    setOllama(loadOllamaSettings());
    setLocal(isLocalHost());
  }, []);

  // 添付画像（任意）の選択。実アップロードはせず、ファイル名＋プレビューを画面表示するのみ。
  function onContactImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setContactImageName(null);
      setContactImagePreview(null);
      return;
    }
    setContactImageName(file.name);
    const reader = new FileReader();
    reader.onload = () => setContactImagePreview(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  }

  // お問い合わせ：確認画面へ（入力チェック。問題なければ確認ステップへ進む）
  function goConfirm() {
    if (!contactCategory) {
      setContactError('お問い合わせ項目を選択してください。');
      return;
    }
    if (contactBody.trim().length === 0) {
      setContactError('お問い合わせ内容を入力してください。');
      return;
    }
    if (!contactAgree) {
      setContactError('利用規約の確認にチェックしてください。');
      return;
    }
    setContactError(null);
    setContactStep('confirm');
  }

  // 送信タップ直後に、完了画面の「閉じる」が同じ位置でゴーストクリックされ即閉じるのを防ぐガード
  const contactCloseGuardRef = useRef(false);

  // お問い合わせ：送信（確認画面で実行）。contact_inquiries テーブルへ保存する。
  // ここではシートは閉じない（成功時は完了画面を表示し、ユーザーが「閉じる」を押すまで開いたまま）。
  // 保存失敗時は確認画面に留まり、エラーメッセージを表示する。
  async function submitContact() {
    if (contactBusy) return;
    setContactBusy(true);
    setContactError(null);
    const res = await createContactInquiry({
      userName: account.name.trim() || '未登録',
      userEmail: email ?? '',
      category: contactCategory,
      message: contactBody.trim(),
      imageFilename: contactImageName,
    });
    setContactBusy(false);
    if (!res.ok) {
      setContactError(res.error ?? 'お問い合わせの送信に失敗しました。時間をおいて再度お試しください。');
      return;
    }
    setContactDone(true);
    contactCloseGuardRef.current = true;
    window.setTimeout(() => {
      contactCloseGuardRef.current = false;
    }, 500);
  }

  // 完了画面の「閉じる」：送信直後の誤タップ（ゴーストクリック）は無視し、ユーザー操作のみで閉じる
  function finishContact() {
    if (contactCloseGuardRef.current) return;
    closeContact();
  }

  // お問い合わせ：閉じる（キャンセル含む。送信せず入力内容をリセット）
  function closeContact() {
    setSheet(null);
    setContactCatOpen(false);
    setContactCategory('');
    setContactBody('');
    setContactImageName(null);
    setContactImagePreview(null);
    setContactAgree(false);
    setContactTermsOpen(false);
    setContactStep('input');
    setContactBusy(false);
    setContactError(null);
    setContactDone(false);
  }

  // お問い合わせ履歴：本人分を読み込む
  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError(null);
    setSelectedInquiry(null);
    const res = await listMyInquiries();
    setHistoryLoading(false);
    if (res.error) {
      setHistoryError(res.error);
      setInquiries([]);
      return;
    }
    setInquiries(res.inquiries);
  }

  // お問い合わせ履歴：シートを開いて読み込み開始
  function openHistory() {
    setSelectedInquiry(null);
    setSheet('history');
    void loadHistory();
  }

  // アカウント情報（氏名・電話番号・プラン）をローカル保存（既存の設定保存パターンと同一）
  function updateAccount(patch: Partial<AccountSettings>) {
    setAccount((prev) => {
      const next = { ...prev, ...patch };
      saveAccountSettings(next);
      return next;
    });
  }

  // パスワード変更（Supabase Auth）。サンプルユーザー・未ログイン時は実行しない。
  // 入力された新パスワードのみを更新に使う（既存の現在パスワードは読み取らない）。
  async function handleChangePassword() {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    if (isSample) {
      setPwMsg({ ok: false, text: 'サンプルログインのため変更できません。' });
      return;
    }
    if (newPassword.length < 6) {
      setPwMsg({ ok: false, text: 'パスワードは6文字以上で入力してください。' });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    const { error } = await sb.auth.updateUser({ password: newPassword });
    setPwBusy(false);
    if (error) {
      setPwMsg({ ok: false, text: `変更に失敗しました：${error.message}` });
      return;
    }
    setNewPassword('');
    setShowPassword(false);
    setPwMsg({ ok: true, text: 'パスワードを変更しました。' });
  }

  function updateOllama(patch: Partial<OllamaSettings>) {
    setOllama((prev) => {
      const next = { ...prev, ...patch };
      saveOllamaSettings(next);
      return next;
    });
    setTestResult(null);
  }

  async function handleTestOllama() {
    setTesting(true);
    setTestResult(null);
    const r = await testOllama(ollama.endpoint);
    setTestResult({ ok: r.ok, message: r.message });
    setTesting(false);
  }

  async function handleSignOut() {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    await sb.auth.signOut();
    window.location.href = '/welcome';
  }

  const loggedIn = Boolean(email);
  const initial = email ? email.trim().charAt(0).toUpperCase() : 'G';

  // プラン状態（ユーザーは設定画面から変更不可。将来はシステム/決済側で管理する想定の暫定ローカル値）
  const plan = account.plan;
  const planLabel = planLabelOf(plan);
  // 有料プラン（Standard / Premium）のときだけ「AI設定」を表示する
  const isPaid = plan === 'standard' || plan === 'premium';
  const isSample = isSampleUser(email);
  const editDisabled = isSample || !loggedIn;

  // ストレージ使用量（表示専用・暫定モック。実計測は未実装）
  // プラン別の上限：無料 1GB / スタンダード 10GB / プレミアム 50GB
  const storageLimitGb = plan === 'premium' ? 50 : plan === 'standard' ? 10 : 1;
  const storageUsedGb = 0.2; // 仮の使用量（実データ接続前のモック値）
  const storagePct = Math.min(100, Math.round((storageUsedGb / storageLimitGb) * 100));
  // しきい値：〜69%=通常 / 70〜89%=注意 / 90%〜=警告
  const storageLevel: 'normal' | 'caution' | 'warning' =
    storagePct >= 90 ? 'warning' : storagePct >= 70 ? 'caution' : 'normal';
  const storageColor =
    storageLevel === 'warning' ? '#ff6b6b' : storageLevel === 'caution' ? '#F2C14E' : '#22E5A8';
  const storageNote =
    storageLevel === 'warning'
      ? '空き容量がわずかです。プランの見直しをご検討ください。'
      : storageLevel === 'caution'
      ? '使用量が増えています。'
      : '十分な空き容量があります。';

  return (
    <>
    <DesktopSettings />
    {/* ── スマホ（lg未満）：宇宙背景・ネオン／グラスUI（ホーム・ログインと統一） ── */}
    <div className="relative lg:hidden">
      {/* 宇宙背景（haikei.png）＋暗オーバーレイ */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen lg:hidden"
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
        className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-screen lg:hidden"
        style={{
          background:
            'linear-gradient(to bottom, rgba(5,7,22,0.30) 0%, rgba(5,7,22,0.55) 45%, rgba(5,7,22,0.92) 100%)',
        }}
      />

      {/* 下部余白は MainShell（設定は safe-area + 控えめ）が付与するため重複させない */}
      <div className="relative z-10 flex flex-col gap-4">
        {/* ヘッダー */}
        <header className="flex items-center justify-between pt-1">
          <Link
            href="/"
            aria-label="ホームへ戻る"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full active:scale-95"
            style={{ color: '#9cc4ff' }}>
            <ChevronLeftIcon size={22} />
          </Link>
          <h1 className="text-[18px] font-bold" style={{ color: '#ffffff', textShadow: '0 0 12px rgba(99,102,241,0.4)' }}>
            設定
          </h1>
          <span className="h-9 w-9" />
        </header>

        {/* アカウントサマリーカード */}
        <section className="flex items-center gap-4 rounded-3xl p-5" style={GLASS_CARD}>
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[22px] font-extrabold"
            style={{
              background: 'rgba(99,102,241,0.22)',
              color: '#c7d2fe',
              border: '1px solid rgba(129,140,248,0.45)',
              boxShadow: '0 0 16px rgba(129,140,248,0.3)',
            }}>
            {initial}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#9fb0e0' }}>
              {loggedIn ? `ログイン中・${planLabel}` : '未ログイン'}
              {isSample && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: 'rgba(242,213,138,0.18)', color: '#f2d58a', border: '1px solid rgba(242,213,138,0.4)' }}>
                  サンプル
                </span>
              )}
            </span>
            <span className="truncate text-[15px] font-bold" style={{ color: loggedIn ? '#ffffff' : '#9fb0e0' }}>
              {email ?? '未ログイン'}
            </span>
          </div>
        </section>

        {/* アカウント情報（重複セクションは廃止し、ここに一本化・既定で折りたたみ） */}
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            aria-expanded={accountOpen}
            className="flex w-full min-h-[56px] items-center gap-3 px-5 py-4 text-left active:opacity-70">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px]" style={{ backgroundColor: 'rgba(99,102,241,0.16)' }}>
              👤
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-[15px] font-semibold" style={{ color: '#e6edff' }}>アカウント情報</span>
              <span className="text-[12px]" style={{ color: '#9fb0e0' }}>
                メール（ID）・氏名・電話番号・パスワード{isSample ? '（編集不可）' : ''}
              </span>
            </span>
            <span className="shrink-0 transition-transform" style={{ color: '#9aa6e0', transform: accountOpen ? 'rotate(90deg)' : 'none' }}>
              <ChevronRightIcon size={18} />
            </span>
          </button>

          {accountOpen && (
          <div className="flex flex-col gap-3.5 px-5 pb-5 pt-1" style={{ borderTop: '1px solid rgba(120,160,255,0.12)' }}>
            {/* メールアドレス（ログインID・表示のみ） */}
            <InfoRow label="メールアドレス（ID）">
              <span
                className="block truncate text-right text-[13px] font-semibold"
                style={{ color: loggedIn ? '#e6edff' : '#7a86b8' }}>
                {email ?? '未ログイン'}
              </span>
            </InfoRow>

            {/* 氏名（編集系：サンプル/未ログインは無効・灰色） */}
            <AccountField label="氏名">
              <input
                type="text"
                value={account.name}
                disabled={editDisabled}
                onChange={(e) => updateAccount({ name: e.target.value })}
                placeholder={editDisabled ? '—' : '例）山田 太郎'}
                className="min-h-[44px] w-full rounded-2xl px-4 py-2.5 text-[14px] outline-none placeholder:text-[#7d89bd] disabled:cursor-not-allowed"
                style={{
                  background: editDisabled ? 'rgba(40,44,60,0.5)' : 'rgba(10,14,32,0.5)',
                  border: '1px solid rgba(130,165,255,0.4)',
                  color: editDisabled ? '#7a86b8' : '#ffffff',
                  caretColor: '#818cf8',
                }}
              />
            </AccountField>

            {/* 電話番号（編集系） */}
            <AccountField label="電話番号">
              <input
                type="tel"
                inputMode="tel"
                value={account.phone}
                disabled={editDisabled}
                onChange={(e) => updateAccount({ phone: e.target.value })}
                placeholder={editDisabled ? '—' : '例）090-1234-5678'}
                className="min-h-[44px] w-full rounded-2xl px-4 py-2.5 text-[14px] outline-none placeholder:text-[#7d89bd] disabled:cursor-not-allowed"
                style={{
                  background: editDisabled ? 'rgba(40,44,60,0.5)' : 'rgba(10,14,32,0.5)',
                  border: '1px solid rgba(130,165,255,0.4)',
                  color: editDisabled ? '#7a86b8' : '#ffffff',
                  caretColor: '#818cf8',
                }}
              />
            </AccountField>

            {/* パスワード（入力UIのみ・既定は ******** マスク。表示/非表示で入力値を切替表示） */}
            <AccountField label="パスワード" last>
              <div className="flex items-center gap-2">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  disabled={editDisabled}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="********"
                  autoComplete="new-password"
                  className="min-h-[44px] w-full flex-1 rounded-2xl px-4 py-2.5 text-[14px] outline-none placeholder:text-[#7d89bd] disabled:cursor-not-allowed"
                  style={{
                    background: editDisabled ? 'rgba(40,44,60,0.5)' : 'rgba(10,14,32,0.5)',
                    border: '1px solid rgba(130,165,255,0.4)',
                    color: editDisabled ? '#7a86b8' : '#ffffff',
                    caretColor: '#818cf8',
                    letterSpacing: showPassword ? 'normal' : '0.12em',
                  }}
                />
                <button
                  type="button"
                  disabled={editDisabled}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  className="min-h-[44px] shrink-0 rounded-2xl px-3 text-[12px] font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    background: 'rgba(99,102,241,0.16)',
                    border: '1px solid rgba(130,165,255,0.4)',
                    color: '#c7d2fe',
                  }}>
                  {showPassword ? '非表示' : '表示'}
                </button>
              </div>

              {pwMsg && (
                <p
                  className="mt-2 rounded-xl px-3 py-2 text-[12px] font-semibold"
                  style={
                    pwMsg.ok
                      ? { background: 'rgba(34,229,168,0.15)', color: '#86efac', border: '1px solid rgba(34,229,168,0.35)' }
                      : { background: 'rgba(224,85,85,0.15)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.35)' }
                  }>
                  {pwMsg.ok ? '✅ ' : '⚠️ '}{pwMsg.text}
                </p>
              )}

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px]" style={{ color: '#7a86b8' }}>
                  {editDisabled ? 'サンプルログインのため変更できません' : '新しいパスワード（6文字以上）'}
                </span>
                <button
                  type="button"
                  onClick={handleChangePassword}
                  disabled={editDisabled || pwBusy || newPassword.length === 0}
                  className="min-h-[40px] shrink-0 rounded-full px-4 text-[13px] font-bold text-white transition active:scale-95 disabled:opacity-45"
                  style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 18px rgba(60,120,255,0.35)' }}>
                  {pwBusy ? '変更中…' : '変更する'}
                </button>
              </div>
            </AccountField>
          </div>
          )}
        </section>

        {/* 契約・お支払い（プラン状態はシステム/決済側で管理。ここでは選択UIを持たない） */}
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          <SettingRow emoji="💳" title="契約・お支払い" desc="基本料金・支払い方法" onClick={() => setSheet('billing')} />
        </section>

        {/* AI設定（有料プラン＝Standard / Premium のときのみ表示。無料プランでは非表示） */}
        {isPaid && (
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          {/* AI設定（展開式・既存の Ollama 設定をそのまま内包） */}
          <button
            type="button"
            onClick={() => setAiOpen((v) => !v)}
            aria-expanded={aiOpen}
            className="flex w-full min-h-[56px] items-center gap-3 px-5 py-4 text-left active:opacity-70">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px]" style={{ backgroundColor: 'rgba(166,107,255,0.18)' }}>
              🤖
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-[15px] font-semibold" style={{ color: '#e6edff' }}>AI設定</span>
              <span className="text-[12px]" style={{ color: '#9fb0e0' }}>AIアシスト・Ollama（ローカルAI）</span>
            </span>
            <span className="shrink-0 transition-transform" style={{ color: '#c4b5fd', transform: aiOpen ? 'rotate(90deg)' : 'none' }}>
              <ChevronRightIcon size={18} />
            </span>
          </button>

          {aiOpen && (
            <div className="flex flex-col gap-4 px-5 pb-5 pt-1" style={{ borderTop: '1px solid rgba(120,160,255,0.12)' }}>
              {/* AIアシスト管理 → /ai-assist（既存ページ・導線を維持） */}
              <Link
                href="/ai-assist"
                className="flex min-h-[48px] items-center gap-3 rounded-2xl px-4 active:opacity-70"
                style={{ background: 'rgba(166,107,255,0.10)', border: '1px solid rgba(166,107,255,0.30)' }}>
                <span className="text-[16px]">🛠️</span>
                <span className="flex flex-1 flex-col py-2">
                  <span className="text-[14px] font-semibold" style={{ color: '#e6edff' }}>AIアシスト管理</span>
                  <span className="text-[11px]" style={{ color: '#9fb0e0' }}>参照する情報・応答スタイル・テンプレート</span>
                </span>
                <span className="shrink-0" style={{ color: '#c4b5fd' }}>
                  <ChevronRightIcon size={16} />
                </span>
              </Link>

              {/* Ollama 有効化トグル（ネオン） */}
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold" style={{ color: '#ffffff' }}>Ollama（ローカルAI）</span>
                <button
                  type="button"
                  onClick={() => updateOllama({ enabled: !ollama.enabled })}
                  aria-pressed={ollama.enabled}
                  className="relative h-7 w-12 rounded-full transition-colors"
                  style={{
                    backgroundColor: ollama.enabled ? '#7B61FF' : 'rgba(255,255,255,0.18)',
                    boxShadow: ollama.enabled ? '0 0 12px rgba(123,97,255,0.6)' : 'none',
                  }}>
                  <span
                    className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all"
                    style={{ left: ollama.enabled ? '22px' : '2px' }}
                  />
                </button>
              </div>
              <p className="text-[12px]" style={{ color: '#9fb0e0' }}>
                このPC上の Ollama を使って AIアシスト・要約・メモ整理を行います。APIキーは不要です。ローカル利用のみ（外部公開なし）。
              </p>

              {!local ? (
                <p
                  className="rounded-2xl p-4 text-[13px]"
                  style={{ border: '1px solid rgba(242,213,138,0.4)', background: 'rgba(242,213,138,0.10)', color: '#f2d58a' }}>
                  この機能は <strong>PCローカル版専用</strong>です。公開（Vercel）環境では Ollama に接続できないため利用できません。お使いのPCでローカル起動するとここで設定できます。
                </p>
              ) : (
                <>
                  {/* エンドポイント */}
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold" style={{ color: '#9fb0e0' }}>エンドポイント</span>
                    <input
                      type="text"
                      value={ollama.endpoint}
                      onChange={(e) => updateOllama({ endpoint: e.target.value })}
                      placeholder="http://localhost:11434"
                      className="rounded-2xl px-4 py-3 text-[14px] text-white outline-none placeholder:text-[#7d89bd]"
                      style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(130,165,255,0.4)', caretColor: '#818cf8' }}
                    />
                  </label>

                  {/* モデル選択 */}
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold" style={{ color: '#9fb0e0' }}>モデル</span>
                    <select
                      value={ollama.model}
                      onChange={(e) => updateOllama({ model: e.target.value })}
                      className="rounded-2xl px-4 py-3 text-[14px] text-white outline-none [color-scheme:dark]"
                      style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(130,165,255,0.4)' }}>
                      {OLLAMA_MODELS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </label>

                  {/* 接続テスト */}
                  <button
                    type="button"
                    onClick={handleTestOllama}
                    disabled={testing}
                    className="flex min-h-[48px] items-center justify-center rounded-2xl text-[14px] font-bold text-white transition active:opacity-80 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 8px 24px rgba(60,120,255,0.4)' }}>
                    {testing ? '接続テスト中…' : '接続テスト'}
                  </button>

                  {testResult && (
                    <p
                      className="rounded-2xl px-4 py-3 text-[13px] font-semibold"
                      style={
                        testResult.ok
                          ? { background: 'rgba(34,229,168,0.15)', color: '#86efac', border: '1px solid rgba(34,229,168,0.35)' }
                          : { background: 'rgba(224,85,85,0.15)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.35)' }
                      }>
                      {testResult.ok ? '✅ ' : '⚠️ '}{testResult.message}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

        </section>
        )}

        {/* プラグイン（プランに関わらず常時表示） */}
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          <SettingRow emoji="🧩" title="プラグイン" desc="準備中" onClick={() => setSheet('plugin')} />
        </section>

        {/* メモの保存先（選択を保存・表示する。実際の保存先は変更しない＝常にMyBrain） */}
        <section className="rounded-3xl p-5" style={GLASS_CARD}>
          <div className="flex items-center gap-2">
            <span className="text-[18px]">🗒️</span>
            <p className="text-[15px] font-bold" style={{ color: '#ffffff' }}>メモの保存先</p>
          </div>
          <p className="mt-1.5 text-[13px] font-semibold" style={{ color: '#a5b4fc' }}>現在：MyBrainに保存</p>
          <p className="mt-0.5 text-[12px]" style={{ color: '#9fb0e0' }}>今後：Obsidian形式で保存先を選べるようにします。</p>

          <div className="mt-3 flex flex-col gap-2">
            {(
              [
                { value: 'mybrain', label: 'MyBrain標準' },
                { value: 'obsidian-local', label: 'Obsidian Vault（スマホ内）' },
                { value: 'obsidian-gdrive', label: 'Obsidian Vault（Google Drive）' },
              ] as const
            ).map((opt) => {
              const selected = memoStorageTarget === opt.value;
              const soon = opt.value !== 'mybrain';
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => selectMemoStorageTarget(opt.value)}
                  aria-pressed={selected}
                  className="flex items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-left transition active:opacity-80"
                  style={
                    selected
                      ? { borderColor: 'rgba(120,160,255,0.7)', background: 'rgba(46,126,255,0.14)' }
                      : { borderColor: 'rgba(120,160,255,0.25)', background: 'rgba(10,14,32,0.5)' }
                  }>
                  <span className="text-[13px] font-semibold" style={{ color: selected ? '#ffffff' : '#c7d2fe' }}>{opt.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {opt.value === 'mybrain' && selected && (
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                        style={{ background: 'rgba(34,229,168,0.16)', color: '#86efac', border: '1px solid rgba(34,229,168,0.4)' }}>
                        現在
                      </span>
                    )}
                    {soon && (
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                        style={{ background: 'rgba(242,213,138,0.16)', color: '#f2d58a', border: '1px solid rgba(242,213,138,0.4)' }}>
                        準備中
                      </span>
                    )}
                    {selected && (
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                        style={{ background: 'rgba(56,189,248,0.16)', color: '#7dd3fc', border: '1px solid rgba(56,189,248,0.4)' }}>
                        選択中
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-[11px]" style={{ color: '#8893c4' }}>
            ※ 現在は選択にかかわらずMyBrainに保存されます。保存先の切り替えは今後対応します。
          </p>
        </section>

        {/* グループ3：お問い合わせ／お問い合わせ履歴／利用規約／プライバシーポリシー／会社情報 */}
        <section className="overflow-hidden rounded-3xl" style={GLASS_CARD}>
          <SettingRow emoji="✉️" title="お問い合わせ" desc="ご質問・ご要望はこちら" onClick={() => setSheet('contact')} />
          <Divider />
          <SettingRow emoji="🗂️" title="お問い合わせ履歴" desc="送信したお問い合わせの確認" onClick={openHistory} />
          <Divider />
          <SettingRow emoji="📄" title="利用規約" desc="サービスのご利用条件" onClick={() => setSheet('terms')} />
          <Divider />
          <SettingRow emoji="🔒" title="プライバシーポリシー" desc="個人情報・データの取り扱い" onClick={() => setSheet('privacy')} />
          <Divider />
          <SettingRow emoji="🏢" title="会社情報" desc="運営者・所在地など" onClick={() => setSheet('company')} />
        </section>

        {/* グループ4：ログアウト（確認モーダルを開く） */}
        {configured && loggedIn && (
          <section className="overflow-hidden rounded-3xl" style={{ ...GLASS_CARD, border: '1px solid rgba(224,85,85,0.4)' }}>
            <button
              type="button"
              onClick={() => setSheet('logout')}
              className="flex w-full min-h-[56px] items-center gap-3 px-5 py-4 text-left active:opacity-70">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(224,85,85,0.16)', color: '#ff9b9b' }}>
                <LogoutIcon size={18} />
              </span>
              <span className="flex-1 text-[15px] font-bold" style={{ color: '#ff9b9b' }}>ログアウト</span>
              <span className="shrink-0" style={{ color: '#ff9b9b' }}>
                <ChevronRightIcon size={18} />
              </span>
            </button>
          </section>
        )}

        {!configured && (
          <p
            className="rounded-2xl p-4 text-[13px]"
            style={{ border: '1px solid rgba(242,213,138,0.4)', background: 'rgba(242,213,138,0.10)', color: '#f2d58a' }}>
            Supabase が未設定のため、アカウント情報は表示されません。
          </p>
        )}
      </div>

      {/* ── ボトムシート群（fixed・モバイルのみ） ── */}
      {sheet === 'billing' && (
        <BottomSheet title="契約・お支払い" onClose={() => setSheet(null)}>
          <FieldGroup>
            <Field label="基本料金" value="0円" />
            <Field label="プラグイン料金" value="0円" />
            <Field label="契約合計金額" value="0円" />
            <Field label="支払い方法" value="未登録（準備中）" muted />
          </FieldGroup>

          {/* ストレージ使用量（表示専用・暫定モック） */}
          <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>ストレージ使用量</p>
          <div
            className="rounded-2xl px-4 py-3.5"
            style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)' }}>
            <div className="flex items-end justify-between gap-3">
              <span className="text-[15px] font-bold text-white">
                {storageUsedGb}GB
                <span className="ml-1 text-[13px] font-semibold" style={{ color: '#9fb0e0' }}>/ {storageLimitGb}GB</span>
              </span>
              <span className="text-[14px] font-extrabold" style={{ color: storageColor }}>{storagePct}%</span>
            </div>

            {/* プログレスバー（使用率を視覚化・しきい値で配色変化） */}
            <div
              className="mt-2.5 h-3 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={storagePct}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max(storagePct, 2)}%`,
                  background: `linear-gradient(90deg, ${storageColor}cc, ${storageColor})`,
                  boxShadow: `0 0 10px ${storageColor}`,
                }}
              />
            </div>

            <p className="mt-2 text-[11px] font-semibold" style={{ color: storageColor }}>{storageNote}</p>
            <p className="mt-1 text-[11px]" style={{ color: '#7a86b8' }}>
              {planLabel} の上限 {storageLimitGb}GB ／ ※ 表示は暫定値（実計測は未実装）
            </p>
          </div>

          <p className="mt-3 text-[11px]" style={{ color: '#7a86b8' }}>
            ※ クレジットカード番号などの決済情報は保存されません。
          </p>
        </BottomSheet>
      )}

      {sheet === 'plugin' && <SoonSheet title="プラグイン" onClose={() => setSheet(null)} />}
      {sheet === 'contact' && (
        <BottomSheet title="お問い合わせ" onClose={finishContact}>
          {contactDone ? (
            // 送信完了表示（今回はメール送信／DB保存はせずモック）
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(34,229,168,0.16)' }}>
                ✅
              </span>
              <p className="text-[15px] font-bold" style={{ color: '#e6edff' }}>お問い合わせを受け付けました</p>
              <p className="text-[12px]" style={{ color: '#9fb0e0' }}>
                内容を確認のうえ、必要に応じてご登録のメールアドレスへご連絡します。
              </p>
              <button
                type="button"
                onClick={finishContact}
                className="mt-2 min-h-[48px] w-full rounded-full text-[14px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 8px 24px rgba(60,120,255,0.4)' }}>
                閉じる
              </button>
            </div>
          ) : contactStep === 'confirm' ? (
            // 入力内容の確認画面（送信前）
            <>
              <p className="mb-1.5 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>入力内容の確認</p>
              <FieldGroup>
                <Field label="名前" value={account.name.trim() || '未登録'} muted={!account.name.trim()} />
                <Field label="メールアドレス" value={email ?? '未登録'} muted={!email} />
                <Field label="ID" value={userId ?? '未登録'} muted={!userId} />
                <Field label="お問い合わせ項目" value={contactCategory || '未選択'} muted={!contactCategory} />
              </FieldGroup>

              {/* お問い合わせ内容（複数行をそのまま表示） */}
              <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>お問い合わせ内容</p>
              <div
                className="whitespace-pre-line rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
                style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)', color: '#e6edff' }}>
                {contactBody}
              </div>

              {/* 添付画像（あればファイル名＋プレビュー、無ければ「なし」） */}
              <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>添付画像</p>
              {contactImagePreview ? (
                <div
                  className="flex items-center gap-3 rounded-2xl p-2.5"
                  style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={contactImagePreview} alt="添付画像プレビュー" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: '#e6edff' }}>{contactImageName}</span>
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: '#7a86b8' }}>なし</p>
              )}

              {/* 保存失敗時のエラー（確認画面に留まり完了画面へ進まない） */}
              {contactError && (
                <p
                  className="mt-4 rounded-xl px-3 py-2 text-[12px] font-semibold"
                  style={{ background: 'rgba(224,85,85,0.15)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.35)' }}>
                  ⚠️ {contactError}
                </p>
              )}

              {/* 送信ボタンの上の補足説明 */}
              <p className="mt-5 text-[12px] leading-snug" style={{ color: '#9fb0e0' }}>
                ※お問い合わせの内容により、回答まで1週間ほどお時間をいただく場合があります。
              </p>

              {/* 戻る / 送信 */}
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => setContactStep('input')}
                  disabled={contactBusy}
                  className="min-h-[48px] flex-1 rounded-full text-[14px] font-semibold disabled:opacity-50"
                  style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
                  戻る
                </button>
                <button
                  type="button"
                  onClick={submitContact}
                  disabled={contactBusy}
                  className="min-h-[48px] flex-1 rounded-full text-[14px] font-bold text-white active:scale-[0.98] disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 8px 24px rgba(60,120,255,0.4)' }}>
                  {contactBusy ? '送信中…' : '送信'}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* 登録者情報（自動表示・読み取り専用。手入力欄にはしない） */}
              <p className="mb-1.5 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>登録者情報</p>
              <FieldGroup>
                <Field label="名前" value={account.name.trim() || '未登録'} muted={!account.name.trim()} />
                <Field label="メールアドレス" value={email ?? '未登録'} muted={!email} />
                <Field label="ID" value={userId ?? '未登録'} muted={!userId} />
              </FieldGroup>

              {/* お問い合わせ項目（タップでポップアップ選択） */}
              <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>お問い合わせ項目</p>
              <button
                type="button"
                onClick={() => setContactCatOpen(true)}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-4 text-left text-[14px] active:opacity-80"
                style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(130,165,255,0.4)' }}>
                <span style={{ color: contactCategory ? '#ffffff' : '#7d89bd' }}>
                  {contactCategory || '項目を選択してください'}
                </span>
                <span aria-hidden style={{ color: '#9aa6e0' }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>

              {/* お問い合わせ内容（複数行） */}
              <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>お問い合わせ内容</p>
              <textarea
                value={contactBody}
                onChange={(e) => {
                  setContactBody(e.target.value);
                  setContactError(null);
                }}
                placeholder="お問い合わせ内容を入力してください"
                className="min-h-[120px] w-full resize-none rounded-2xl px-4 py-3 text-[14px] text-white outline-none placeholder:text-[#7d89bd]"
                style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(130,165,255,0.4)', caretColor: '#818cf8' }}
              />

              {/* 画像添付（任意・実アップロードなし。ファイル名＋プレビュー表示のみ） */}
              <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>
                画像添付 <span className="font-medium" style={{ color: '#7a86b8' }}>（任意）</span>
              </p>
              <label
                className="flex min-h-[48px] cursor-pointer items-center gap-2 rounded-2xl px-4 active:opacity-80"
                style={{ background: 'rgba(10,14,32,0.5)', border: '1px dashed rgba(130,165,255,0.45)' }}>
                <input type="file" accept="image/*" onChange={onContactImageChange} className="hidden" />
                <span aria-hidden style={{ color: '#9B7BFF' }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="8.5" cy="8.5" r="1.6" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </span>
                <span className="text-[13px] font-semibold" style={{ color: '#c7d2fe' }}>
                  {contactImageName ? '画像を変更' : '画像を選択'}
                </span>
              </label>
              {/* 画像添付の補足説明（小さめ・薄め） */}
              <p className="mt-1.5 text-[11px]" style={{ color: '#7a86b8' }}>
                ※お問い合わせに関する画像があれば添付ください
              </p>
              {contactImagePreview && (
                <div
                  className="mt-2 flex items-center gap-3 rounded-2xl p-2.5"
                  style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={contactImagePreview} alt="添付画像プレビュー" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: '#e6edff' }}>{contactImageName}</span>
                  <button
                    type="button"
                    aria-label="添付画像を削除"
                    onClick={() => {
                      setContactImageName(null);
                      setContactImagePreview(null);
                    }}
                    className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold active:opacity-70"
                    style={{ background: 'rgba(224,85,85,0.16)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.3)' }}>
                    削除
                  </button>
                </div>
              )}

              {/* 利用規約確認チェック（送信ボタンの上に配置） */}
              <label className="mt-4 flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={contactAgree}
                  onChange={(e) => {
                    setContactAgree(e.target.checked);
                    setContactError(null);
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded"
                  style={{ accentColor: '#7B5FFF' }}
                />
                <span className="text-[13px] leading-snug" style={{ color: '#dbe4ff' }}>
                  利用規約を確認後、送信します
                </span>
              </label>
              {/* 利用規約を確認する（画面内ポップアップで表示） */}
              <button
                type="button"
                onClick={() => setContactTermsOpen(true)}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold underline-offset-2 active:opacity-70"
                style={{ color: '#9cc4ff', textDecoration: 'underline' }}>
                利用規約を確認する
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>

              {contactError && (
                <p
                  className="mt-3 rounded-xl px-3 py-2 text-[12px] font-semibold"
                  style={{ background: 'rgba(224,85,85,0.15)', color: '#ff9b9b', border: '1px solid rgba(224,85,85,0.35)' }}>
                  ⚠️ {contactError}
                </p>
              )}

              {/* ボタン：キャンセル / 送信 */}
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={closeContact}
                  className="min-h-[48px] flex-1 rounded-full text-[14px] font-semibold"
                  style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={goConfirm}
                  className="min-h-[48px] flex-1 rounded-full text-[14px] font-bold text-white active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 8px 24px rgba(60,120,255,0.4)' }}>
                  確認
                </button>
              </div>

              <p className="mt-3 text-[11px]" style={{ color: '#7a86b8' }}>
                ※ 登録者情報（名前・メール・ID）は自動で送信内容に含まれます。
              </p>
            </>
          )}
        </BottomSheet>
      )}

      {/* お問い合わせ項目の選択ポップアップ（ボトムシートより手前に表示） */}
      {sheet === 'contact' && contactCatOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/55" onClick={() => setContactCatOpen(false)} />
          <div
            className="relative w-full max-w-md rounded-t-3xl px-5 pt-3 sm:rounded-3xl"
            style={{
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
              background: 'rgba(16,20,42,0.98)',
              border: '1px solid rgba(120,160,255,0.28)',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.5), 0 0 24px rgba(99,102,241,0.14)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}>
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />
            <h2 className="mb-3 text-[16px] font-bold" style={{ color: '#ffffff' }}>お問い合わせ項目を選択</h2>
            <div className="flex flex-col gap-2">
              {CONTACT_CATEGORIES.map((c) => {
                const active = contactCategory === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setContactCategory(c);
                      setContactError(null);
                      setContactCatOpen(false);
                    }}
                    className="flex min-h-[48px] items-center justify-between rounded-2xl px-4 text-left text-[14px] font-semibold transition active:scale-[0.98]"
                    style={
                      active
                        ? {
                            background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)',
                            color: '#ffffff',
                            boxShadow: '0 0 14px rgba(99,102,241,0.5)',
                            border: '1px solid rgba(130,165,255,0.6)',
                          }
                        : {
                            background: 'rgba(10,14,32,0.5)',
                            color: '#e6edff',
                            border: '1px solid rgba(130,165,255,0.3)',
                          }
                    }>
                    {c}
                    {active && (
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 利用規約ポップアップ（お問い合わせ画面内で確認・遷移なし） */}
      {sheet === 'contact' && contactTermsOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/55" onClick={() => setContactTermsOpen(false)} />
          <div
            className="relative flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl px-5 pt-3 sm:rounded-3xl"
            style={{
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
              background: 'rgba(16,20,42,0.98)',
              border: '1px solid rgba(120,160,255,0.28)',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.5), 0 0 24px rgba(99,102,241,0.14)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}>
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-bold" style={{ color: '#ffffff' }}>利用規約</h2>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setContactTermsOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full active:opacity-60"
                style={{ color: '#c7d2fe' }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto">
              <TermsContent />
            </div>
            <button
              type="button"
              onClick={() => setContactTermsOpen(false)}
              className="mt-4 min-h-[48px] w-full rounded-full text-[14px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 8px 24px rgba(60,120,255,0.4)' }}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {sheet === 'history' && (
        <BottomSheet
          title={selectedInquiry ? 'お問い合わせ詳細' : 'お問い合わせ履歴'}
          onClose={() => {
            setSheet(null);
            setSelectedInquiry(null);
          }}>
          {historyLoading ? (
            // 読み込み中
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span
                className="h-8 w-8 animate-spin rounded-full"
                style={{ border: '3px solid rgba(120,160,255,0.25)', borderTopColor: '#7B5FFF' }}
              />
              <p className="text-[13px]" style={{ color: '#9fb0e0' }}>読み込み中…</p>
            </div>
          ) : historyError ? (
            // 取得エラー
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(224,85,85,0.16)' }}>
                ⚠️
              </span>
              <p className="text-[14px] font-bold" style={{ color: '#ff9b9b' }}>取得に失敗しました</p>
              <p className="text-[12px]" style={{ color: '#9fb0e0' }}>{historyError}</p>
              <button
                type="button"
                onClick={() => void loadHistory()}
                className="mt-1 min-h-[44px] rounded-full px-6 text-[13px] font-bold text-white active:scale-95"
                style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 6px 18px rgba(60,120,255,0.35)' }}>
                再読み込み
              </button>
            </div>
          ) : selectedInquiry ? (
            // 詳細表示
            <>
              <button
                type="button"
                onClick={() => setSelectedInquiry(null)}
                className="mb-3 inline-flex items-center gap-1 text-[13px] font-bold active:opacity-70"
                style={{ color: '#9cc4ff' }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
                一覧へ戻る
              </button>

              <FieldGroup>
                <Field label="作成日時" value={formatInquiryDateTime(selectedInquiry.createdAt)} />
                <Field label="お問い合わせ項目" value={selectedInquiry.category || '未分類'} muted={!selectedInquiry.category} />
                <Field label="status" value={selectedInquiry.status} />
                <Field label="reply_status" value={selectedInquiry.replyStatus} />
                <Field label="添付画像" value={selectedInquiry.imageFilename || 'なし'} muted={!selectedInquiry.imageFilename} />
              </FieldGroup>

              {/* お問い合わせ内容 */}
              <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>お問い合わせ内容</p>
              <div
                className="whitespace-pre-line rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
                style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)', color: '#e6edff' }}>
                {selectedInquiry.message}
              </div>

              {/* 運営からの返信 */}
              <p className="mb-1.5 mt-4 text-[12px] font-bold" style={{ color: '#c4b5fd' }}>運営からの返信</p>
              {selectedInquiry.repliedAt && (
                <p className="mb-1.5 text-[11px]" style={{ color: '#9fb0e0' }}>
                  返信日：{formatInquiryDate(selectedInquiry.repliedAt)}
                </p>
              )}
              {selectedInquiry.adminReply ? (
                <div
                  className="whitespace-pre-line rounded-2xl px-4 py-3 text-[14px] leading-relaxed"
                  style={{ background: 'rgba(34,229,168,0.10)', border: '1px solid rgba(34,229,168,0.35)', color: '#d7ffe9' }}>
                  {selectedInquiry.adminReply}
                </div>
              ) : (
                <p
                  className="rounded-2xl px-4 py-3 text-[13px]"
                  style={{ background: 'rgba(10,14,32,0.5)', border: '1px dashed rgba(120,160,255,0.3)', color: '#9fb0e0' }}>
                  まだ返信はありません
                </p>
              )}
            </>
          ) : inquiries.length === 0 ? (
            // データなし
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(99,102,241,0.16)' }}>
                📭
              </span>
              <p className="text-[14px] font-bold" style={{ color: '#e6edff' }}>お問い合わせ履歴はありません</p>
              <p className="text-[12px]" style={{ color: '#9fb0e0' }}>
                お問い合わせを送信すると、ここに表示されます。
              </p>
            </div>
          ) : (
            // 一覧
            <div className="flex flex-col gap-2.5">
              {inquiries.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setSelectedInquiry(q)}
                  className="w-full text-left active:opacity-70">
                  <div
                    className="rounded-2xl px-4 py-3"
                    style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.22)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium" style={{ color: '#9fb0e0' }}>
                        {formatInquiryDateTime(q.createdAt)}
                      </span>
                      <div className="flex shrink-0 gap-1.5">
                        {q.adminReply && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                            style={{ background: 'rgba(34,229,168,0.2)', color: '#86efac', border: '1px solid rgba(34,229,168,0.55)' }}>
                            返信あり
                          </span>
                        )}
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={statusChipStyle(q.status)}>
                          {q.status}
                        </span>
                      </div>
                    </div>
                    <span
                      className="mt-1.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                      style={{ background: 'rgba(166,107,255,0.18)', color: '#d8b4fe', border: '1px solid rgba(166,107,255,0.4)' }}>
                      {q.category || '未分類'}
                    </span>
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed" style={{ color: '#dbe4ff' }}>
                      {q.message}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </BottomSheet>
      )}

      {sheet === 'terms' && (
        <BottomSheet title="利用規約" onClose={() => setSheet(null)}>
          <TermsContent />
        </BottomSheet>
      )}

      {sheet === 'privacy' && (
        <BottomSheet title="プライバシーポリシー" onClose={() => setSheet(null)}>
          <p className="mb-3 text-[12px] leading-relaxed" style={{ color: '#9fb0e0' }}>
            MyBrain（以下「本サービス」）における個人情報・データの取り扱いについて、以下のとおり定めます（簡易版）。
          </p>
          <div className="flex flex-col gap-4">
            {PRIVACY_SECTIONS.map((s, i) => (
              <section key={s.title}>
                <h3 className="mb-1 text-[13px] font-bold" style={{ color: '#c4b5fd' }}>
                  {i + 1}. {s.title}
                </h3>
                <div className="flex flex-col gap-1">
                  {s.lines.map((ln, j) => (
                    <p key={j} className="text-[12.5px] leading-relaxed" style={{ color: '#dbe4ff' }}>
                      {ln}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* 制定日・運営者・お問い合わせ（末尾の情報） */}
          <div
            className="mt-5 flex flex-col gap-1.5 rounded-2xl px-4 py-3.5"
            style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)' }}>
            <div className="flex items-start gap-2">
              <span className="shrink-0 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>制定日</span>
              <span className="text-[12.5px]" style={{ color: '#e6edff' }}>2026年6月</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>運営者</span>
              <span className="text-[12.5px]" style={{ color: '#e6edff' }}>MyBrain運営</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>お問い合わせ</span>
              <span className="text-[12.5px]" style={{ color: '#e6edff' }}>アプリ内お問い合わせフォーム</span>
            </div>
          </div>

          <p className="mt-4 text-[11px]" style={{ color: '#7a86b8' }}>
            ※ 本ポリシーは、サービスの改善や法令の改正等に応じて予告なく改定される場合があります。最新版は本画面でご確認いただけます。
          </p>
        </BottomSheet>
      )}
      {sheet === 'company' && (
        <BottomSheet title="会社情報" onClose={() => setSheet(null)}>
          {/* 会社情報カード（読みやすいラベル＋値・値は折り返し可） */}
          <div
            className="rounded-2xl px-4"
            style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)' }}>
            {COMPANY_INFO.map((r) => (
              <div
                key={r.label}
                className="flex items-start gap-3 border-b py-3 last:border-b-0"
                style={{ borderColor: 'rgba(120,160,255,0.14)' }}>
                <span className="w-24 shrink-0 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>{r.label}</span>
                <span className="flex-1 text-[13px] leading-relaxed" style={{ color: '#e6edff' }}>{r.value}</span>
              </div>
            ))}
          </div>

          {/* 備考 */}
          <p className="mt-3 text-[12px] leading-relaxed" style={{ color: '#9fb0e0' }}>
            <span className="font-bold" style={{ color: '#c4b5fd' }}>備考：</span>
            サービス内容・運営情報は必要に応じて更新します。
          </p>

          {/* お問い合わせフォームへ誘導 */}
          <button
            type="button"
            onClick={() => {
              closeContact(); // 念のためフォームを初期化してから
              setSheet('contact');
            }}
            className="mt-4 min-h-[48px] w-full rounded-full text-[14px] font-bold text-white active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #2E7EFF, #7B5FFF)', boxShadow: '0 8px 24px rgba(60,120,255,0.4)' }}>
            お問い合わせフォームを開く
          </button>
        </BottomSheet>
      )}

      {sheet === 'logout' && (
        <BottomSheet title="ログアウト" onClose={() => setSheet(null)}>
          <p className="text-[14px]" style={{ color: '#dbe4ff' }}>ログアウトしますか？</p>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => setSheet(null)}
              className="min-h-[48px] flex-1 rounded-full text-[14px] font-semibold"
              style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#c7d2fe', background: 'rgba(0,0,0,0.3)' }}>
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="min-h-[48px] flex-1 rounded-full text-[14px] font-bold text-white"
              style={{ backgroundColor: '#E05555' }}>
              ログアウト
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
    </>
  );
}

// ── カテゴリ行（タップで各シートを開く） ──────────────────────────
function SettingRow({
  emoji,
  title,
  desc,
  onClick,
}: {
  emoji: string;
  title: string;
  desc?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-h-[56px] items-center gap-3 px-5 py-4 text-left active:opacity-70">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px]" style={{ backgroundColor: 'rgba(99,102,241,0.16)' }}>
        {emoji}
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-[15px] font-semibold" style={{ color: '#e6edff' }}>{title}</span>
        {desc && <span className="text-[12px]" style={{ color: '#9fb0e0' }}>{desc}</span>}
      </span>
      <span className="shrink-0" style={{ color: '#9aa6e0' }}>
        <ChevronRightIcon size={18} />
      </span>
    </button>
  );
}

// グループ内の区切り線
function Divider() {
  return <div className="mx-5 h-px" style={{ background: 'rgba(120,160,255,0.12)' }} />;
}

// ── ボトムシート（下からスライドアップするダーク・グラスのモーダル） ──
function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-md overflow-y-auto rounded-t-3xl px-5 pt-3 sm:rounded-3xl"
        style={{
          maxHeight: '85vh',
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
          background: 'rgba(16,20,42,0.96)',
          border: '1px solid rgba(120,160,255,0.28)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.5), 0 0 24px rgba(99,102,241,0.14)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}>
        {/* グラバー */}
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-bold" style={{ color: '#ffffff' }}>{title}</h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            style={{ color: '#c7d2fe' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ユーザー情報セクションの行（ラベル＋任意の値ノード・横並び表示用）
function InfoRow({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 pb-3.5"
      style={last ? undefined : { borderBottom: '1px solid rgba(120,160,255,0.14)' }}>
      <span className="shrink-0 text-[13px]" style={{ color: '#9fb0e0' }}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// アカウント情報セクションの編集フィールド（ラベルを上・入力を下に置く縦並び）
function AccountField({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div
      className="flex flex-col gap-1.5 pb-3.5"
      style={last ? undefined : { borderBottom: '1px solid rgba(120,160,255,0.14)' }}>
      <span className="text-[12px] font-semibold" style={{ color: '#9fb0e0' }}>{label}</span>
      {children}
    </div>
  );
}

// シート内のラベル/値の行
function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0"
      style={{ borderColor: 'rgba(120,160,255,0.14)' }}>
      <span className="shrink-0 text-[13px]" style={{ color: '#9fb0e0' }}>{label}</span>
      <span className="truncate text-right text-[13px] font-semibold" style={{ color: muted ? '#7a86b8' : '#e6edff' }}>
        {value}
      </span>
    </div>
  );
}

// シート内のフィールドをまとめる枠
function FieldGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl px-4" style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)' }}>
      {children}
    </div>
  );
}

// 利用規約の本文（設定の「利用規約」とお問い合わせ内ポップアップで共通使用）。
function TermsContent() {
  return (
    <>
      <p className="mb-3 text-[12px] leading-relaxed" style={{ color: '#9fb0e0' }}>
        MyBrain（以下「本サービス」）のご利用にあたっての条件を、以下のとおり定めます。
      </p>
      <div className="flex flex-col gap-4">
        {TERMS_SECTIONS.map((s, i) => (
          <section key={s.title}>
            <h3 className="mb-1 text-[13px] font-bold" style={{ color: '#c4b5fd' }}>
              {i + 1}. {s.title}
            </h3>
            <div className="flex flex-col gap-1">
              {s.lines.map((ln, j) => (
                <p key={j} className="text-[12.5px] leading-relaxed" style={{ color: '#dbe4ff' }}>
                  {ln}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* 制定日・運営者・お問い合わせ（末尾の情報） */}
      <div
        className="mt-5 flex flex-col gap-1.5 rounded-2xl px-4 py-3.5"
        style={{ background: 'rgba(10,14,32,0.5)', border: '1px solid rgba(120,160,255,0.18)' }}>
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>制定日</span>
          <span className="text-[12.5px]" style={{ color: '#e6edff' }}>2026年6月</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>運営者</span>
          <span className="text-[12.5px]" style={{ color: '#e6edff' }}>MyBrain運営</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-[12px] font-bold" style={{ color: '#9fb0e0' }}>お問い合わせ</span>
          <span className="text-[12.5px]" style={{ color: '#e6edff' }}>アプリ内お問い合わせフォーム</span>
        </div>
      </div>

      <p className="mt-4 text-[11px]" style={{ color: '#7a86b8' }}>
        ※ 本規約は、サービスの改善や法令の改正等に応じて予告なく改定される場合があります。最新版は本画面でご確認いただけます。
      </p>
    </>
  );
}

// 「準備中」プレースホルダーのボトムシート
function SoonSheet({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <BottomSheet title={title} onClose={onClose}>
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full text-[26px]" style={{ background: 'rgba(99,102,241,0.16)' }}>
          🚧
        </span>
        <p className="text-[15px] font-bold" style={{ color: '#e6edff' }}>準備中</p>
        <p className="text-[12px]" style={{ color: '#9fb0e0' }}>
          この機能は現在準備中です。今後のアップデートで利用できるようになります。
        </p>
      </div>
    </BottomSheet>
  );
}
