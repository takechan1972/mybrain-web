import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  clampParts,
  dayOptions,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  MONTH_OPTIONS,
  yearOptions,
  type DateTimeValue,
} from './datetime-picker.shared';

/**
 * 日時選択UI（iOS/Android ネイティブ版）。
 * 年/月/日/時/分を横スクロールの選択チップで選ぶ（キーボード入力不要）。
 * 月末日補正は clampParts で内部処理。
 */

interface Props {
  value: DateTimeValue;
  onChange: (v: DateTimeValue) => void;
}

export function DateTimePicker({ value, onChange }: Props) {
  function update(partial: Partial<DateTimeValue>) {
    onChange(clampParts({ ...value, ...partial }));
  }

  const rows: { label: string; options: number[]; selected: number; key: keyof DateTimeValue; pad: boolean }[] = [
    { label: '年', options: yearOptions(), selected: value.year, key: 'year', pad: false },
    { label: '月', options: MONTH_OPTIONS, selected: value.month, key: 'month', pad: false },
    { label: '日', options: dayOptions(value.year, value.month), selected: value.day, key: 'day', pad: false },
    { label: '時', options: HOUR_OPTIONS, selected: value.hour, key: 'hour', pad: true },
    { label: '分', options: MINUTE_OPTIONS, selected: value.minute, key: 'minute', pad: true },
  ];

  return (
    <ThemedView style={styles.container}>
      {rows.map((row) => (
        <ThemedView key={row.label} style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            {row.label}
          </ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {row.options.map((opt) => {
              const active = row.selected === opt;
              return (
                <Pressable key={opt} onPress={() => update({ [row.key]: opt } as Partial<DateTimeValue>)}>
                  <ThemedView
                    type={active ? 'backgroundSelected' : 'background'}
                    style={[styles.chip, active && styles.chipActive]}>
                    <ThemedText type="small">{row.pad ? String(opt).padStart(2, '0') : opt}</ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ScrollView>
        </ThemedView>
      ))}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { width: 24 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { borderColor: '#3c87f7' },
});
