import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';

interface StatChipsProps {
  totalStudents: number;
  studentsGraded: number;
  worksheetsGraded: number;
  absentCount: number;
}

const LABELS = ['Graded', 'Worksheets', 'Absent', 'Complete'];

export function StatChips({
  totalStudents,
  studentsGraded,
  worksheetsGraded,
  absentCount,
}: StatChipsProps) {
  const [tooltip, setTooltip] = useState<number | null>(null);
  const completion =
    totalStudents > 0 ? Math.round((studentsGraded / totalStudents) * 100) : 0;

  const items = [
    { value: `${studentsGraded}/${totalStudents}`, color: colors.primary },
    { value: String(worksheetsGraded), color: colors.green },
    { value: String(absentCount), color: colors.orange },
    { value: `${completion}%`, color: colors.primary },
  ];

  return (
    <View style={styles.container}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <View style={styles.dot} />}
          <Pressable
            onPress={() => setTooltip(tooltip === i ? null : i)}
          >
            <Text style={[styles.value, { color: item.color }]}>{item.value}</Text>
            {tooltip === i && (
              <View style={styles.tooltip}>
                <Text style={styles.tooltipText}>{LABELS[i]}</Text>
              </View>
            )}
          </Pressable>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  value: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.gray300,
  },
  tooltip: {
    position: 'absolute',
    top: -28,
    left: -10,
    backgroundColor: colors.gray800,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    ...Platform.select({
      ios: {
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
      },
      android: { elevation: 4 },
    }),
  },
  tooltipText: {
    fontSize: fontSize.xs,
    color: colors.white,
    fontWeight: '500',
  },
});
