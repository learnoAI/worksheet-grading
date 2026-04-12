import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';

import { WorksheetSlot, WorksheetSlotData } from './WorksheetSlot';
import { colors, fontSize, spacing, borderRadius } from '../theme';

const CARD_HORIZONTAL_PADDING = spacing.lg;

interface StudentCardProps {
  studentId: string;
  studentName: string;
  tokenNumber: string;
  worksheets: WorksheetSlotData[];
  isOffline?: boolean;
  onFieldChange: (worksheetEntryId: string, field: string, value: string | number | boolean) => void;
  onPageScan: (worksheetEntryId: string, pageNumber: number) => void;
  onPageGallery: (worksheetEntryId: string, pageNumber: number) => void;
  onPagePreview: (worksheetEntryId: string, pageNumber: number) => void;
  onScanBothPages: (worksheetEntryId: string) => void;
  onAiGrade: (worksheetEntryId: string) => void;
  onSave: (worksheetEntryId: string) => void;
  onShowDetails: (worksheetEntryId: string) => void;
  onAddWorksheet: () => void;
  onRemoveWorksheet: (worksheetEntryId: string) => void;
}

function avatarColor(name: string): string {
  const hues = [colors.primary, colors.blue, colors.accent, colors.amber, colors.green, colors.orange];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hues[Math.abs(hash) % hues.length];
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function StudentCard({
  studentName,
  tokenNumber,
  worksheets,
  isOffline,
  onFieldChange,
  onPageScan,
  onPageGallery,
  onPagePreview,
  onScanBothPages,
  onAiGrade,
  onSave,
  onShowDetails,
  onAddWorksheet,
  onRemoveWorksheet,
}: StudentCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList<WorksheetSlotData>>(null);
  const screenWidth = Dimensions.get('window').width;
  const cardContentWidth = screenWidth - CARD_HORIZONTAL_PADDING * 2 - spacing.lg * 2;

  const activeWorksheet = worksheets[activeIndex];
  const hasSavedBadge = activeWorksheet?.existing;
  const hasRepeatBadge = worksheets.some((w) => !w.isAbsent && w.isRepeated);

  const goTo = (index: number) => {
    const clamped = Math.max(0, Math.min(index, worksheets.length - 1));
    setActiveIndex(clamped);
    flatListRef.current?.scrollToIndex({ index: clamped, animated: true });
  };

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<WorksheetSlotData>[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
  ).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: avatarColor(studentName) }]}>
          <Text style={styles.avatarText}>{initials(studentName)}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.studentName} numberOfLines={1}>
            {studentName}
          </Text>
          <Text style={styles.tokenNumber}>#{tokenNumber}</Text>
        </View>
        <View style={styles.badges}>
          {hasSavedBadge && (
            <View style={[styles.badge, { backgroundColor: colors.blueLight }]}>
              <Text style={[styles.badgeText, { color: colors.blue }]}>Saved</Text>
            </View>
          )}
          {hasRepeatBadge && (
            <View style={[styles.badge, { backgroundColor: colors.orangeLight }]}>
              <Text style={[styles.badgeText, { color: colors.orange }]}>Repeat</Text>
            </View>
          )}
        </View>
        <Pressable style={styles.addButton} onPress={onAddWorksheet}>
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      {/* Carousel nav */}
      {worksheets.length > 1 && (
        <View style={styles.carouselNav}>
          <Pressable
            onPress={() => goTo(activeIndex - 1)}
            disabled={activeIndex === 0}
            style={[styles.chevron, activeIndex === 0 && styles.disabled]}
          >
            <Text style={styles.chevronText}>‹</Text>
          </Pressable>
          <Text style={styles.carouselLabel}>
            Worksheet {activeIndex + 1} of {worksheets.length}
          </Text>
          {worksheets.length > 1 && (
            <Pressable
              onPress={() => onRemoveWorksheet(worksheets[activeIndex].worksheetEntryId)}
              style={styles.trashButton}
            >
              <Text style={styles.trashText}>🗑</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => goTo(activeIndex + 1)}
            disabled={activeIndex === worksheets.length - 1}
            style={[styles.chevron, activeIndex === worksheets.length - 1 && styles.disabled]}
          >
            <Text style={styles.chevronText}>›</Text>
          </Pressable>
        </View>
      )}

      {/* Carousel body */}
      <FlatList
        ref={flatListRef}
        data={worksheets}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.worksheetEntryId}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <View style={{ width: cardContentWidth }}>
            <WorksheetSlot
              data={item}
              isOffline={isOffline}
              onFieldChange={(field, value) => onFieldChange(item.worksheetEntryId, field, value)}
              onPageScan={(pn) => onPageScan(item.worksheetEntryId, pn)}
              onPageGallery={(pn) => onPageGallery(item.worksheetEntryId, pn)}
              onPagePreview={(pn) => onPagePreview(item.worksheetEntryId, pn)}
              onScanBothPages={() => onScanBothPages(item.worksheetEntryId)}
              onAiGrade={() => onAiGrade(item.worksheetEntryId)}
              onSave={() => onSave(item.worksheetEntryId)}
              onShowDetails={() => onShowDetails(item.worksheetEntryId)}
            />
          </View>
        )}
        getItemLayout={(_data, index) => ({
          length: cardContentWidth,
          offset: cardContentWidth * index,
          index,
        })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.white,
  },
  headerInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.gray900,
  },
  tokenNumber: {
    fontSize: fontSize.xs,
    color: colors.gray500,
  },
  badges: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  addButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.gray300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: fontSize.lg,
    color: colors.gray500,
    lineHeight: fontSize.lg + 2,
  },
  carouselNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  chevron: {
    padding: spacing.xs,
  },
  chevronText: {
    fontSize: fontSize.xxl,
    fontWeight: '300',
    color: colors.gray600,
  },
  carouselLabel: {
    fontSize: fontSize.sm,
    color: colors.gray600,
    fontWeight: '600',
  },
  trashButton: {
    padding: spacing.xs,
  },
  trashText: {
    fontSize: fontSize.sm,
  },
  disabled: {
    opacity: 0.3,
  },
});
