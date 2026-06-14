import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { checkConnection, type ConnectionState } from '@/config/api';
import { isPlanEditable } from '@/services/plan';
import { getUsageRows, type UsageRow } from '@/services/usage-limits';
import { ContactSupportScreen } from '@/screens/contact-support';
import { CancelSubscriptionScreen } from '@/screens/cancel-subscription';
import { fetchSupportLinks, type SupportLinks } from '@/services/support-client';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { testAiConnectionAsync, testTaskConnectionAsync } from '@/services/ai-client';
import {
  exportSettings,
  importSettingsFromJson,
  resetAiSettings,
} from '@/services/settings-backup';
import {
  exportAllDataJson,
  exportChatCsv,
  exportMemosCsv,
  exportSchedulesCsv,
  parseDataBackup,
} from '@/services/data-backup';
import {
  importChatFromCsv,
  importMemosFromCsv,
  importSchedulesFromCsv,
} from '@/services/csv-import';
import { pickCsvFile } from '@/services/file-picker';
import {
  deleteApiKey,
  hasApiKey,
  isSecureApiKeyAvailable,
  saveApiKey,
  type ApiKeyProvider,
} from '@/services/secure-api-keys';
import {
  AI_PROVIDER_LABELS,
  CHAT_PRESET_LABELS,
  CHAT_PRESET_VALUES,
  CONNECTION_MODE_LABELS,
  DEFAULT_AI_SETTINGS,
  detectChatPreset,
  formatLastBackup,
  isBackupDue,
  LANGUAGE_LABELS,
  PLAN_LABELS,
  PLAN_MESSAGES,
  PROVIDER_LABELS,
  TRANSCRIPTION_LABELS,
  billingModeForPlan,
  loadAiSettings,
  saveAiSettings,
  type AiConnectionMode,
  type AiPlanType,
  type AiProvider,
  type AiSettings,
  type ChatReferencePreset,
  type ChatReferenceValues,
  type AiTaskProviderSettings,
  type SummaryProvider,
  type TranscriptionLanguage,
  type TranscriptionProvider,
} from '@/services/ai-settings';
import { useAppData } from '@/store/app-data';

const TopInset = Platform.OS === 'web' ? 72 : Spacing.three;

const PROVIDER_OPTIONS: SummaryProvider[] = ['mock', 'openai', 'gemini', 'claude', 'local'];
const TRANSCRIPTION_OPTIONS: TranscriptionProvider[] = [
  'mock',
  'web-speech',
  'whisper',
  'local-whisper',
];
const LANGUAGE_OPTIONS: TranscriptionLanguage[] = ['ja-JP', 'en-US', 'ko-KR', 'zh-CN'];

const PLAN_OPTIONS: AiPlanType[] = ['free', 'basic', 'standard', 'pro', 'byok', 'business'];
const CONNECTION_OPTIONS: AiConnectionMode[] = ['mock', 'backend', 'user-api-key', 'local', 'custom'];
const AI_PROVIDER_OPTIONS: AiProvider[] = ['mock', 'openai', 'anthropic', 'gemini', 'ollama', 'custom'];

const BACKUP_INTERVAL_OPTIONS = [1, 3, 7, 14, 30];

const BYOK_PROVIDERS: { key: ApiKeyProvider; label: string }[] = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'anthropic', label: 'Claude' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'custom', label: 'Custom API' },
];

// 「あとで」を押した日（当日中は再提案しない。アプリ再起動でリセット）
let backupProposalDismissedDate: string | null = null;

function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const PRESET_OPTIONS: ChatReferencePreset[] = ['minimal', 'standard', 'maximum', 'custom'];

const PRESET_DESCRIPTIONS: Record<ChatReferencePreset, string> = {
  minimal: '現在はプライバシー重視設定です。AIチャットでは会話履歴・メモ・予定を参照しません。',
  standard: '現在は標準設定です。必要に応じて直近の会話・メモ・予定を参照します。',
  maximum: '現在は回答精度重視設定です。より多くの会話・メモ・予定を参照します。',
  custom: '現在はカスタム設定です。個別に参照範囲が調整されています。',
};

type TaskKey =
  | 'summarySettings'
  | 'chatSettings'
  | 'scheduleExtractionSettings'
  | 'memoClassificationSettings';

const TASK_CARDS: { key: TaskKey; title: string }[] = [
  { key: 'summarySettings', title: '要約AI' },
  { key: 'chatSettings', title: 'チャットAI' },
  { key: 'scheduleExtractionSettings', title: '予定抽出AI' },
  { key: 'memoClassificationSettings', title: 'メモ分類AI' },
];

// Web では Alert.alert のボタンコールバックが効かないため confirm を使い分ける
function confirmReset(onConfirm: () => void) {
  const title = '全データを削除';
  const message = 'メモ・予定・チャット履歴をすべて削除し、初期状態に戻します。よろしいですか？';

  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: 'キャンセル', style: 'cancel' },
    { text: '削除する', style: 'destructive', onPress: onConfirm },
  ]);
}

// 汎用確認（Web は window.confirm）
function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'キャンセル', style: 'cancel' },
    { text: confirmLabel, onPress: onConfirm },
  ]);
}

// Web のファイル選択（内容テキストを返す。キャンセルや失敗は null）
function pickTextFileWeb(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      };
      input.click();
    } catch {
      resolve(null);
    }
  });
}

