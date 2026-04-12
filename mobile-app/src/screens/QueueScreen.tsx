import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiClient } from '../api/client';
import { DatePicker } from '../components/DatePicker';
import { useGradingJobs } from '../hooks/useGradingJobs';
import { colors, fontSize, spacing, borderRadius, cardShadow, androidRipple } from '../theme';
import { QueueWorksheet, TeacherClass, User } from '../types';
import { toDateInputValue } from '../utils/date';
import {
  initializeQueueDatabase,
  listQueueItems,
  removeQueueItem,
  resetItemForRetry,
} from '../queue/storage';
import {
  processUploadQueue,
  refreshGradingStatuses,
} from '../queue/uploader';

interface QueueScreenProps {
  user: User;
  onNavigateToStudent?: (studentId: string, classId: string, submittedOn: string) => void;
}

const STATUS_DISPLAY: Record<string, { label: string; color: string; bg: string }> = {
  queued: { label: 'Queued', color: colors.amber, bg: colors.amberLight },
  uploading: { label: 'Uploading', color: colors.primary, bg: colors.primaryLight },
  uploaded: { label: 'Uploaded', color: colors.primary, bg: colors.primaryLight },
  grading_queued: { label: 'Grading', color: colors.primary, bg: colors.primaryLight },
  processing: { label: 'Processing', color: colors.primary, bg: colors.primaryLight },
  completed: { label: 'Done', color: colors.green, bg: colors.greenLight },
  failed: { label: 'Failed', color: colors.red, bg: colors.redLight },
};

const STATUS_ACCENT: Record<string, string> = {
  queued: colors.amber,
  uploading: colors.primary,
  uploaded: colors.primary,
  grading_queued: colors.primary,
  processing: colors.primary,
  completed: colors.green,
  failed: colors.red,
};

