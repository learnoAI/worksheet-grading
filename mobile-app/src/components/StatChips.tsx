import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from '../theme';

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
    <View style={styles.container}>
      <View style={styles.stat}>
        <Text style={[styles.value, { color: colors.primary }]}>
          {studentsGraded}/{totalStudents}
        </Text>
        <Text style={styles.label}>Graded</Text>
      </View>
      <View style={styles.separator} />
      <View style={styles.stat}>
        <Text style={[styles.value, { color: colors.green }]}>
          {worksheetsGraded}
        </Text>
        <Text style={styles.label}>Worksheets</Text>
      </View>
      <View style={styles.separator} />
      <View style={styles.stat}>
        <Text style={[styles.value, { color: colors.orange }]}>
          {absentCount}
        </Text>
        <Text style={styles.label}>Absent</Text>
      </View>
      <View style={styles.separator} />
      <View style={styles.stat}>
        <Text style={[styles.value, { color: colors.primary }]}>
          {completion}%
        </Text>
        <Text style={styles.label}>Complete</Text>
      </View>
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
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  stat: {
    alignItems: 'center',
  },
  value: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  label: {
    fontSize: fontSize.caption,
    color: colors.gray400,
    fontWeight: '500',
    marginTop: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  separator: {
    width: 1,
    height: 24,
    backgroundColor: colors.gray200,
  },
});
