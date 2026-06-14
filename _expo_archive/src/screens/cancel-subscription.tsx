import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PLAN_LABELS, type AiPlanType } from '@/services/ai-settings';
import {
  CANCEL_REASONS,
  formatReceiptTime,
  submitCancel,
  type CancelInput,
  type CancelReasonOption,
} from '@/services/support-client';

const MAX_DETAIL = 1000;
const ACK_TEXT =
  '解約申請を送信しても即時解約ではなく、管理者確認後に処理されることを理解しました';

type Props = {
  onClose: () => void;
  planType: AiPlanType;
  backendEndpoint?: string;
};

/** 解約申請画面（CancelSubscriptionScreen）。 */
export function CancelSubscriptionScreen({ onClose, planType, backendEndpoint }: Props) {
  const theme = useTheme();
  const inputStyle = [styles.input, { borderColor: theme.backgroundSelected, color: theme.text }];

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [desiredDate, setDesiredDate] = useState('');
  const [reason, setReason] = useState<CancelReasonOption['key'] | null>(null);
  const [detail, setDetail] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ requestId?: string; createdAt?: string } | null>(null);

  function validate(): string | null {
    const e = email.trim();
    if (e.length === 0) return 'メールアドレスを入力してください';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'メールアドレスの形式をご確認ください';
    if (!reason) return '解約理由を選択してください';
    if (!acknowledged) return '確認事項にチェックしてください';
    return null;
  }

  async function handleSubmit() {
    if (submitting) return; // 二重送信防止
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const input: CancelInput = {
        name: name.trim(),
        email: email.trim(),
        planType,
        desiredCancelDate: desiredDate.trim(),
        reason: reason as CancelReasonOption['key'],
        detail: detail.trim(),
        acknowledged,
      };
      const res = await submitCancel(input, backendEndpoint);
      if (res.ok) {
        setDone({ requestId: res.requestId, createdAt: res.createdAt });
      } else {
        setError(res.message ?? '送信に失敗しました。時間をおいて再度お試しください。');
      }
    } catch {
      setError('送信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.content}>
            <ThemedText type="subtitle">送信完了</ThemedText>
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">解約申請を受け付けました</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                確認後、契約状況に応じて解約処理を行い、登録メールアドレス宛にご連絡します。
                現在の契約状態は処理完了まで維持されます。
              </ThemedText>
              {done.requestId ? (
                <ThemedText type="small" style={styles.receipt}>
                  受付番号：{done.requestId}
                </ThemedText>
              ) : null}
              {done.createdAt ? (
                <ThemedText type="small" themeColor="textSecondary">
                  送信日時：{formatReceiptTime(done.createdAt)}
                </ThemedText>
              ) : null}
            </ThemedView>
            <Pressable onPress={onClose} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={[styles.primaryBtn, styles.primaryBtnBg]}>
                <ThemedText type="smallBold" style={styles.primaryBtnText}>
                  設定に戻る
                </ThemedText>
              </ThemedView>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedView style={styles.header}>
            <Pressable onPress={onClose} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="linkPrimary">← 戻る</ThemedText>
            </Pressable>
          </ThemedView>
          <ThemedText type="subtitle">解約申請</ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary">
              この画面から解約申請を送信できます。{'\n'}
              送信後、管理者が内容を確認し、契約状況に応じて解約処理を行います。{'\n'}
              解約申請を送信しても、即時にアカウントやデータは削除されません。{'\n'}
              解約処理完了までは現在の契約状態が維持されます。
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary">お名前（任意）</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="例：山田 太郎"
              placeholderTextColor={theme.textSecondary}
              value={name}
              onChangeText={setName}
              maxLength={100}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              メールアドレス（必須）
            </ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="example@email.com"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              maxLength={254}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              現在のプラン
            </ThemedText>
            <ThemedView style={styles.planBadge}>
              <ThemedText type="smallBold" style={styles.planBadgeText}>
                {PLAN_LABELS[planType]}
              </ThemedText>
            </ThemedView>

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              解約希望日（任意・例 2026-07-01）
            </ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              value={desiredDate}
              onChangeText={setDesiredDate}
              maxLength={20}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              解約理由（必須）
            </ThemedText>
            <ThemedView style={styles.chipRow}>
              {CANCEL_REASONS.map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => setReason(opt.key)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={reason === opt.key ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, reason === opt.key && styles.chipActive]}>
                    <ThemedText type="small">{opt.label}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              詳細理由（任意）
            </ThemedText>
            <TextInput
              style={[inputStyle, styles.textarea]}
              placeholder="差し支えなければ、詳しい理由をお聞かせください。"
              placeholderTextColor={theme.textSecondary}
              value={detail}
              onChangeText={setDetail}
              multiline
              maxLength={MAX_DETAIL}
            />

            <Pressable
              onPress={() => setAcknowledged((p) => !p)}
              style={({ pressed }) => [styles.ackRow, pressed && styles.pressed]}>
              <ThemedView
                type={acknowledged ? 'backgroundSelected' : 'background'}
                style={[styles.checkbox, acknowledged && styles.checkboxOn]}>
                <ThemedText type="smallBold">{acknowledged ? '✓' : ''}</ThemedText>
              </ThemedView>
              <ThemedText type="small" style={styles.ackText}>
                {ACK_TEXT}
              </ThemedText>
            </Pressable>

            {error ? (
              <ThemedText type="small" style={styles.errorText}>
                {error}
              </ThemedText>
            ) : null}

            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView style={[styles.primaryBtn, styles.primaryBtnBg, submitting && styles.btnDisabled]}>
                <ThemedText type="smallBold" style={styles.primaryBtnText}>
                  {submitting ? '送信中…' : '解約申請を送信'}
                </ThemedText>
              </ThemedView>
            </Pressable>

            <ThemedText type="small" themeColor="textSecondary">
              ※ 送信しても即時解約・即時データ削除は行われません。管理者確認後に処理します。
            </ThemedText>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.five },
  header: { flexDirection: 'row', alignItems: 'center' },
  section: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  label: { marginTop: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { borderColor: '#3c87f7' },
  planBadge: {
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    alignSelf: 'flex-start',
  },
  planBadgeText: { color: '#ffffff' },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: Spacing.one,
    borderWidth: 1,
    borderColor: '#3c87f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: '#3c87f7' },
  ackText: { flex: 1 },
  primaryBtn: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  primaryBtnBg: { backgroundColor: '#3c87f7' },
  primaryBtnText: { color: '#ffffff' },
  btnDisabled: { opacity: 0.5 },
  errorText: { color: '#e5484d', marginTop: Spacing.one },
  receipt: { marginTop: Spacing.one, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