export function QueueScreen({ user, onNavigateToStudent }: QueueScreenProps) {
  const [items, setItems] = useState<QueueWorksheet[]>([]);
  const [textFilter, setTextFilter] = useState('');
  const [dateFilter, setDateFilter] = useState(toDateInputValue());
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const { summary } = useGradingJobs();

  // Load classes for filter
  useEffect(() => {
    apiClient.getTeacherClasses(user).then(setClasses).catch(() => undefined);
  }, [user]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      await initializeQueueDatabase();
      await refreshGradingStatuses(apiClient).catch(() => undefined);
      const filters: { submittedOn?: string; classIds?: string[] } = {};
      if (dateFilter) filters.submittedOn = dateFilter;
      if (selectedClassIds.size > 0) filters.classIds = Array.from(selectedClassIds);
      const all = await listQueueItems(filters);
      setItems(all);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [dateFilter, selectedClassIds]);

  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [loadItems]),
  );

  const handleProcessQueue = useCallback(async () => {
    setWorking(true);
    try {
      await processUploadQueue(apiClient);
      await loadItems();
      Alert.alert('Done', 'Queue processed.');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setWorking(false);
    }
  }, [loadItems]);

  const handleRetry = useCallback(
    async (localId: string) => {
      await resetItemForRetry(localId);
      await loadItems();
    },
    [loadItems],
  );

  const handleDiscard = useCallback(
    async (localId: string) => {
      Alert.alert('Discard', 'Remove this item from the queue?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await removeQueueItem(localId);
            await loadItems();
          },
        },
      ]);
    },
    [loadItems],
  );

  const toggleClass = useCallback((classId: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) {
        next.delete(classId);
      } else {
        next.add(classId);
      }
      return next;
    });
  }, []);

  const clearClassFilter = useCallback(() => {
    setSelectedClassIds(new Set());
  }, []);

  const filtered = textFilter.trim()
    ? items.filter(
        (item) =>
          item.studentName.toLowerCase().includes(textFilter.toLowerCase()) ||
          item.tokenNumber.toLowerCase().includes(textFilter.toLowerCase()) ||
          item.status.includes(textFilter.toLowerCase()),
      )
    : items;

  const hasActiveJobs = summary && (summary.queued > 0 || summary.processing > 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Queue</Text>
        <Pressable
          style={({ pressed }) => [styles.processButton, working && styles.disabled, pressed && { opacity: 0.7 }]}
          onPress={handleProcessQueue}
          disabled={working}
        >
          {working ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.processButtonText}>Process</Text>
          )}
        </Pressable>
      </View>

      {/* Grading jobs summary */}
      <View style={styles.jobsSummary}>
        {hasActiveJobs && <ActivityIndicator size="small" color={colors.primary} />}
        <View style={styles.jobsRow}>
          {summary && summary.processing > 0 && (
            <View style={[styles.jobsPill, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.jobsPillText, { color: colors.primary }]}>
                {summary.processing} grading
              </Text>
            </View>
          )}
          {summary && summary.queued > 0 && (
            <View style={[styles.jobsPill, { backgroundColor: colors.amberLight }]}>
              <Text style={[styles.jobsPillText, { color: colors.amber }]}>
                {summary.queued} queued
              </Text>
            </View>
          )}
          {summary && summary.completed > 0 && (
            <View style={[styles.jobsPill, { backgroundColor: colors.greenLight }]}>
              <Text style={[styles.jobsPillText, { color: colors.green }]}>
                {summary.completed} done
              </Text>
            </View>
          )}
          {summary && summary.failed > 0 && (
            <View style={[styles.jobsPill, { backgroundColor: colors.redLight }]}>
              <Text style={[styles.jobsPillText, { color: colors.red }]}>
                {summary.failed} failed
              </Text>
            </View>
          )}
          {(!summary || summary.total === 0) && (
            <Text style={styles.jobsEmpty}>No grading jobs today</Text>
          )}
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filtersSection}>
        {/* Date */}
        <DatePicker value={dateFilter} onChange={setDateFilter} />

        {/* Class filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.classFilterRow}
        >
          <Pressable onPress={clearClassFilter}>
            <View style={[styles.classFilterChip, selectedClassIds.size === 0 && styles.classFilterChipActive]}>
              <Text style={[styles.classFilterText, selectedClassIds.size === 0 && styles.classFilterTextActive]}>
                All
              </Text>
            </View>
          </Pressable>
          {classes.map((cls) => {
            const isActive = selectedClassIds.has(cls.id);
            return (
              <Pressable key={cls.id} onPress={() => toggleClass(cls.id)}>
                <View style={[styles.classFilterChip, isActive && styles.classFilterChipActive]}>
                  <Text style={[styles.classFilterText, isActive && styles.classFilterTextActive]}>
                    {cls.name}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Text filter */}
        <View style={styles.filterContainer}>
          <Ionicons name="search" size={16} color={colors.gray400} style={{ marginRight: spacing.sm }} />
          <TextInput
            style={styles.filterInput}
            placeholder="Search name or token"
            placeholderTextColor={colors.gray400}
            value={textFilter}
            onChangeText={setTextFilter}
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.localId}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No items for this date.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const statusInfo = STATUS_DISPLAY[item.status] || STATUS_DISPLAY.queued;
            const accentColor = STATUS_ACCENT[item.status] || colors.amber;
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.card,
                  { borderLeftWidth: 4, borderLeftColor: accentColor },
                  Platform.OS === 'ios' && pressed && styles.pressed,
                ]}
                onPress={() => onNavigateToStudent?.(item.studentId, item.classId, item.submittedOn)}
                android_ripple={androidRipple}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {item.studentName}
                    </Text>
                    <Text style={styles.cardMeta}>
                      #{item.tokenNumber} · WS #{item.worksheetNumber}
                      {item.className ? ` · ${item.className}` : ''}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                    <Text style={[styles.statusText, { color: statusInfo.color }]}>
                      {statusInfo.label}
                    </Text>
                  </View>
                </View>

                {item.errorMessage && (
                  <Text style={styles.errorText} numberOfLines={2}>
                    {item.errorMessage}
                  </Text>
                )}

                {item.jobId && (
                  <Text style={styles.jobId}>Job: {item.jobId.slice(0, 8)}</Text>
                )}

                <View style={styles.pagesRow}>
                  {item.pages.map((page) => (
                    <View key={page.id} style={styles.pageStatusRow}>
                      <View
                        style={[
                          styles.statusDot,
                          {
                            backgroundColor:
                              page.uploadStatus === 'uploaded'
                                ? colors.green
                                : page.uploadStatus === 'failed'
                                  ? colors.red
                                  : colors.gray300,
                          },
                        ]}
                      />
                      <Text style={styles.pageStatusLabel}>P{page.pageNumber}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.cardActions}>
                  {item.status === 'failed' && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.retryButton,
                        Platform.OS === 'ios' && pressed && styles.pressed,
                      ]}
                      onPress={() => handleRetry(item.localId)}
                      android_ripple={androidRipple}
                    >
                      <Ionicons name="refresh" size={14} color={colors.amber} />
                      <Text style={styles.retryText}>Retry</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={({ pressed }) => [
                      styles.discardButton,
                      Platform.OS === 'ios' && pressed && styles.pressed,
                    ]}
                    onPress={() => handleDiscard(item.localId)}
                    android_ripple={androidRipple}
                  >
                    <Text style={styles.discardText}>Discard</Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.gray50,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray200,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.gray900,
    letterSpacing: -0.5,
  },
  processButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 20,
  },
  processButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.white,
  },

  // Grading jobs
  jobsSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    gap: spacing.sm,
  },
  jobsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  jobsPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 12,
  },
  jobsPillText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  jobsEmpty: {
    fontSize: fontSize.sm,
    color: colors.gray400,
  },

  // Filters
  filtersSection: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray200,
    gap: spacing.sm,
  },
  classFilterRow: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  classFilterChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.gray100,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  classFilterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  classFilterText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.gray600,
  },
  classFilterTextActive: {
    color: colors.white,
  },
  filterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Platform.select({
      ios: colors.gray200,
      android: colors.gray100,
    }),
    borderRadius: Platform.select({ ios: 10, android: borderRadius.md }),
    paddingHorizontal: spacing.md,
  },
  filterInput: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.gray900,
    paddingVertical: Platform.select({ ios: 8, android: 10 }),
  },

  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    overflow: 'hidden',
    ...cardShadow,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  cardName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.gray900,
  },
  cardMeta: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  errorText: {
    fontSize: fontSize.xs,
    color: colors.red,
    marginTop: spacing.xs,
  },
  jobId: {
    fontSize: fontSize.xs,
    color: colors.gray400,
    marginTop: spacing.xs,
  },
  pagesRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pageStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pageStatusLabel: {
    fontSize: fontSize.xs,
    color: colors.gray500,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.amberLight,
    overflow: 'hidden',
  },
  retryText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.amber,
  },
  discardButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
    overflow: 'hidden',
  },
  discardText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.gray500,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 3,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.gray400,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
});
