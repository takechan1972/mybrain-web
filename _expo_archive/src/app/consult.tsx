import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  chatWithAi,
  type ChatHistoryItem,
  type ChatMemoRef,
  type ChatScheduleRef,
} from '@/services/ai-client';
import { loadAiSettings } from '@/services/ai-settings';
import { checkLimit, LIMIT_MESSAGES, recordUsage } from '@/services/usage-limits';
import { useAppData, type Memo, type Reservation } from '@/store/app-data';

const TopInset = Platform.OS === 'web' ? 72 : Spacing.three;

import { detectChatPreset, PLAN_LABELS, type AiPlanType, type AiSettings } from '@/services/ai-settings';

// 設定内容に応じた案内文を生成（プリセット状態を反映）
function buildRefNote(s: AiSettings): string {
  const history = s.chatIncludeHistory !== false;
  const memos = s.chatIncludeMemos !== false;
  const schedules = s.chatIncludeSchedules !== false;

  // 実値からプリセットを判定（保存値が不整合でも正しく表示）
  const preset = detectChatPreset({
    chatIncludeHistory: s.chatIncludeHistory,
    chatIncludeMemos: s.chatIncludeMemos,
    chatIncludeSchedules: s.chatIncludeSchedules,
    chatHistoryLimit: s.chatHistoryLimit,
    chatMemoLimit: s.chatMemoLimit,
    chatScheduleLimit: s.chatScheduleLimit,
  });

  if (preset === 'minimal') {
    return 'プライバシー重視設定です。AIチャットでは会話履歴・メモ・予定を参照しません。';
  }
  if (preset === 'standard') {
    return '標準設定です。必要に応じて直近の会話・メモ・予定情報を参照します。';
  }
  if (preset === 'maximum') {
    return '回答精度重視設定です。多めの会話・メモ・予定情報を参照します。';
  }

  // custom：既存の ON/OFF 状態に応じた案内
  if (!history && !memos && !schedules) {
    return 'AIチャットでは、会話履歴・メモ・予定を参照せずに回答します。';
  }
  const refs: string[] = [];
  if (history) refs.push('会話');
  if (memos) refs.push('メモ');
  if (schedules) refs.push('予定');
  const offs: string[] = [];
  if (!history) offs.push('会話履歴');
  if (!memos) offs.push('メモ');
  if (!schedules) offs.push('予定');
  return offs.length > 0
    ? `AIチャットでは、${refs.join('・')}を参照します（${offs.join('・')}は参照しません）。`
    : `AIチャットでは、${refs.join('・')}を参照します。`;
}

function toIso(ms: number): string | undefined {
  if (!ms) return undefined;
  try {
    return new Date(ms).toISOString();
  } catch {
    return undefined;
  }
}

// 質問文との関連度を簡易スコアで算出（タイトル・本文・タグ・語句一致）
function memoRelevance(m: Memo, query: string): number {
  const qLower = query.trim().toLowerCase();
  if (qLower.length === 0) return 0;
  const hay = `${m.title} ${m.body} ${m.tags.join(' ')}`.toLowerCase();
  // 質問を区切って2文字以上の語を抽出
  const tokens = qLower.split(/[\s、,。.・！？!?\n]+/).filter((t) => t.length >= 2);
  let score = 0;
  // メモのタグ/タイトルが質問文に含まれる（人名・キーワード一致に強い）
  for (const tag of m.tags) {
    if (tag.length >= 2 && qLower.includes(tag.toLowerCase())) score += 2;
  }
  if (m.title.trim().length >= 2 && qLower.includes(m.title.toLowerCase())) score += 3;
  // 質問の語がメモに含まれる
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
  }
  return score;
}

// ユーザー入力に関連するメモを優先し、直近作成順で最大 limit 件を整形
function buildMemoRefs(memos: Memo[], query: string, limit: number): ChatMemoRef[] {
  if (limit <= 0) return [];
  const scored = memos.map((m) => ({ m, score: memoRelevance(m, query) }));
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score; // 関連度の高い順
    return b.m.createdAt - a.m.createdAt; // 同点は新しい順
  });
  return scored.slice(0, limit).map(({ m }) => ({
    id: m.id,
    title: m.title,
    content: m.body.slice(0, 500),
    tags: m.tags,
    createdAt: toIso(m.createdAt),
  }));
}

// 予定の datetime（"YYYY-MM-DD HH:mm-HH:mm"）を分解
function parseReservationDatetime(datetime: string): {
  date?: string;
  startTime?: string;
  endTime?: string;
} {
  const s = datetime.trim();
  if (s.length === 0) return {};
  const [datePart, timePart] = s.split(/[ T]/);
  const date = /^\d{4}-\d{1,2}-\d{1,2}$/.test(datePart ?? '') ? datePart : undefined;
  let startTime: string | undefined;
  let endTime: string | undefined;
  if (timePart) {
    const [start, end] = timePart.split('-');
    if (start) startTime = start;
    if (end) endTime = end;
  }
  return { date, startTime, endTime };
}

function todayKeyStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 質問文との関連度を簡易スコアで算出（タイトル/お客様名・内容・メモ・日時の語句一致）
function reservationRelevance(r: Reservation, query: string): number {
  const qLower = query.trim().toLowerCase();
  if (qLower.length === 0) return 0;
  const hay = `${r.name} ${r.content} ${r.note} ${r.datetime}`.toLowerCase();
  const tokens = qLower.split(/[\s、,。.・！？!?\n]+/).filter((t) => t.length >= 2);
  let score = 0;
  // 予約タイトル（お客様名）が質問文に含まれる → 「〇〇さんの予約」に強い
  if (r.name.trim().length >= 2 && qLower.includes(r.name.toLowerCase())) score += 3;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
  }
  return score;
}

// 質問に関連する予約を優先しつつ、近い未来の予約を最大 limit 件（最小限の情報のみ）
function buildScheduleRefs(reservations: Reservation[], query: string, limit: number): ChatScheduleRef[] {
  if (limit <= 0) return [];
  const today = todayKeyStr();
  return reservations
    .map((r) => {
      const parsed = parseReservationDatetime(r.datetime);
      const future = !parsed.date || parsed.date >= today;
      return { r, parsed, score: reservationRelevance(r, query), future };
    })
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score; // 関連度の高い順
      if (a.future !== b.future) return a.future ? -1 : 1; // 未来を優先
      return (a.r.datetime || '').localeCompare(b.r.datetime || ''); // 近い順
    })
    .slice(0, limit)
    .map(({ r, parsed }) => ({
      id: r.id,
      title: r.name,
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      description: (r.content || r.note || '').slice(0, 200), // 最小限の文字数に制限
    }));
}

