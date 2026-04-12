import React from 'react';
import {
  ActivityIndicator,
  Platform,
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
    <Pressable
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.8 }]}
      onPress={onPress}
    >
      {isActive && <ActivityIndicator size="small" color={colors.blue} />}
      {!isActive && <Text style={styles.checkmark}>✓</Text>}
      <View style={styles.content}>
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
      </View>
      <Text style={styles.arrow}>›</Text>
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
  checkmark: {
    fontSize: fontSize.lg,
    color: colors.green,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  summaryText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.gray700,
  },
  arrow: {
    fontSize: 20,
    fontWeight: '300',
    color: colors.gray400,
  },
});
