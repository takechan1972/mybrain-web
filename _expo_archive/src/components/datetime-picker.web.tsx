import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
 * 日時選択UI（Web版）。
 * HTML の <select> を使うため、iPhone / iPad Safari ではタップ時に
 * 上下に回転するネイティブのホイールピッカーが表示される。
 * 月末日補正は clampParts で内部処理。
 */

interface Props {
  value: DateTimeValue;
  onChange: (v: DateTimeValue) => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function DateTimePicker({ value, onChange }: Props) {
  const theme = useTheme();

  function update(partial: Partial<DateTimeValue>) {
    onChange(clampParts({ ...value, ...partial }));
  }

  // react-native-web では intrinsic な DOM 要素（select）をそのまま描画できる
  const selectStyle = {
    fontSize: 16,
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 8,
    paddingRight: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'solid' as const,
    borderColor: theme.backgroundSelected,
    color: theme.text,
    backgroundColor: theme.background,
    minWidth: 64,
  };

  const cell = (
    label: string,
    options: number[],
    selected: number,
    key: keyof DateTimeValue,
    pad: boolean,
  ) => (
    <View style={styles.cell} key={label}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <select
        style={selectStyle}
        value={selected}
        onChange={(e) => update({ [key]: Number(e.target.value) } as Partial<DateTimeValue>)}>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {pad ? pad2(opt) : opt}
          </option>
        ))}
      </select>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      {cell('年', yearOptions(), value.year, 'year', false)}
      {cell('月', MONTH_OPTIONS, value.month, 'month', false)}
      {cell('日', dayOptions(value.year, value.month), value.day, 'day', false)}
      {cell('時', HOUR_OPTIONS, value.hour, 'hour', true)}
      {cell('分', MINUTE_OPTIONS, value.minute, 'minute', true)}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'flex-end' },
  cell: { gap: Spacing.half },
});