export default function ConsultScreen() {
  const theme = useTheme();
  const { memos, reservations, chatMessages, appendChatMessages, newChatMessage, clearChatMessages } =
    useAppData();
  const scrollRef = useRef<ScrollView>(null);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refNote, setRefNote] = useState(
    'AI相談では、あなたのメモ・予定を参照して回答します。',
  );
  const [planType, setPlanType] = useState<AiPlanType>('basic');

  useEffect(() => {
    loadAiSettings().then((s) => {
      setRefNote(buildRefNote(s));
      setPlanType(s.planType);
    });
  }, []);

  function doClear() {
    try {
      clearChatMessages();
      setNotice('会話履歴をクリアしました。新しい相談を始められます。');
    } catch {
      setNotice('会話履歴の削除に失敗しました');
    }
  }

  // 会話履歴クリア（確認ダイアログ付き。Web は window.confirm を使用）
  function handleClearHistory() {
    const title = 'AI相談の会話履歴を削除しますか？';
    const message = 'メモや予定は削除されません。';
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) doClear();
      return;
    }
    Alert.alert(title, message, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: doClear },
    ]);
  }

  async function send() {
    const text = input.trim();
    if (text.length === 0) {
      setNotice('メッセージを入力してください');
      return;
    }

    // プラン別の1日の利用上限チェック（送信前）
    const limit = await checkLimit('aiChat');
    if (!limit.allowed) {
      setNotice(LIMIT_MESSAGES.aiChat);
      return;
    }

    setNotice(null);
    recordUsage('aiChat');
    const userMsg = newChatMessage('user', text);
    appendChatMessages([userMsg]);
    setInput('');
    setSending(true);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    try {
      const settings = await loadAiSettings();
      setRefNote(buildRefNote(settings));
      setPlanType(settings.planType);
      // 設定値（未定義・不正値は既定にフォールバック）
      const safeLimit = (v: unknown, fallback: number) =>
        typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
      const historyLimit = safeLimit(settings.chatHistoryLimit, 10);
      const memoLimit = safeLimit(settings.chatMemoLimit, 5);
      const scheduleLimit = safeLimit(settings.chatScheduleLimit, 5);

      // 会話履歴（参照ONかつ limit>0 のときのみ。空文字除外・件数制限）
      const history: ChatHistoryItem[] =
        settings.chatIncludeHistory !== false && historyLimit > 0
          ? chatMessages
              .filter((m) => m.text.trim().length > 0)
              .slice(-historyLimit)
              .map((m) => ({ role: m.role, content: m.text }))
          : [];
      // 関連メモ（参照ONのときのみ）
      const memoRefs =
        settings.chatIncludeMemos !== false ? buildMemoRefs(memos, text, memoLimit) : [];
      // 実際に質問と関連したメモのタイトル（表示用。関連度>0 のものだけ）
      const relevantTitles =
        settings.chatIncludeMemos !== false
          ? memos
              .filter((m) => memoRelevance(m, text) > 0)
              .sort((a, b) => memoRelevance(b, text) - memoRelevance(a, text) || b.createdAt - a.createdAt)
              .slice(0, memoLimit)
              .map((m) => (m.title.trim().length > 0 ? m.title : '無題のメモ'))
          : [];
      // 直近予定（参照ONのときのみ・質問関連度を考慮）
      const scheduleRefs =
        settings.chatIncludeSchedules !== false
          ? buildScheduleRefs(reservations, text, scheduleLimit)
          : [];
      // 実際に質問と関連した予約のタイトル（表示用。関連度>0 のものだけ）
      const relevantScheduleTitles =
        settings.chatIncludeSchedules !== false
          ? reservations
              .filter((r) => reservationRelevance(r, text) > 0)
              .sort(
                (a, b) =>
                  reservationRelevance(b, text) - reservationRelevance(a, text) ||
                  (a.datetime || '').localeCompare(b.datetime || ''),
              )
              .slice(0, scheduleLimit)
              .map((r) => (r.name.trim().length > 0 ? r.name : '名称未設定'))
          : [];

      // chatSettings 経由（履歴・メモ・予定をコンテキストとして渡す）
      const res = await chatWithAi(
        { message: text, history, memos: memoRefs, schedules: scheduleRefs },
        settings,
      );
      if (res.rateLimited) {
        // 上限到達は専用案内（mock応答にしない）。プラン変更も自然に案内。
        const limitText = [
          '本日の利用上限に達しました。明日以降に再度お試しいただくか、プラン変更をご検討ください。',
          'メモ・予定・チャット履歴は削除されていません。',
        ].join('\n');
        appendChatMessages([newChatMessage('assistant', limitText)]);
      } else {
        // 返答に補足（接続状況・使用モデル）を併記
        const notes: string[] = [];
        if (res.message) notes.push(res.message);
        if (res.model && res.provider && res.provider !== 'mock') {
          notes.push(`使用モデル：${res.model}`);
        }
        const replyText = notes.length > 0 ? `${res.reply}\n\n※ ${notes.join(' / ')}` : res.reply;
        appendChatMessages([
          newChatMessage('assistant', replyText, relevantTitles, relevantScheduleTitles),
        ]);
      }
    } catch {
      appendChatMessages([
        newChatMessage(
          'assistant',
          'AIからの回答を取得できませんでした。少し時間をおいて再度お試しください。',
        ),
      ]);
    } finally {
      setSending(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled">
            <ThemedView style={styles.header}>
              <ThemedView style={styles.titleRow}>
                <ThemedText type="subtitle">AI相談</ThemedText>
                <ThemedView style={styles.planBadge}>
                  <ThemedText type="smallBold" style={styles.planBadgeText}>
                    {PLAN_LABELS[planType]}
                  </ThemedText>
                </ThemedView>
              </ThemedView>
              <Pressable onPress={handleClearHistory} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundSelected" style={styles.clearBtn}>
                  <ThemedText type="smallBold">🗑 会話履歴をクリア</ThemedText>
                </ThemedView>
              </Pressable>
            </ThemedView>
            <ThemedText type="small" themeColor="textSecondary" style={styles.privacyNote}>
              {refNote}
            </ThemedText>

            {chatMessages.map((m) => (
              <ThemedView
                key={m.id}
                type={m.role === 'user' ? 'backgroundSelected' : 'backgroundElement'}
                style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.aiBubble]}>
                <ThemedText type="small" themeColor={m.role === 'user' ? 'text' : 'textSecondary'} style={styles.role}>
                  {m.role === 'user' ? 'あなた' : 'AI'}
                </ThemedText>
                <ThemedText type="default">{m.text}</ThemedText>
                {m.role === 'assistant' && m.refTitles && m.refTitles.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.refNote}>
                    参照したメモ：{m.refTitles.length}件（{m.refTitles.join('、')}）
                  </ThemedText>
                )}
                {m.role === 'assistant' && m.refScheduleTitles && m.refScheduleTitles.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.refNote}>
                    参照した予約：{m.refScheduleTitles.length}件（{m.refScheduleTitles.join('、')}）
                  </ThemedText>
                )}
              </ThemedView>
            ))}

            {sending && (
              <ThemedView
                type="backgroundElement"
                style={[styles.bubble, styles.aiBubble]}>
                <ThemedText type="small" themeColor="textSecondary">
                  AIが考え中…
                </ThemedText>
              </ThemedView>
            )}
          </ScrollView>

          {notice && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.notice}>
              {notice}
            </ThemedText>
          )}

          <ThemedView type="backgroundElement" style={styles.inputBar}>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              placeholder="メッセージを入力…"
              placeholderTextColor={theme.textSecondary}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <Pressable onPress={send} disabled={sending} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={[styles.sendBtn, sending && styles.sendBtnDisabled]}>
                <ThemedText type="smallBold" style={styles.sendText}>
                  {sending ? '送信中…' : '送信'}
                </ThemedText>
              </ThemedView>
            </Pressable>
          </ThemedView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: TopInset,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  title: { marginBottom: Spacing.two },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  clearBtn: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  planBadge: {
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.four,
  },
  planBadgeText: { color: '#ffffff' },
  privacyNote: { marginBottom: Spacing.two },
  bubble: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    maxWidth: '85%',
    gap: Spacing.half,
  },
  userBubble: { alignSelf: 'flex-end' },
  aiBubble: { alignSelf: 'flex-start' },
  role: { opacity: 0.7 },
  refNote: { marginTop: Spacing.one, opacity: 0.8 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  sendBtn: {
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: '#ffffff' },
  notice: {
    paddingHorizontal: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  pressed: { opacity: 0.6 },
});
