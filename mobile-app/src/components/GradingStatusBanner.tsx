import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fontSize, spacing, borderRadius, softShadow } from '../theme';
import { GradingJobSummary } from '../types';

interface GradingStatusBannerProps {
  summary: GradingJobSummary | null;
  onPress: () => void;
}

export function GradingStatusBanner({
  summary,
  onPress,
}: GradingStatusBannerProps) {
  const isActive = summary ? summary.queued > 0 || summary.processing > 0 : false;
  const hasJobs = summary && summary.total > 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.8 }]}
      onPress={onPress}
    >
      {isActive ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : hasJobs ? (
        <Ionicons name="checkmark-circle" size={20} color={colors.green} />
      ) : (
        <Ionicons name="cloud-upload-outline" size={20} color={colors.gray400} />
      )}
      <View style={styles.content}>
        {hasJobs ? (
          <Text style={styles.summaryText}>
            {[
              summary.processing > 0 && `${summary.processing} grading`,
              summary.queued > 0 && `${summary.queued} queued`,
              summary.completed > 0 && `${summary.completed} done`,
              summary.failed > 0 && `${summary.failed} failed`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : (
          <Text style={styles.emptyText}>No grading jobs today</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.gray300} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    ...softShadow,
  },
  content: {
    flex: 1,
  },
  summaryText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.gray700,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.gray400,
  },
});
