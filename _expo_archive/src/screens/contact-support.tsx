import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  formatReceiptTime,
  submitContact,
  SUPPORT_CATEGORIES,
  type ContactInput,
  type SupportCategoryOption,
} from '@/services/support-client';

const MAX_SUBJECT = 200;
const MAX_MESSAGE = 2000;

type Props = {
  onClose: () => void;
  backendEndpoint?: string;
};

/** お問い合わせ画面（ContactSupportScreen）。 */
export function ContactSupportScreen({ onClose, backendEndpoint }: Props) {
  const theme = useTheme();
  const inputStyle = [styles.input, { borderColor: theme.backgroundSelected, color: theme.text }];

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<SupportCategoryOption['key']>('usage');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ requestId?: string; createdAt?: string } | null>(null);

  function validate(): string | null {
    const e = email.trim();
    if (e.length === 0) return 'メールアドレスを入力してください';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'メールアドレスの形式をご確認ください';
    if (subject.trim().length === 0) return '件名を入力してください';
    if (message.trim().length === 0) return '内容を入力してください';
    if (message.trim().length < 10) return '内容は10文字以上で入力してください';
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
      const input: ContactInput = {
        name: name.trim(),
        email: email.trim(),
        category,
        subject: subject.trim(),
        message: message.trim(),
      };
      const res = await submitContact(input, backendEndpoint);
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
              <ThemedText type="smallBold">お問い合わせを受け付けました</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                内容を確認のうえ、登録メールアドレス宛にご連絡します。通常1〜3営業日以内に返信します。
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
          <ThemedText type="subtitle">お問い合わせ</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ご質問・ご要望をお送りください。内容を確認のうえ、登録メールアドレス宛にご連絡します。
          </ThemedText>

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
              お問い合わせ種別
            </ThemedText>
            <ThemedView style={styles.chipRow}>
              {SUPPORT_CATEGORIES.map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => setCategory(opt.key)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={category === opt.key ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, category === opt.key && styles.chipActive]}>
                    <ThemedText type="small">{opt.label}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              件名（必須）
            </ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="例：メモの使い方について"
              placeholderTextColor={theme.textSecondary}
              value={subject}
              onChangeText={setSubject}
              maxLength={MAX_SUBJECT}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
              内容（必須・10文字以上）
            </ThemedText>
            <TextInput
              style={[inputStyle, styles.textarea]}
              placeholder="お問い合わせ内容をご記入ください。"
              placeholderTextColor={theme.textSecondary}
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={MAX_MESSAGE}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {message.length} / {MAX_MESSAGE} 文字
            </ThemedText>

            {error ? (
              <ThemedText type="small" style={styles.errorText}>
                {error}
              </ThemedText>
            ) : null}

            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                style={[styles.primaryBtn, styles.primaryBtnBg, submitting && styles.btnDisabled]}>
                <ThemedText type="smallBold" style={styles.primaryBtnText}>
                  {submitting ? '送信中…' : 'お問い合わせを送信'}
                </ThemedText>
              </ThemedView>
            </Pressable>

            <ThemedText type="small" themeColor="textSecondary">
              ※ 入力いただいた内容のみを送信します。APIキーやアプリ内のメモ・AI会話の全文は送信しません。
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
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  textarea: { minHeight: 120, textAlignVertical: 'top' },
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
