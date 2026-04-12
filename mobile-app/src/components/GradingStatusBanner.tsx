import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';
import { GradingJobSummary } from '../types';

interface GradingStatusBannerProps {
  summary: GradingJobSummary | null;
  onPress: () => void;
}

export function GradingStatusBanner({
  summary,
  onPress,
}: GradingStatusBannerProps) {
  if (!summary || summary.total === 0) {
    return null;
  }

  const isActive = summary.queued > 0 || summary.processing > 0;

  return (
    <Pressable style={styles.banner} onPress={onPress}>
      {isActive && <ActivityIndicator size="small" color={colors.blue} />}
      {!isActive && <Text style={styles.checkmark}>✓</Text>}
      <View style={styles.pills}>
        {summary.processing > 0 && (
          <Text style={[styles.pill, styles.processingPill]}>
            {summary.processing} grading
          </Text>
        )}
        {summary.queued > 0 && (
          <Text style={[styles.pill, styles.queuedPill]}>
            {summary.queued} queued
          </Text>
        )}
        {summary.completed > 0 && (
          <Text style={[styles.pill, styles.completedPill]}>
            {summary.completed} done
          </Text>
        )}
        {summary.failed > 0 && (
          <Text style={[styles.pill, styles.failedPill]}>
            {summary.failed} failed
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gray50,
    borderRadius: borderRadius.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  checkmark: {
    fontSize: fontSize.md,
    color: colors.green,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  processingPill: {
    backgroundColor: colors.blueLight,
    color: colors.blue,
  },
  queuedPill: {
    backgroundColor: colors.amberLight,
    color: colors.amber,
  },
  completedPill: {
    backgroundColor: colors.greenLight,
    color: colors.green,
  },
  failedPill: {
    backgroundColor: colors.redLight,
    color: colors.red,
  },
});
