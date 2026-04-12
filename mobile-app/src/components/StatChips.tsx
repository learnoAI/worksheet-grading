import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';

interface StatChipsProps {
  totalStudents: number;
  studentsGraded: number;
  worksheetsGraded: number;
  absentCount: number;
}

export function StatChips({
  totalStudents,
  studentsGraded,
  worksheetsGraded,
  absentCount,
}: StatChipsProps) {
  const completion =
    totalStudents > 0 ? Math.round((studentsGraded / totalStudents) * 100) : 0;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      <View style={[styles.chip, { backgroundColor: colors.blueLight }]}>
        <Text style={[styles.chipText, { color: colors.blue }]}>
          Graded {studentsGraded}/{totalStudents}
        </Text>
      </View>
      <View style={[styles.chip, { backgroundColor: colors.greenLight }]}>
        <Text style={[styles.chipText, { color: colors.green }]}>
          Worksheets {worksheetsGraded}
        </Text>
      </View>
      <View style={[styles.chip, { backgroundColor: colors.orangeLight }]}>
        <Text style={[styles.chipText, { color: colors.orange }]}>
          Absent {absentCount}
        </Text>
      </View>
      <View style={[styles.chip, { backgroundColor: colors.primaryLight }]}>
        <Text style={[styles.chipText, { color: colors.primary }]}>
          {completion}%
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  chipText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
