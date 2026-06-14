import { useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DateTimePicker } from '@/components/datetime-picker';
import {
  formatDisplay,
  nowParts,
  partsFromDateTimeString,
  partsToDateTimeString,
  type DateTimeValue,
} from '@/components/datetime-picker.shared';
import { extractScheduleTitle, parseScheduleDateTime } from '@/services/ai-client';
import { isSpeechSupported, startSpeechRecognition, type SpeechController } from '@/services/speech';
import { checkLimit, LIMIT_MESSAGES, recordUsage } from '@/services/usage-limits';
import { useAppData, type Reservation } from '@/store/app-data';

const TopInset = Platform.OS === 'web' ? 72 : Spacing.three;

// ── 日付フィルター定義 ──────────────────────────────────────────────────────

type DateFilter = 'all' | 'today' | 'tomorrow' | 'week';

const FILTERS: { key: DateFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'today', label: '今日' },
  { key: 'tomorrow', label: '明日' },
  { key: 'week', label: '今週' },
];

const EMPTY_TEXT: Record<DateFilter, string> = {
  all: '予定がありません。「＋ 新規」から追加してください。',
  today: '今日の予定はありません。',
  tomorrow: '明日の予定はありません。',
  week: '今週の予定はありません。',
};

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 予定の datetime を昇順ソート用の数値に変換。
// 空・不正な日時は Infinity（＝一番下）にする。
function sortKey(datetime: string): number {
  const s = datetime.trim();
  if (s.length === 0) return Infinity;
  // "2026-06-06 10:00" を ISO 形式に寄せてパース（時刻も考慮）
  const t = new Date(s.replace(' ', 'T')).getTime();
  return Number.isNaN(t) ? Infinity : t;
}

// 予定の datetime（例: "2026-06-06 10:00"）から日付部分を YYYY-MM-DD に正規化
function dateKeyOf(datetime: string): string | null {
  const datePart = datetime.trim().split(/[ T]/)[0];
  const d = new Date(datePart);
  if (Number.isNaN(d.getTime())) return null;
  return ymd(d);
}

// 今週の月曜〜日曜の YYYY-MM-DD 範囲を返す
function currentWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay(); // 0=日, 1=月, ... 6=土
  const diffToMonday = day === 0 ? -6 : 1 - day; // 日曜は前週の月曜ではなく当週の月曜へ
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: ymd(monday), end: ymd(sunday) };
}

