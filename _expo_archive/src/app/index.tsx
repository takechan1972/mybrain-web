import { useRouter } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

// Web では上部にタブバー（position:absolute）があるため余白を確保
const TopInset = Platform.OS === 'web' ? 72 : Spacing.three;

interface HomeItem {
  href: string;
  emoji: string;
  title: string;
  desc: string;
  color: string;
}

// ホームに表示する4機能（高齢者でも分かりやすい大きなボタン）
const HOME_ITEMS: HomeItem[] = [
  {
    href: '/memos',
    emoji: '📝',
    title: 'メモ管理',
    desc: '音声・手入力でメモを記録します',
    color: '#3C87F7',
  },
  {
    href: '/reservations',
    emoji: '📅',
    title: '予定管理',
    desc: '音声・手入力で予定を登録します',
    color: '#34A853',
  },
  {
    href: '/consult',
    emoji: '💡',
    title: 'AI相談',
    desc: 'あなたのメモ・予定を参照して答えます',
    color: '#8B5CF6',
  },
  {
    href: '/chat',
    emoji: '🤖',
    title: 'AIチャット',
    desc: '一般的な質問・文章作成に使えます',
    color: '#F59E0B',
  },
];

export default function HomeScreen() {
  const router = useRouter();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <ThemedView style={styles.header}>
            <ThemedText type="title">AIプラ</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              使いたい機能を選んでください
            </ThemedText>
          </ThemedView>

          {HOME_ITEMS.map((item) => (
            <Pressable
              key={item.href}
              onPress={() => router.push(item.href as never)}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedView style={[styles.iconBox, { backgroundColor: item.color }]}>
                  <ThemedText style={styles.icon}>{item.emoji}</ThemedText>
                </ThemedView>
                <ThemedView style={styles.cardText}>
                  <ThemedText type="subtitle">{item.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.desc}
                  </ThemedText>
                </ThemedView>
                <ThemedText type="subtitle" themeColor="textSecondary">
                  ›
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}

          <Pressable
            onPress={() => router.push('/settings' as never)}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundSelected" style={styles.settingsBtn}>
              <ThemedText type="smallBold">⚙ 設定</ThemedText>
            </ThemedView>
          </Pressable>
        </ScrollView>
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
  header: { gap: Spacing.one, marginBottom: Spacing.two },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Spacing.four,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 28 },
  cardText: { flex: 1, gap: Spacing.half },
  settingsBtn: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
  pressed: { opacity: 0.7 },
});
