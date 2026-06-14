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
import { chatWithAi, type ChatHistoryItem } from '@/services/ai-client';
import { loadAiSettings } from '@/services/ai-settings';
import { PLAN_LABELS, type AiPlanType } from '@/services/ai-settings';
import { checkLimit, LIMIT_MESSAGES, recordUsage } from '@/services/usage-limits';
import { useAppData } from '@/store/app-data';

const TopInset = Platform.OS === 'web' ? 72 : Spacing.three;

/**
 * AIチャット（通常チャット）。
 * 一般知識・文章作成・アイデア出しなどに利用する。
 * メモ・予定は参照しない（参照するのは「AI相談」画面）。
 * 会話履歴は AI相談とは別ストア（generalChatMessages）で管理する。
 */
export default function ChatScreen() {
  const theme = useTheme();
  const {
    generalChatMessages,
    appendGeneralChatMessages,
    newChatMessage,
    clearGeneralChatMessages,
  } = useAppData();
  const scrollRef = useRef<ScrollView>(null);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [planType, setPlanType] = useState<AiPlanType>('basic');

  useEffect(() => {
    loadAiSettings().then((s) => setPlanType(s.planType));
  }, []);

  function doClear() {
    try {
      clearGeneralChatMessages();
      setNotice('会話履歴をクリアしました。');
    } catch {
      setNotice('会話履歴の削除に失敗しました');
    }
  }

  function handleClearHistory() {
    const title = 'AIチャットの会話履歴を削除しますか？';
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

    const limit = await checkLimit('aiChat');
    if (!limit.allowed) {
      setNotice(LIMIT_MESSAGES.aiChat);
      return;
    }

    setNotice(null);
    recordUsage('aiChat');
    const userMsg = newChatMessage('user', text);
    appendGeneralChatMessages([userMsg]);
    setInput('');
    setSending(true);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    try {
      const settings = await loadAiSettings();
      setPlanType(settings.planType);

      // 通常チャット：会話の流れを保つため直近の会話履歴のみ渡す（メモ・予定は渡さない）
      const history: ChatHistoryItem[] = generalChatMessages
        .filter((m) => m.text.trim().length > 0)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.text }));

      // メモ・予定は明示的に空（参照しない）
      const res = await chatWithAi({ message: text, history, memos: [], schedules: [] }, settings);
      if (res.rateLimited) {
        const limitText = [
          '本日の利用上限に達しました。明日以降に再度お試しいただくか、プラン変更をご検討ください。',
          'メモ・予定・チャット履歴は削除されていません。',
        ].join('\n');
        appendGeneralChatMessages([newChatMessage('assistant', limitText)]);
      } else {
        const notes: string[] = [];
        if (res.message) notes.push(res.message);
        if (res.model && res.provider && res.provider !== 'mock') {
          notes.push(`使用モデル：${res.model}`);
        }
        const replyText = notes.length > 0 ? `${res.reply}\n\n※ ${notes.join(' / ')}` : res.reply;
        appendGeneralChatMessages([newChatMessage('assistant', replyText)]);
      }
    } catch {
      appendGeneralChatMessages([
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
                <ThemedText type="subtitle">AIチャット</ThemedText>
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
              一般的な質問・文章作成・アイデア出しなどにお使いください。メモや予定は参照しません（参照は「AI相談」をご利用ください）。
            </ThemedText>

            {generalChatMessages.map((m) => (
              <ThemedView
                key={m.id}
                type={m.role === 'user' ? 'backgroundSelected' : 'backgroundElement'}
                style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.aiBubble]}>
                <ThemedText type="small" themeColor={m.role === 'user' ? 'text' : 'textSecondary'} style={styles.role}>
                  {m.role === 'user' ? 'あなた' : 'AI'}
                </ThemedText>
                <ThemedText type="default">{m.text}</ThemedText>
              </ThemedView>
            ))}

            {sending && (
              <ThemedView type="backgroundElement" style={[styles.bubble, styles.aiBubble]}>
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