export default function ReservationScreen() {
  const theme = useTheme();
  const { reservations, addReservation, updateReservation, deleteReservation } = useAppData();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  // 日時は 年/月/日/時/分 の選択式（共通コンポーネント）
  const [dt, setDt] = useState<DateTimeValue>(nowParts());
  const [note, setNote] = useState('');
  // 通知ON/OFF
  const [notifyOn, setNotifyOn] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  // 入力方法（手入力／音声で入力）と音声入力の状態
  const [resInputMode, setResInputMode] = useState<'manual' | 'voice'>('manual');
  const [resListening, setResListening] = useState(false);
  const [resVoiceNotice, setResVoiceNotice] = useState<string | null>(null);
  const resSpeechRef = useRef<SpeechController | null>(null);
  const resTextRef = useRef('');
  // 実音声認識が使えるか（Web=Web Speech / 端末=expo-speech-recognition）
  const speechSupported = isSpeechSupported();
  // デバッグ：利用中の音声認識方式
  const speechMode = Platform.OS === 'web'
    ? (speechSupported ? 'web-speech' : 'mock')
    : (speechSupported ? 'native-speech' : 'mock');

  // 日付フィルターで絞り込み → 日時の昇順にソートした予定一覧
  const visibleReservations = useMemo(() => {
    let filtered: Reservation[];

    if (dateFilter === 'today') {
      const key = ymd(new Date());
      filtered = reservations.filter((r) => dateKeyOf(r.datetime) === key);
    } else if (dateFilter === 'tomorrow') {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      const key = ymd(t);
      filtered = reservations.filter((r) => dateKeyOf(r.datetime) === key);
    } else if (dateFilter === 'week') {
      // 今週の月曜〜日曜
      const { start, end } = currentWeekRange();
      filtered = reservations.filter((r) => {
        const k = dateKeyOf(r.datetime);
        return k !== null && k >= start && k <= end;
      });
    } else {
      filtered = reservations; // all
    }

    // 元配列を壊さないようコピーしてから昇順ソート（空・不正日時は最下部）
    return [...filtered].sort((a, b) => sortKey(a.datetime) - sortKey(b.datetime));
  }, [reservations, dateFilter]);

  // ソート済み一覧を日付ごとにグループ化（順序は維持）。
  // 日付なし・不正日付は末尾の「日付未設定」グループにまとめる。
  // ── 音声入力（共通API：Web=Web Speech / iOS・Android=expo-speech-recognition）──
  function stopResVoice() {
    resSpeechRef.current?.stop();
    resSpeechRef.current = null;
    setResListening(false);
  }

  function setResMode(mode: 'manual' | 'voice') {
    setResVoiceNotice(null);
    if (mode === 'manual') stopResVoice();
    if (mode === 'voice' && !isSpeechSupported()) {
      setResVoiceNotice('この環境では音声入力に対応していません。手入力をご利用ください。');
      setResInputMode('manual');
      return;
    }
    setResInputMode(mode);
  }

  // ひとことで予定入力（例：「明日の15時に歯医者」）。
  // 停止後にタイトル・日時・内容を自動抽出してフォームへ反映する。
  async function startResVoice() {
    setResVoiceNotice(null);
    if (!isSpeechSupported()) {
      setResVoiceNotice('この環境では音声入力に対応していません。手入力をご利用ください。');
      setResInputMode('manual');
      return;
    }
    const limit = await checkLimit('reservationVoiceInput');
    if (!limit.allowed) {
      setResVoiceNotice(LIMIT_MESSAGES.voiceInput);
      return;
    }
    stopResVoice();
    resTextRef.current = '';

    const controller = startSpeechRecognition({
      lang: 'ja-JP',
      onResult: (text) => {
        // 認識中は内容欄に反映（停止時にタイトル・日時を抽出）
        resTextRef.current = text;
        setNote(text);
      },
      onError: () => {
        setResVoiceNotice('文字起こしに失敗しました。もう一度お試しください。');
        setResListening(false);
      },
      onEnd: () => {
        setResListening(false);
        const t = resTextRef.current.trim();
        if (t.length === 0) {
          setResVoiceNotice('音声を認識できませんでした。もう一度お試しください。');
          return;
        }
        // タイトル＝日時表現を除いた本文、内容＝全文
        setName(extractScheduleTitle(t));
        setNote(t);
        // 日時を自然文から抽出（明日／来週月曜／6月20日14時／明後日午前10時 等）
        const r = parseScheduleDateTime(t);
        if (r.ok) {
          const parsed = partsFromDateTimeString(r.datetime);
          if (parsed) setDt(parsed);
          setResVoiceNotice(null);
        } else {
          setResVoiceNotice('日時を認識できませんでした。手動で日時を選択してください。');
        }
      },
    });
    if (!controller) {
      setResVoiceNotice('この環境では音声入力に対応していません。手入力をご利用ください。');
      setResInputMode('manual');
      return;
    }
    resSpeechRef.current = controller;
    setResListening(true);
    recordUsage('reservationVoiceInput');
  }

  function openNew() {
    setEditingId(null);
    setName('');
    setDt(nowParts());
    setNote('');
    setNotifyOn(false);
    stopResVoice();
    setResInputMode('manual');
    setResVoiceNotice(null);
    setFormOpen(true);
  }

  // 音声入力で新規作成（フォームを音声モードで開く）
  function openVoiceNew() {
    setEditingId(null);
    setName('');
    setDt(nowParts());
    setNote('');
    setNotifyOn(false);
    stopResVoice();
    setResVoiceNotice(null);
    setFormOpen(true);
    // 実音声認識が使えない環境では手入力にフォールバックし案内
    if (!speechSupported) {
      setResInputMode('manual');
      setResVoiceNotice('この環境では音声認識に対応していません。手入力をご利用ください。');
      return;
    }
    setResInputMode('voice');
  }

  function openEdit(r: Reservation) {
    setEditingId(r.id);
    setName(r.name);
    setDt(partsFromDateTimeString(r.datetime) ?? nowParts());
    // 旧「内容」欄のデータはメモ欄に統合して表示・編集できるようにする
    const merged = [r.note, r.content].map((s) => (s ?? '').trim()).filter((s) => s.length > 0).join('\n');
    setNote(merged);
    setNotifyOn(r.notificationEnabled ?? false);
    stopResVoice();
    setResInputMode('manual');
    setResVoiceNotice(null);
    setFormOpen(true);
  }

  function closeForm() {
    stopResVoice();
    setFormOpen(false);
  }

  // 削除は誤操作防止のため確認してから実行（Webはwindow.confirm）
  function confirmDeleteReservation(r: Reservation) {
    const title = 'この予定を削除しますか？';
    const message = `「${r.name || '名称未設定'}」を削除します。元に戻せません。`;
    const doDelete = () => deleteReservation(r.id);
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) doDelete();
      return;
    }
    Alert.alert(title, message, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: doDelete },
    ]);
  }

  function save() {
    const input = {
      name: name.trim() || '名称未設定',
      datetime: partsToDateTimeString(dt),
      content: '', // 「内容」欄は廃止（メモ欄に統合）
      note: note.trim(),
      notificationEnabled: notifyOn,
    };
    if (editingId) {
      updateReservation(editingId, input);
    } else {
      addReservation(input);
    }
    closeForm();
  }

  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <ThemedView style={styles.header}>
            <ThemedText type="subtitle">予定</ThemedText>
            {!formOpen && (
              <ThemedView style={styles.headerActions}>
                <Pressable onPress={openVoiceNew} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundSelected" style={styles.addBtn}>
                    <ThemedText type="smallBold">🎤 音声で予定入力</ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable onPress={openNew} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundSelected" style={styles.addBtn}>
                    <ThemedText type="smallBold">✍️ 手入力</ThemedText>
                  </ThemedView>
                </Pressable>
              </ThemedView>
            )}
          </ThemedView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}>
            {FILTERS.map((f) => {
              const active = dateFilter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setDateFilter(f.key)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={active ? 'backgroundSelected' : 'backgroundElement'}
                    style={[styles.filterChip, active && styles.filterChipActive]}>
                    <ThemedText type="smallBold" themeColor={active ? 'text' : 'textSecondary'}>
                      {f.label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ScrollView>

          {formOpen && (
            <ThemedView type="backgroundElement" style={styles.form}>
              <ThemedText type="smallBold">{editingId ? '予定を編集' : '新規予定'}</ThemedText>

              {/* 入力方法の選択 */}
              <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                入力方法を選択
              </ThemedText>
              <ThemedView style={styles.selectorRow}>
                <Pressable onPress={() => setResMode('voice')} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={resInputMode === 'voice' ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, resInputMode === 'voice' && styles.chipActive]}>
                    <ThemedText type="small">🎤 音声で入力</ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable onPress={() => setResMode('manual')} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={resInputMode === 'manual' ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, resInputMode === 'manual' && styles.chipActive]}>
                    <ThemedText type="small">⌨ 手入力</ThemedText>
                  </ThemedView>
                </Pressable>
              </ThemedView>

              {!speechSupported && (
                <ThemedText type="small" style={styles.noticeText}>
                  ※ この環境では本物の音声認識（{speechMode}）に対応していません。手入力をご利用ください。
                </ThemedText>
              )}

              {resInputMode === 'voice' && (
                <ThemedView style={styles.voicePanel}>
                  <ThemedText type="small" themeColor="textSecondary">
                    例：「明日の15時に歯医者」のように話してください。停止すると、タイトル・日時・内容を自動で振り分けます（後から修正できます）。
                  </ThemedText>
                  <Pressable
                    onPress={() => (resListening ? stopResVoice() : startResVoice())}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView style={[styles.voiceBtn, resListening && styles.listeningBtn]}>
                      <ThemedText type="smallBold" style={resListening ? styles.btnLight : undefined}>
                        {resListening ? '🔴 録音中（停止ボタンを押すまで継続）' : '🎙 話す（タップで録音開始）'}
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                </ThemedView>
              )}

              {resVoiceNotice && (
                <ThemedText type="small" style={styles.noticeText}>
                  {resVoiceNotice}
                </ThemedText>
              )}

              <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                予定タイトル
              </ThemedText>
              <TextInput
                style={inputStyle}
                placeholder="予定タイトル（例: 山田様 カット）"
                placeholderTextColor={theme.textSecondary}
                value={name}
                onChangeText={setName}
              />

              {/* 日時（選択式：年/月/日/時/分・共通コンポーネント） */}
              <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                日時
              </ThemedText>
              <DateTimePicker value={dt} onChange={setDt} />

              <ThemedText type="small" themeColor="textSecondary" style={styles.settingLabel}>
                メモ
              </ThemedText>
              <TextInput
                style={[inputStyle, styles.multiline]}
                placeholder="メモ欄"
                placeholderTextColor={theme.textSecondary}
                value={note}
                onChangeText={setNote}
                multiline
              />

              {/* 通知ON/OFF */}
              <Pressable onPress={() => setNotifyOn((v) => !v)} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView
                  type={notifyOn ? 'backgroundSelected' : 'background'}
                  style={[styles.chip, notifyOn && styles.chipActive]}>
                  <ThemedText type="small">{notifyOn ? '🔔 通知 ON' : '🔕 通知 OFF'}</ThemedText>
                </ThemedView>
              </Pressable>

              <ThemedView style={styles.formActions}>
                <Pressable onPress={closeForm} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundSelected" style={styles.btn}>
                    <ThemedText type="small">キャンセル</ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable onPress={save} style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView style={[styles.btn, styles.primaryBtn]}>
                    <ThemedText type="smallBold" style={styles.primaryBtnText}>
                      保存
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          {visibleReservations.length === 0 && !formOpen && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {EMPTY_TEXT[dateFilter]}
            </ThemedText>
          )}

          {/* 日時＋予定タイトルの1行表示（1予定1行） */}
          {visibleReservations.map((r) => {
            const parsed = partsFromDateTimeString(r.datetime);
            const when = parsed ? formatDisplay(parsed) : '日時未設定';
            // 2行目：内容（メモ）の一部
            const detail = [r.note, r.content].map((s) => (s ?? '').trim()).filter((s) => s.length > 0).join(' ');
            return (
              <ThemedView key={r.id} type="backgroundElement" style={styles.card}>
                {/* 1行目：日時＋タイトル＋操作 */}
                <ThemedView style={styles.cardHead}>
                  <ThemedText type="small" style={styles.rowWhen}>
                    {when}
                  </ThemedText>
                  <ThemedText type="smallBold" style={styles.rowTitle} numberOfLines={1}>
                    {r.name}
                  </ThemedText>
                  <Pressable onPress={() => openEdit(r)} style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedText type="link" themeColor="text">編集</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDeleteReservation(r)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedText type="link" style={styles.deleteText}>削除</ThemedText>
                  </Pressable>
                </ThemedView>
                {/* 2行目：内容の一部 */}
                {detail.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {detail}
                  </ThemedText>
                )}
              </ThemedView>
            );
          })}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', gap: Spacing.two },
  addBtn: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: Spacing.three },
  filterRow: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.half },
  filterChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipActive: { borderColor: '#3c87f7' },
  form: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  settingLabel: { marginTop: Spacing.one },
  selectorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { borderColor: '#3c87f7' },
  voicePanel: { gap: Spacing.two, marginTop: Spacing.one },
  voiceBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#E0E1E6',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  listeningBtn: { backgroundColor: '#E5484D' },
  btnLight: { color: '#ffffff' },
  noticeText: { color: '#9B6400' },
  dtRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dtLabel: { width: 24 },
  dtChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowWhen: { width: 120 },
  rowTitle: { flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  btn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two },
  primaryBtn: { backgroundColor: '#3c87f7' },
  primaryBtnText: { color: '#ffffff' },
  empty: { textAlign: 'center', paddingVertical: Spacing.four },
  group: { gap: Spacing.two },
  groupHeading: { paddingHorizontal: Spacing.half },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  tag: { paddingVertical: Spacing.half, paddingHorizontal: Spacing.two, borderRadius: Spacing.two },
  cardActions: { flexDirection: 'row', gap: Spacing.four, marginTop: Spacing.half },
  deleteText: { color: '#e5484d' },
  pressed: { opacity: 0.6 },
});
