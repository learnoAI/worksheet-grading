import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';
import { formatShortDate, toDateInputValue } from '../utils/date';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  label?: string;
}

export function DatePicker({ value, onChange, label }: DatePickerProps) {
  const [show, setShow] = useState(false);

  const dateObj = new Date(`${value}T00:00:00`);

  const handleChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS !== 'ios') {
      setShow(false);
    }
    if (selected) {
      onChange(toDateInputValue(selected));
    }
  };

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Pressable style={styles.button} onPress={() => setShow(true)}>
        <Text style={styles.dateIcon}>📅</Text>
        <Text style={styles.buttonText}>{formatShortDate(value)}</Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={handleChange}
        />
      )}
      {show && Platform.OS === 'ios' && (
        <Pressable style={styles.doneButton} onPress={() => setShow(false)}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {},
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.gray700,
    marginBottom: spacing.xs,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    gap: spacing.sm,
  },
  dateIcon: {
    fontSize: fontSize.md,
  },
  buttonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.gray800,
  },
  doneButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  doneText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
});
