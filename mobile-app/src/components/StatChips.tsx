import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';

interface StatChipsProps {
  totalStudents: number;
  studentsGraded: number;
  worksheetsGraded: number;
  absentCount: number;
}

function StatItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.item}>
      <Text style={[styles.value, { color }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
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
      <StatItem label="Graded" value={`${studentsGraded}/${totalStudents}`} color={colors.blue} />
      <View style={styles.divider} />
      <StatItem label="Worksheets" value={String(worksheetsGraded)} color={colors.green} />
      <View style={styles.divider} />
      <StatItem label="Absent" value={String(absentCount)} color={colors.orange} />
      <View style={styles.divider} />
      <StatItem label="Complete" value={`${completion}%`} color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  item: {
    flex: 1,
    alignItems: 'center',
  },
  value: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  label: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    marginTop: 2,
  },
  divider: {
    width: 1,
    backgroundColor: colors.gray200,
  },
});