export default function SettingsScreen() {
  const { resetAllData, memos, reservations, chatMessages, importData } = useAppData();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [apiKeyNotice, setApiKeyNotice] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [dataNotice, setDataNotice] = useState<string | null>(null);

  // BYOK APIキー管理
  const [byokProvider, setByokProvider] = useState<ApiKeyProvider>('openai');
  const [byokKeyInput, setByokKeyInput] = useState('');
  const [byokNotice, setByokNotice] = useState<string | null>(null);
  const [secureAvailable, setSecureAvailable] = useState(false);
  const [byokStatus, setByokStatus] = useState<Record<ApiKeyProvider, boolean>>({
    openai: false,
    anthropic: false,
    gemini: false,
    custom: false,
  });

  useEffect(() => {
    let active = true;
    (async () => {
      const available = await isSecureApiKeyAvailable();
      if (!active) return;
      setSecureAvailable(available);
      if (available) {
        const entries = await Promise.all(
          BYOK_PROVIDERS.map(async (p) => [p.key, await hasApiKey(p.key)] as const),
        );
        if (!active) return;
        setByokStatus((prev) => {
          const next = { ...prev };
          entries.forEach(([k, v]) => {
            next[k] = v;
          });
          return next;
        });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSaveByokKey() {
    setByokNotice(null);
    const res = await saveApiKey(byokProvider, byokKeyInput);
    if (res.ok) {
      setByokKeyInput('');
      setByokStatus((prev) => ({ ...prev, [byokProvider]: true }));
      updateAi({
        apiKeyStored: true,
        apiKeyStatus: { ...aiSettings.apiKeyStatus, [byokProvider]: true },
      });
    }
    setByokNotice(res.message);
  }

  async function handleDeleteByokKey() {
    setByokNotice(null);
    const res = await deleteApiKey(byokProvider);
    if (res.ok) {
      setByokStatus((prev) => ({ ...prev, [byokProvider]: false }));
      updateAi({ apiKeyStatus: { ...aiSettings.apiKeyStatus, [byokProvider]: false } });
    }
    setByokNotice(res.message);
  }

  function byokStatusText(): string {
    if (Platform.OS === 'web') return 'Web版では保存不可';
    if (!secureAvailable) return 'SecureStore利用不可';
    return byokStatus[byokProvider] ? '保存済み' : '未保存';
  }

  // AI 設定
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  useEffect(() => {
    loadAiSettings().then((s) => {
      setAiSettings(s);
      // 自動バックアップ提案（条件を満たし、当日まだ「あとで」していない場合）
      if (isBackupDue(s) && backupProposalDismissedDate !== todayKey()) {
        // 描画後に提案（state 反映を待つ）
        setTimeout(() => proposeBackup(), 0);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateAi(partial: Partial<AiSettings>) {
    const next = { ...aiSettings, ...partial };
    setAiSettings(next);
    saveAiSettings(next);
  }

  // 詳細設定（上級者向け）の開閉。販売版では初期状態は閉じる。
  const [showAdvanced, setShowAdvanced] = useState(false);

  // プラン変更の可否（development のみ可。production/preview はロック）
  const planEditable = isPlanEditable();

  // 利用状況（プラン別の上限に対する利用回数）。本文・個人情報は含まない。
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [showUsage, setShowUsage] = useState(false);
  useEffect(() => {
    let active = true;
    getUsageRows(aiSettings.planType).then((rows) => {
      if (active) setUsageRows(rows);
    });
    return () => {
      active = false;
    };
  }, [aiSettings.planType, showUsage]);

  // 接続状態チェック（/health）。初期は未確認。
  const [connState, setConnState] = useState<'idle' | 'checking' | ConnectionState>('idle');
  async function handleCheckConnection() {
    setConnState('checking');
    try {
      const state = await checkConnection(aiSettings.backendEndpoint);
      setConnState(state);
    } catch {
      setConnState('fail');
    }
  }
  function connStateLabel(): string {
    switch (connState) {
      case 'checking':
        return '接続状態：確認中…';
      case 'ok':
        return '接続状態：確認済み';
      case 'fail':
        return '接続状態：確認できません（時間をおいてお試しください）';
      case 'unset':
        return '接続状態：未設定（販売元へお問い合わせください）';
      default:
        return '接続状態：未確認';
    }
  }

  // 契約・サポート（お問い合わせ / 解約申請 / 規約リンク）
  const [supportScreen, setSupportScreen] = useState<'contact' | 'cancel' | null>(null);
  const [supportLinks, setSupportLinks] = useState<SupportLinks>({
    termsUrl: '',
    privacyUrl: '',
    tokushohoUrl: '',
  });
  useEffect(() => {
    let active = true;
    fetchSupportLinks(aiSettings.backendEndpoint).then((links) => {
      if (active) setSupportLinks(links);
    });
    return () => {
      active = false;
    };
  }, [aiSettings.backendEndpoint]);

  async function openSupportLink(url: string, label: string) {
    const u = (url ?? '').trim();
    if (u.length === 0) {
      if (Platform.OS === 'web') window.alert(`${label}は現在準備中です。`);
      else Alert.alert(label, '現在準備中です。');
      return;
    }
    try {
      await Linking.openURL(u);
    } catch {
      if (Platform.OS === 'web') window.alert(`${label}を開けませんでした。`);
      else Alert.alert(label, 'リンクを開けませんでした。');
    }
  }

  // 契約状態の表示テキスト（LP販売前提。実課金システムが無いため案内ベース）
  function contractStatusText(): string {
    switch (aiSettings.planType) {
      case 'basic':
        return '無料プランで利用中';
      case 'byok':
        return 'ご自身のAPIキーで利用中';
      case 'business':
        return '個別契約（詳細はお問い合わせください）';
      default:
        return '有効';
    }
  }

  // 現在の参照設定値（プリセット判定用）
  const chatRefValues: ChatReferenceValues = {
    chatIncludeHistory: aiSettings.chatIncludeHistory,
    chatIncludeMemos: aiSettings.chatIncludeMemos,
    chatIncludeSchedules: aiSettings.chatIncludeSchedules,
    chatHistoryLimit: aiSettings.chatHistoryLimit,
    chatMemoLimit: aiSettings.chatMemoLimit,
    chatScheduleLimit: aiSettings.chatScheduleLimit,
  };
  const activePreset = detectChatPreset(chatRefValues);

  // プリセット適用（最小/標準/最大）
  function selectChatPreset(preset: 'minimal' | 'standard' | 'maximum') {
    updateAi({ ...CHAT_PRESET_VALUES[preset], chatReferencePreset: preset });
  }

  // 個別変更時：値を更新し、一致するプリセット（無ければ custom）を再判定して保存
  function updateChatRef(partial: Partial<ChatReferenceValues>) {
    const next: ChatReferenceValues = { ...chatRefValues, ...partial };
    updateAi({ ...partial, chatReferencePreset: detectChatPreset(next) });
  }

  // プラン変更時は課金モードも連動（接続方式は独立して選べる）
  function selectPlan(plan: AiPlanType) {
    setTestMessage(null);
    updateAi({ planType: plan, billingMode: billingModeForPlan(plan) });
  }

  // APIキー保存ボタン（今回は本保存しない）
  function handleSaveApiKey() {
    setApiKeyNotice(
      'APIキー保存はSecureStore対応後に有効化予定です。Web版では安全性のためAPIキーを保存しません。',
    );
  }

  function apiKeyStatusText(): string {
    if (aiSettings.apiKeyStored) return '保存済み';
    return '未設定（SecureStore対応後に有効化予定）';
  }

  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];

  // 機能別設定の即時更新
  const [taskTest, setTaskTest] = useState<Record<string, string | null>>({});
  function updateTask(key: TaskKey, partial: Partial<AiTaskProviderSettings>) {
    const nextTask = { ...aiSettings[key], ...partial };
    updateAi({ [key]: nextTask } as Partial<AiSettings>);
    setTaskTest((prev) => ({ ...prev, [key]: null }));
  }

  function renderToggle(
    label: string,
    description: string,
    value: boolean,
    onChange: (v: boolean) => void,
  ) {
    return (
      <ThemedView style={styles.toggleBlock}>
        <ThemedView style={styles.toggleRow}>
          <ThemedText type="small" style={styles.toggleLabel}>
            {label}
          </ThemedText>
          <Pressable onPress={() => onChange(!value)} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView
              type={value ? 'backgroundSelected' : 'backgroundElement'}
              style={[styles.chip, value && styles.chipActive]}>
              <ThemedText type="smallBold">{value ? 'ON' : 'OFF'}</ThemedText>
            </ThemedView>
          </Pressable>
        </ThemedView>
        <ThemedText type="small" themeColor="textSecondary">
          {description}
        </ThemedText>
      </ThemedView>
    );
  }

  function renderLimit(
    label: string,
    options: number[],
    value: number,
    onChange: (n: number) => void,
  ) {
    return (
      <ThemedView>
        <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
          {label}
        </ThemedText>
        <ThemedView style={styles.selectorRow}>
          {options.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                type={value === opt ? 'backgroundSelected' : 'background'}
                style={[styles.chip, value === opt && styles.chipActive]}>
                <ThemedText type="small">{opt}</ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </ThemedView>
      </ThemedView>
    );
  }

  function renderTaskCard({ key, title }: { key: TaskKey; title: string }) {
    const ts = aiSettings[key];
    return (
      <ThemedView key={key} type="background" style={styles.taskCard}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          現在：{AI_PROVIDER_LABELS[ts.provider]} / {CONNECTION_MODE_LABELS[ts.connectionMode]}
        </ThemedText>

        <Pressable
          onPress={() => updateTask(key, { enabled: !ts.enabled })}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView
            type={ts.enabled ? 'backgroundSelected' : 'backgroundElement'}
            style={[styles.chip, ts.enabled && styles.chipActive]}>
            <ThemedText type="small">{ts.enabled ? '有効 ON' : '無効 OFF'}</ThemedText>
          </ThemedView>
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
          AIプロバイダー
        </ThemedText>
        <ThemedView style={styles.selectorRow}>
          {AI_PROVIDER_OPTIONS.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => updateTask(key, { provider: opt })}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                type={ts.provider === opt ? 'backgroundSelected' : 'backgroundElement'}
                style={[styles.chip, ts.provider === opt && styles.chipActive]}>
                <ThemedText type="small">{AI_PROVIDER_LABELS[opt]}</ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
          接続方式
        </ThemedText>
        <ThemedView style={styles.selectorRow}>
          {CONNECTION_OPTIONS.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => updateTask(key, { connectionMode: opt })}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                type={ts.connectionMode === opt ? 'backgroundSelected' : 'backgroundElement'}
                style={[styles.chip, ts.connectionMode === opt && styles.chipActive]}>
                <ThemedText type="small">{CONNECTION_MODE_LABELS[opt]}</ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
          モデル名
        </ThemedText>
        <TextInput
          style={inputStyle}
          placeholder="例: gpt-4o-mini / llama3"
          placeholderTextColor={theme.textSecondary}
          value={ts.model ?? ''}
          onChangeText={(t) => updateTask(key, { model: t })}
        />

        <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
          個別エンドポイント
        </ThemedText>
        <TextInput
          style={inputStyle}
          placeholder="未入力なら全体設定を使用"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          value={ts.endpoint ?? ''}
          onChangeText={(t) => updateTask(key, { endpoint: t })}
        />

        <Pressable
          onPress={async () => {
            setTaskTest((prev) => ({ ...prev, [key]: '接続テスト中…' }));
            const msg = await testTaskConnectionAsync(ts, aiSettings);
            setTaskTest((prev) => ({ ...prev, [key]: msg }));
          }}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView style={[styles.actionBtn, styles.testBtn]}>
            <ThemedText type="smallBold" style={styles.dangerText}>
              接続テスト
            </ThemedText>
          </ThemedView>
        </Pressable>
        {taskTest[key] && (
          <ThemedText type="small" style={styles.planMessage}>
            {taskTest[key]}
          </ThemedText>
        )}
      </ThemedView>
    );
  }

  async function handleExportSettings() {
    setBackupNotice(null);
    const res = await exportSettings();
    setBackupNotice(res.message);
  }

  function handleImportSettings() {
    confirmAction(
      '設定のインポート',
      '現在の設定を読み込んだ設定で上書きしますか？APIキー本体は復元されません。',
      'インポートする',
      async () => {
        setBackupNotice(null);
        if (Platform.OS !== 'web') {
          setBackupNotice('ネイティブ版のインポートは今後対応予定です');
          return;
        }
        const raw = await pickTextFileWeb('application/json,.json');
        if (raw == null) return; // キャンセル
        const res = await importSettingsFromJson(raw);
        if (res.ok) {
          const next = await loadAiSettings();
          setAiSettings(next);
        }
        setBackupNotice(
          res.apiKeyNotice
            ? `${res.message}（APIキーの利用設定はONですが、本体は復元されていません）`
            : res.message,
        );
      },
    );
  }

  function handleResetAiSettings() {
    confirmAction(
      'AI設定の初期化',
      'AI設定を初期状態に戻しますか？メモや予定は削除されません。',
      '初期化する',
      async () => {
        setBackupNotice(null);
        const res = await resetAiSettings();
        if (res.ok) {
          const next = await loadAiSettings();
          setAiSettings(next);
        }
        setBackupNotice(res.message);
      },
    );
  }

  // ── データバックアップ ──
  // 全データJSONを出力し、成功時に lastDataBackupAt を更新（最新設定にマージして保存）
  async function performDataBackup() {
    const res = await exportAllDataJson(memos, reservations, chatMessages);
    if (!res.ok) {
      setDataNotice(res.message || 'バックアップの作成に失敗しました');
      return;
    }
    try {
      const s = await loadAiSettings();
      const next = { ...s, lastDataBackupAt: new Date().toISOString() };
      await saveAiSettings(next);
      setAiSettings(next);
    } catch {
      // 保存失敗してもエクスポート自体は成功
    }
    setDataNotice('バックアップを作成しました');
  }

  async function handleExportAllData() {
    await performDataBackup();
  }

  // 自動バックアップ提案（あとで / バックアップする）
  function proposeBackup() {
    const title = 'データバックアップ';
    const message = '前回のバックアップから時間が経っています。今すぐバックアップを作成しますか？';
    const later = () => {
      backupProposalDismissedDate = todayKey();
      setDataNotice('バックアップ提案をあとで表示します');
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) performDataBackup();
      else later();
      return;
    }
    Alert.alert(title, message, [
      { text: 'あとで', style: 'cancel', onPress: later },
      { text: 'バックアップする', onPress: performDataBackup },
    ]);
  }
  async function handleExportMemosCsv() {
    setDataNotice((await exportMemosCsv(memos)).message);
  }
  async function handleExportSchedulesCsv() {
    setDataNotice((await exportSchedulesCsv(reservations)).message);
  }
  async function handleExportChatCsv() {
    setDataNotice((await exportChatCsv(chatMessages)).message);
  }
  function handleImportData() {
    confirmAction(
      'データのインポート',
      'バックアップデータを読み込みますか？現在のメモ・予定・AIチャット履歴に追加または上書きされます。',
      'インポートする',
      async () => {
        setDataNotice(null);
        if (Platform.OS !== 'web') {
          setDataNotice('ネイティブ版のインポートは今後対応予定です');
          return;
        }
        const raw = await pickTextFileWeb('application/json,.json');
        if (raw == null) return;
        const res = parseDataBackup(raw);
        if (!res.ok || !res.data) {
          setDataNotice(res.message);
          return;
        }
        try {
          importData(res.data);
          setDataNotice('データをインポートしました');
        } catch {
          setDataNotice('データのインポートに失敗しました');
        }
      },
    );
  }

  // ── CSV インポート ──
  function importCsvFlow(
    confirmMessage: string,
    failMessage: string,
    run: (raw: string) => { ok: boolean; message?: string; counts?: string },
  ) {
    confirmAction('CSVインポート', confirmMessage, 'インポートする', async () => {
      setDataNotice(null);
      // Web=input / ネイティブ=expo-document-picker（共通関数）
      const picked = await pickCsvFile();
      if (!picked.ok || picked.text == null) {
        setDataNotice(picked.message ?? 'CSVファイルの読み込みに失敗しました');
        return;
      }
      try {
        const res = run(picked.text);
        setDataNotice(res.ok ? (res.counts ?? '') : (res.message ?? failMessage));
      } catch {
        setDataNotice(failMessage);
      }
    });
  }

  function handleImportMemosCsv() {
    importCsvFlow(
      'メモCSVをインポートしますか？同じIDのメモは上書きされます。',
      'メモCSVのインポートに失敗しました',
      (raw) => {
        const res = importMemosFromCsv(raw);
        if (!res.ok) return { ok: false, message: res.message };
        const existing = new Set(memos.map((m) => m.id));
        let added = 0;
        let updated = 0;
        res.items.forEach((it) => (existing.has(it.id) ? (updated += 1) : (added += 1)));
        importData({ memos: res.items });
        return {
          ok: true,
          counts: `メモCSVをインポートしました（追加${added}件、更新${updated}件、スキップ${res.skipped}件）`,
        };
      },
    );
  }

  function handleImportSchedulesCsv() {
    importCsvFlow(
      '予定CSVをインポートしますか？同じIDの予定は上書きされます。',
      '予定CSVのインポートに失敗しました',
      (raw) => {
        const res = importSchedulesFromCsv(raw);
        if (!res.ok) return { ok: false, message: res.message };
        const existing = new Set(reservations.map((r) => r.id));
        let added = 0;
        let updated = 0;
        res.items.forEach((it) => (existing.has(it.id) ? (updated += 1) : (added += 1)));
        importData({ reservations: res.items });
        return {
          ok: true,
          counts: `予定CSVをインポートしました（追加${added}件、更新${updated}件、スキップ${res.skipped}件）`,
        };
      },
    );
  }

  function handleImportChatCsv() {
    importCsvFlow(
      'AIチャット履歴CSVをインポートしますか？同じIDの履歴は上書きされます。',
      'AIチャット履歴CSVのインポートに失敗しました',
      (raw) => {
        const res = importChatFromCsv(raw);
        if (!res.ok) return { ok: false, message: res.message };
        const existing = new Set(chatMessages.map((c) => c.id));
        let added = 0;
        let updated = 0;
        res.items.forEach((it) => (existing.has(it.id) ? (updated += 1) : (added += 1)));
        importData({ chatMessages: res.items });
        return {
          ok: true,
          counts: `AIチャット履歴CSVをインポートしました（追加${added}件、更新${updated}件、スキップ${res.skipped}件）`,
        };
      },
    );
  }

  function handleReset() {
    confirmReset(async () => {
      setBusy(true);
      setDone(false);
      await resetAllData();
      setBusy(false);
      setDone(true);
    });
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">設定</ThemedText>

          {/* はじめての使い方 */}
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">はじめての使い方</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              1. 「メモ」タブで、思いついたことを記録します。{'\n'}
              2. 「予定」タブで、予定を登録します。{'\n'}
              3. 「AIチャット」タブで、AIに相談できます。{'\n'}
              4. AIは、登録したメモや予定を参考に回答します。{'\n'}
              5. 困ったときは、下の「契約・サポート」からお問い合わせください。
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedView style={styles.sectionHead}>
              <ThemedText type="smallBold">AIプラン設定</ThemedText>
              <ThemedView style={styles.planBadge}>
                <ThemedText type="smallBold" style={styles.planBadgeText}>
                  {PLAN_LABELS[aiSettings.planType]}
                </ThemedText>
              </ThemedView>
            </ThemedView>
            <ThemedText type="small" themeColor="textSecondary">
              ご利用プランとAIの接続方法を設定できます。
            </ThemedText>

            {/* 1. 利用プラン */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              利用プラン
            </ThemedText>
            {planEditable ? (
              // 開発時のみ：プラン切替可（テスト用）
              <ThemedView style={styles.selectorRow}>
                {PLAN_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt}
                    onPress={() => selectPlan(opt)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView
                      type={aiSettings.planType === opt ? 'backgroundSelected' : 'background'}
                      style={[styles.chip, aiSettings.planType === opt && styles.chipActive]}>
                      <ThemedText type="small">{PLAN_LABELS[opt]}</ThemedText>
                    </ThemedView>
                  </Pressable>
                ))}
              </ThemedView>
            ) : (
              // 販売版：読み取り専用。現在のプランを表示し、変更は問い合わせへ誘導
              <ThemedView style={styles.infoRow}>
                <ThemedText type="small" themeColor="textSecondary">現在のプラン</ThemedText>
                <ThemedView style={styles.planBadge}>
                  <ThemedText type="smallBold" style={styles.planBadgeText}>
                    {PLAN_LABELS[aiSettings.planType]}
                  </ThemedText>
                </ThemedView>
              </ThemedView>
            )}
            <ThemedText type="small" style={styles.planMessage}>
              {PLAN_MESSAGES[aiSettings.planType]}
            </ThemedText>
            {!planEditable && (
              <ThemedText type="small" themeColor="textSecondary">
                現在のプランは契約情報に基づいて設定されています。プラン変更をご希望の場合は、下の「契約・サポート」からお問い合わせください。
              </ThemedText>
            )}

            {/* 詳細設定（上級者向け）トグル：development のみ表示（開発者専用） */}
            {planEditable && (
              <Pressable
                onPress={() => setShowAdvanced((v) => !v)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                  <ThemedText type="smallBold">
                    {showAdvanced ? '▾ 詳細設定（上級者向け）を閉じる' : '▸ 詳細設定（上級者向け）'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            )}

            {planEditable && showAdvanced && (
              <>
            {/* 2. API利用方式 */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              API利用方式
            </ThemedText>
            <ThemedView style={styles.selectorRow}>
              {CONNECTION_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  onPress={() => {
                    setTestMessage(null);
                    updateAi({ connectionMode: opt });
                  }}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={aiSettings.connectionMode === opt ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, aiSettings.connectionMode === opt && styles.chipActive]}>
                    <ThemedText type="small">{CONNECTION_MODE_LABELS[opt]}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>

            {/* 3. AIプロバイダー */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              AIプロバイダー
            </ThemedText>
            <ThemedView style={styles.selectorRow}>
              {AI_PROVIDER_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  onPress={() => updateAi({ selectedProvider: opt })}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={aiSettings.selectedProvider === opt ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, aiSettings.selectedProvider === opt && styles.chipActive]}>
                    <ThemedText type="small">{AI_PROVIDER_LABELS[opt]}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>

            {/* 4. モデル名 */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              モデル名
            </ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="例: gpt-4o-mini / claude-3-haiku / llama3"
              placeholderTextColor={theme.textSecondary}
              value={aiSettings.selectedModel ?? ''}
              onChangeText={(t) => updateAi({ selectedModel: t })}
            />

            {/* 5. 運営APIエンドポイント */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              運営APIエンドポイント
            </ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="https://api.example.com/ai"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              value={aiSettings.backendEndpoint ?? ''}
              onChangeText={(t) => updateAi({ backendEndpoint: t })}
            />
            <ThemedText type="small" themeColor="textSecondary">
              Web確認: http://localhost:8787/api/ai{'\n'}
              実機確認: http://（PCのLAN IP）:8787/api/ai（例 http://192.168.1.10:8787/api/ai）
            </ThemedText>

            {/* 6. Custom APIエンドポイント */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              Custom APIエンドポイント
            </ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="https://your-company.example.com/ai"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              value={aiSettings.customApiEndpoint ?? ''}
              onChangeText={(t) => updateAi({ customApiEndpoint: t })}
            />

            {/* 7. ローカルAIエンドポイント */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              ローカルAIエンドポイント
            </ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="http://localhost:11434"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              value={aiSettings.localEndpoint ?? ''}
              onChangeText={(t) => updateAi({ localEndpoint: t })}
            />

            {/* 8. APIキー設定状態 */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              APIキー設定状態
            </ThemedText>
            <ThemedText type="small">{apiKeyStatusText()}</ThemedText>

            {(aiSettings.planType === 'byok' || aiSettings.connectionMode === 'user-api-key') && (
              <Pressable onPress={handleSaveApiKey} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                  <ThemedText type="smallBold">APIキーを保存（土台）</ThemedText>
                </ThemedView>
              </Pressable>
            )}
            {apiKeyNotice && (
              <ThemedText type="small" style={styles.noticeText}>
                {apiKeyNotice}
              </ThemedText>
            )}

            {/* 9. 接続テスト */}
            <Pressable
              onPress={async () => {
                setTestMessage('接続テスト中…');
                setTestMessage(await testAiConnectionAsync(aiSettings));
              }}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={[styles.actionBtn, styles.testBtn]}>
                <ThemedText type="smallBold" style={styles.dangerText}>
                  接続テスト
                </ThemedText>
              </ThemedView>
            </Pressable>
            {testMessage && (
              <ThemedText type="small" style={styles.planMessage}>
                {testMessage}
              </ThemedText>
            )}
              </>
            )}
          </ThemedView>

          {/* 利用状況（プラン上限に対する利用回数。折りたたみ） */}
          <ThemedView type="backgroundElement" style={styles.section}>
            <Pressable
              onPress={() => setShowUsage((v) => !v)}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={styles.sectionHead}>
                <ThemedText type="smallBold">利用状況</ThemedText>
                <ThemedText type="linkPrimary">{showUsage ? '閉じる' : '表示'}</ThemedText>
              </ThemedView>
            </Pressable>
            {showUsage && (
              <>
                {usageRows.map((row) => (
                  <ThemedView key={row.label} style={styles.infoRow}>
                    <ThemedText type="small" themeColor="textSecondary">{row.label}</ThemedText>
                    <ThemedText type="smallBold">
                      {row.used} / {row.limit}
                      {row.unit}
                    </ThemedText>
                  </ThemedView>
                ))}
                <ThemedText type="small" themeColor="textSecondary">
                  上限に達しても、手入力でのメモ・予定登録や保存済みデータの閲覧は引き続きご利用いただけます。
                </ThemedText>
              </>
            )}
          </ThemedView>

          {/* 契約・サポート（通常ユーザー向け：上位に表示） */}
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedView style={styles.sectionHead}>
              <ThemedText type="smallBold">契約・サポート</ThemedText>
              <ThemedView style={styles.planBadge}>
                <ThemedText type="smallBold" style={styles.planBadgeText}>
                  {PLAN_LABELS[aiSettings.planType]}
                </ThemedText>
              </ThemedView>
            </ThemedView>

            {/* 契約情報 */}
            <ThemedView style={styles.infoRow}>
              <ThemedText type="small" themeColor="textSecondary">現在のプラン</ThemedText>
              <ThemedText type="smallBold">{PLAN_LABELS[aiSettings.planType]}</ThemedText>
            </ThemedView>
            <ThemedView style={styles.infoRow}>
              <ThemedText type="small" themeColor="textSecondary">契約状態</ThemedText>
              <ThemedText type="smallBold">{contractStatusText()}</ThemedText>
            </ThemedView>
            <ThemedView style={styles.infoRow}>
              <ThemedText type="small" themeColor="textSecondary">次回更新日 / 利用期限</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">お問い合わせください</ThemedText>
            </ThemedView>

            {/* 接続状態（目立ちすぎない確認導線） */}
            <ThemedView style={styles.infoRow}>
              <ThemedText type="small" themeColor="textSecondary">{connStateLabel()}</ThemedText>
              <Pressable
                onPress={handleCheckConnection}
                disabled={connState === 'checking'}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="linkPrimary">
                  {connState === 'checking' ? '確認中…' : '接続を確認'}
                </ThemedText>
              </Pressable>
            </ThemedView>

            {/* お問い合わせ / 解約申請 */}
            <Pressable
              onPress={() => setSupportScreen('contact')}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.supportBtn}>
                <ThemedText type="smallBold">お問い合わせ</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  使い方・契約・不具合などのご相談
                </ThemedText>
              </ThemedView>
            </Pressable>

            <Pressable
              onPress={() => setSupportScreen('cancel')}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={styles.cancelBtn}>
                <ThemedText type="smallBold">解約申請</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  即時解約ではありません。管理者確認後に処理します。
                </ThemedText>
              </ThemedView>
            </Pressable>

            {/* 規約・ポリシー・特商法 */}
            <Pressable
              onPress={() => openSupportLink(supportLinks.termsUrl, '利用規約')}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={styles.linkRow}>
                <ThemedText type="small">利用規約</ThemedText>
                <ThemedText type="linkPrimary">{supportLinks.termsUrl ? '開く →' : '準備中'}</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable
              onPress={() => openSupportLink(supportLinks.privacyUrl, 'プライバシーポリシー')}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={styles.linkRow}>
                <ThemedText type="small">プライバシーポリシー</ThemedText>
                <ThemedText type="linkPrimary">{supportLinks.privacyUrl ? '開く →' : '準備中'}</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable
              onPress={() => openSupportLink(supportLinks.tokushohoUrl, '特定商取引法に基づく表記')}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={styles.linkRow}>
                <ThemedText type="small">特定商取引法に基づく表記</ThemedText>
                <ThemedText type="linkPrimary">{supportLinks.tokushohoUrl ? '開く →' : '準備中'}</ThemedText>
              </ThemedView>
            </Pressable>
          </ThemedView>

          {planEditable && showAdvanced && (
          <>
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">BYOK APIキー管理</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              APIキー本体は端末内のSecureStoreに保存されます。設定バックアップやデータバックアップには含まれません。
            </ThemedText>
            {Platform.OS === 'web' && (
              <ThemedText type="small" style={styles.noticeText}>
                Web版では安全性のためAPIキーを保存しません。ネイティブ版でのみ保存できます。
              </ThemedText>
            )}

            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              対象プロバイダー
            </ThemedText>
            <ThemedView style={styles.selectorRow}>
              {BYOK_PROVIDERS.map((p) => (
                <Pressable
                  key={p.key}
                  onPress={() => setByokProvider(p.key)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={byokProvider === p.key ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, byokProvider === p.key && styles.chipActive]}>
                    <ThemedText type="small">{p.label}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>

            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              APIキー
            </ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="APIキーを入力"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              secureTextEntry
              value={byokKeyInput}
              onChangeText={setByokKeyInput}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              保存状態：{byokStatusText()}
            </ThemedText>

            <ThemedView style={styles.formActions}>
              <Pressable onPress={handleDeleteByokKey} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundSelected" style={styles.btn}>
                  <ThemedText type="small" style={styles.dangerTextRed}>
                    保存済みAPIキーを削除
                  </ThemedText>
                </ThemedView>
              </Pressable>
              <Pressable onPress={handleSaveByokKey} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView style={[styles.btn, styles.testBtn]}>
                  <ThemedText type="smallBold" style={styles.dangerText}>
                    APIキーを保存
                  </ThemedText>
                </ThemedView>
              </Pressable>
            </ThemedView>

            {byokNotice && (
              <ThemedText type="small" style={styles.planMessage}>
                {byokNotice}
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">機能別AI設定</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              要約・チャット・予定抽出・メモ分類ごとに個別設定できます（全体設定の上書き／無効時は簡易AIで動作）。
            </ThemedText>
            {TASK_CARDS.map(renderTaskCard)}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">AIチャット参照設定</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              AIチャットでは、回答精度を高めるために、設定で許可された範囲の会話履歴・メモ・予定をAI接続先へ送信します。送信したくない情報はオフにできます。
            </ThemedText>

            {/* 参照プリセット */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              参照プリセット
            </ThemedText>
            <ThemedView style={styles.selectorRow}>
              {PRESET_OPTIONS.map((opt) => {
                const active = activePreset === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => {
                      if (opt !== 'custom') selectChatPreset(opt);
                    }}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView
                      type={active ? 'backgroundSelected' : 'background'}
                      style={[styles.chip, active && styles.chipActive]}>
                      <ThemedText type="small">{CHAT_PRESET_LABELS[opt]}</ThemedText>
                    </ThemedView>
                  </Pressable>
                );
              })}
            </ThemedView>
            <ThemedText type="small" style={styles.planMessage}>
              {PRESET_DESCRIPTIONS[activePreset]}
            </ThemedText>

            {/* 会話履歴 */}
            {renderToggle(
              '会話履歴を参照する',
              '直近の会話履歴をAIに渡して、文脈を踏まえた回答にします。',
              aiSettings.chatIncludeHistory,
              (v) => updateChatRef({ chatIncludeHistory: v }),
            )}
            {renderLimit('会話履歴の送信件数', [0, 5, 10, 20], aiSettings.chatHistoryLimit, (n) =>
              updateChatRef({ chatHistoryLimit: n }),
            )}

            {/* メモ */}
            {renderToggle(
              'メモを参照する',
              '関連するメモをAIに渡して、記録内容を踏まえた回答にします。',
              aiSettings.chatIncludeMemos,
              (v) => updateChatRef({ chatIncludeMemos: v }),
            )}
            {renderLimit('メモの送信件数', [0, 3, 5, 10], aiSettings.chatMemoLimit, (n) =>
              updateChatRef({ chatMemoLimit: n }),
            )}

            {/* 予定 */}
            {renderToggle(
              '予定を参照する',
              '直近の予定をAIに渡して、予定を踏まえた回答にします。',
              aiSettings.chatIncludeSchedules,
              (v) => updateChatRef({ chatIncludeSchedules: v }),
            )}
            {renderLimit('予定の送信件数', [0, 3, 5, 10], aiSettings.chatScheduleLimit, (n) =>
              updateChatRef({ chatScheduleLimit: n }),
            )}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">AI設定</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              使用するAI方式を選びます。現在は「簡易AI（お試し）」のみ動作し、その他は今後対応予定です。
            </ThemedText>

            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              文字起こし方式
            </ThemedText>
            <ThemedView style={styles.selectorRow}>
              {TRANSCRIPTION_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  onPress={() => updateAi({ transcriptionProvider: opt })}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={aiSettings.transcriptionProvider === opt ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, aiSettings.transcriptionProvider === opt && styles.chipActive]}>
                    <ThemedText type="small">{TRANSCRIPTION_LABELS[opt]}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>

            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              音声認識言語
            </ThemedText>
            <ThemedView style={styles.selectorRow}>
              {LANGUAGE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  onPress={() => updateAi({ transcriptionLanguage: opt })}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={aiSettings.transcriptionLanguage === opt ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, aiSettings.transcriptionLanguage === opt && styles.chipActive]}>
                    <ThemedText type="small">{LANGUAGE_LABELS[opt]}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>

            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              要約AI
            </ThemedText>
            <ThemedView style={styles.selectorRow}>
              {PROVIDER_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  onPress={() => updateAi({ summaryProvider: opt })}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={aiSettings.summaryProvider === opt ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, aiSettings.summaryProvider === opt && styles.chipActive]}>
                    <ThemedText type="small">{PROVIDER_LABELS[opt]}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>

            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              チャットAI
            </ThemedText>
            <ThemedView style={styles.selectorRow}>
              {PROVIDER_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  onPress={() => updateAi({ provider: opt })}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={aiSettings.provider === opt ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, aiSettings.provider === opt && styles.chipActive]}>
                    <ThemedText type="small">{PROVIDER_LABELS[opt]}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>
          </ThemedView>
          </>
          )}

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">設定バックアップ</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              AI接続設定・参照設定・表示設定などをバックアップできます。APIキー本体は含まれません。
            </ThemedText>

            <Pressable onPress={handleExportSettings} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">設定をエクスポート</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable onPress={handleImportSettings} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">設定をインポート</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable onPress={handleResetAiSettings} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">設定を初期化</ThemedText>
              </ThemedView>
            </Pressable>

            {backupNotice && (
              <ThemedText type="small" style={styles.planMessage}>
                {backupNotice}
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">データバックアップ</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              メモ・予定・AIチャット履歴をバックアップできます。APIキー本体は含まれません。
            </ThemedText>

            {/* 自動バックアップ提案 */}
            {renderToggle(
              '自動バックアップ提案',
              '指定した日数ごとに、データバックアップ作成を提案します。',
              aiSettings.autoBackupEnabled,
              (v) => updateAi({ autoBackupEnabled: v }),
            )}
            {renderLimit('提案間隔（日）', BACKUP_INTERVAL_OPTIONS, aiSettings.autoBackupIntervalDays, (n) =>
              updateAi({ autoBackupIntervalDays: n }),
            )}
            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              {formatLastBackup(aiSettings.lastDataBackupAt)}
            </ThemedText>
            <Pressable onPress={performDataBackup} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={[styles.actionBtn, styles.testBtn]}>
                <ThemedText type="smallBold" style={styles.dangerText}>
                  今すぐバックアップ
                </ThemedText>
              </ThemedView>
            </Pressable>

            <Pressable onPress={handleExportAllData} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">全データをJSONでエクスポート</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable onPress={handleExportMemosCsv} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">メモをCSVでエクスポート</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable onPress={handleExportSchedulesCsv} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">予定をCSVでエクスポート</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable onPress={handleExportChatCsv} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">AIチャット履歴をCSVでエクスポート</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable onPress={handleImportData} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">JSONバックアップをインポート</ThemedText>
              </ThemedView>
            </Pressable>

            <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
              CSVからメモ・予定・AIチャット履歴を取り込めます。既存データは同じIDがあれば上書き、IDがなければ追加されます。
            </ThemedText>
            <Pressable onPress={handleImportMemosCsv} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">メモCSVをインポート</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable onPress={handleImportSchedulesCsv} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">予定CSVをインポート</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable onPress={handleImportChatCsv} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionBtn}>
                <ThemedText type="smallBold">AIチャット履歴CSVをインポート</ThemedText>
              </ThemedView>
            </Pressable>

            {dataNotice && (
              <ThemedText type="small" style={styles.planMessage}>
                {dataNotice}
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">データリセット</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              保存済みのメモ・予定・チャット履歴をすべて削除し、初期サンプル状態に戻します。
              テスト用途向けの操作です。元には戻せません。
            </ThemedText>

            <Pressable
              onPress={handleReset}
              disabled={busy}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={[styles.dangerBtn, busy && styles.btnDisabled]}>
                <ThemedText type="smallBold" style={styles.dangerText}>
                  {busy ? '削除中…' : '全データを削除して初期状態に戻す'}
                </ThemedText>
              </ThemedView>
            </Pressable>

            {done && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.doneText}>
                ✓ 初期状態に戻しました。
              </ThemedText>
            )}
          </ThemedView>
        </ScrollView>

        {/* お問い合わせ / 解約申請 画面（フルスクリーン） */}
        <Modal
          visible={supportScreen !== null}
          animationType="slide"
          onRequestClose={() => setSupportScreen(null)}>
          {supportScreen === 'contact' ? (
            <ContactSupportScreen
              onClose={() => setSupportScreen(null)}
              backendEndpoint={aiSettings.backendEndpoint}
            />
          ) : null}
          {supportScreen === 'cancel' ? (
            <CancelSubscriptionScreen
              onClose={() => setSupportScreen(null)}
              planType={aiSettings.planType}
              backendEndpoint={aiSettings.backendEndpoint}
            />
          ) : null}
        </Modal>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scroll: { flex: 1, alignSelf: 'stretch' },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: TopInset,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  section: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  dangerBtn: {
    backgroundColor: '#e5484d',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  btnDisabled: { opacity: 0.5 },
  settingLabel: { marginTop: Spacing.two },
  selectorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { borderColor: '#3c87f7' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planBadge: {
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
  },
  planBadgeText: { color: '#ffffff' },
  toggleBlock: { gap: Spacing.half, marginTop: Spacing.two },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { flex: 1 },
  planMessage: { marginTop: Spacing.one },
  noticeText: { color: '#9B6400', marginTop: Spacing.one },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  actionBtn: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: Spacing.one,
  },
  testBtn: { backgroundColor: '#3c87f7' },
  taskCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  dangerText: { color: '#ffffff' },
  dangerTextRed: { color: '#e5484d' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two, marginTop: Spacing.one },
  btn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two },
  doneText: { marginTop: Spacing.one },
  pressed: { opacity: 0.6 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
  },
  supportBtn: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.half,
    marginTop: Spacing.two,
  },
  cancelBtn: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.half,
    marginTop: Spacing.two,
    borderWidth: 1,
    borderColor: '#9aa0a6',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
});
