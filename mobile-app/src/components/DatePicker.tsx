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
    if (Platform.OS === 'android') {
      setShow(false);
    }
    if (selected) {
      onChange(toDateInputValue(selected));
    }
  };

  if (Platform.OS === 'ios') {
    return (
      <View style={styles.wrapper}>
        {label && <Text style={styles.label}>{label}</Text>}
        <DateTimePicker
          value={dateObj}
          mode="date"
          display="compact"
          onChange={handleChange}
          style={styles.iosPicker}
        />
      </View>
    );
  }

  // Android: show a button that opens the picker
  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Pressable style={styles.androidButton} onPress={() => setShow(true)}>
        <Text style={styles.androidButtonText}>{formatShortDate(value)}</Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display="default"
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.gray700,
    marginBottom: spacing.xs,
  },
  iosPicker: {
    alignSelf: 'flex-start',
  },
  androidButton: {
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
  },
  androidButtonText: {
    fontSize: fontSize.md,
    color: colors.gray800,
  },
});
