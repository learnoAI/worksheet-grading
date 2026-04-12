import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';
import { toDateInputValue } from '../utils/date';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
}

function formatDateDisplay(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  const dayName = date.toLocaleDateString(undefined, { weekday: 'long' });
  const monthDay = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

  if (dateOnly.getTime() === today.getTime()) {
    return `Today, ${monthDay}`;
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateOnly.getTime() === yesterday.getTime()) {
    return `Yesterday, ${monthDay}`;
  }

  return `${dayName}, ${monthDay}`;
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const [show, setShow] = useState(false);
  const dateObj = new Date(`${value}T00:00:00`);

  const handleChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShow(false);
    }
    if (selected) {
      onChange(toDateInputValue(selected));
    }
  };

  return (
    <View>
      <Pressable style={styles.touchable} onPress={() => setShow(!show)}>
        <Text style={styles.dateText}>{formatDateDisplay(value)}</Text>
        <Text style={styles.chevron}>{show ? '▲' : '▼'}</Text>
      </Pressable>
      {show && (
        <View style={styles.pickerContainer}>
          <DateTimePicker
            value={dateObj}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={handleChange}
            accentColor={colors.primary}
          />
          {Platform.OS === 'ios' && (
            <Pressable style={styles.doneButton} onPress={() => setShow(false)}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  touchable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.gray800,
  },
  chevron: {
    fontSize: 10,
    color: colors.gray400,
  },
  pickerContainer: {
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    ...Platform.select({
      ios: {
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  doneButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  doneText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
});
