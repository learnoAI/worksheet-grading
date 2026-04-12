import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiClient } from '../api/client';
import { colors, fontSize, spacing, borderRadius } from '../theme';
import { QueueWorksheet } from '../types';
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
  onNavigateToStudent?: (studentId: string, classId: string, submittedOn: string) => void;
}

const STATUS_DISPLAY: Record<string, { label: string; color: string; bg: string }> = {
  queued: { label: 'Queued', color: colors.amber, bg: colors.amberLight },
  uploading: { label: 'Uploading', color: colors.blue, bg: colors.blueLight },
  uploaded: { label: 'Uploaded', color: colors.blue, bg: colors.blueLight },
  grading_queued: { label: 'Grading', color: colors.blue, bg: colors.blueLight },
  processing: { label: 'Processing', color: colors.blue, bg: colors.blueLight },
  completed: { label: 'Done', color: colors.green, bg: colors.greenLight },
  failed: { label: 'Failed', color: colors.red, bg: colors.redLight },
};

export function QueueScreen({ onNavigateToStudent }: QueueScreenProps) {
  const [items, setItems] = useState<QueueWorksheet[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      await initializeQueueDatabase();
      await refreshGradingStatuses(apiClient).catch(() => undefined);
      const all = await listQueueItems();
      setItems(all);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

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

  const filtered = filter.trim()
    ? items.filter(
        (item) =>
          item.studentName.toLowerCase().includes(filter.toLowerCase()) ||
          item.tokenNumber.toLowerCase().includes(filter.toLowerCase()) ||
          item.status.includes(filter.toLowerCase()),
      )
    : items;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Upload Queue</Text>
        <Pressable
          style={[styles.processButton, working && styles.disabled]}
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

      <View style={styles.filterRow}>
        <TextInput
          style={styles.filterInput}
          placeholder="Filter by name, token, or status"
          placeholderTextColor={colors.gray400}
          value={filter}
          onChangeText={setFilter}
        />
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
              <Text style={styles.emptyText}>Queue is empty.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const statusInfo = STATUS_DISPLAY[item.status] || STATUS_DISPLAY.queued;
            return (
              <Pressable
                style={styles.card}
                onPress={() => onNavigateToStudent?.(item.studentId, item.classId, item.submittedOn)}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {item.studentName}
                    </Text>
                    <Text style={styles.cardMeta}>
                      #{item.tokenNumber} · WS #{item.worksheetNumber} · {item.submittedOn}
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

                {/* Page upload status */}
                <View style={styles.pagesRow}>
                  {item.pages.map((page) => (
                    <Text
                      key={page.id}
                      style={[
                        styles.pageStatus,
                        page.uploadStatus === 'uploaded' && styles.pageUploaded,
                        page.uploadStatus === 'failed' && styles.pageFailed,
                      ]}
                    >
                      P{page.pageNumber}: {page.uploadStatus}
                    </Text>
                  ))}
                </View>

                {/* Actions */}
                <View style={styles.cardActions}>
                  {item.status === 'failed' && (
                    <Pressable style={styles.retryButton} onPress={() => handleRetry(item.localId)}>
                      <Text style={styles.retryText}>Retry</Text>
                    </Pressable>
                  )}
                  <Pressable style={styles.discardButton} onPress={() => handleDiscard(item.localId)}>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.gray900,
  },
  processButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  processButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.white,
  },
  filterRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  filterInput: {
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.gray900,
    backgroundColor: colors.white,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
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
    fontWeight: '700',
    color: colors.gray900,
  },
  cardMeta: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
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
  pageStatus: {
    fontSize: fontSize.xs,
    color: colors.gray500,
  },
  pageUploaded: {
    color: colors.green,
  },
  pageFailed: {
    color: colors.red,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  retryButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.amberLight,
  },
  retryText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.amber,
  },
  discardButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.redLight,
  },
  discardText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.red,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.gray400,
  },
  disabled: {
    opacity: 0.4,
  },
});
