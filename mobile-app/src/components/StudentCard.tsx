import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';

import { WorksheetSlot, WorksheetSlotData } from './WorksheetSlot';
import { colors, fontSize, spacing, borderRadius } from '../theme';

const CARD_HORIZONTAL_MARGIN = spacing.lg;
const CARD_PADDING = spacing.lg;

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
  const hues = ['#0D9488', '#3B82F6', '#D54B43', '#D97706', '#059669', '#EA580C'];
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
  const cardContentWidth = screenWidth - CARD_HORIZONTAL_MARGIN * 2 - CARD_PADDING * 2;

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
          <Text style={styles.studentName} numberOfLines={1}>{studentName}</Text>
          <Text style={styles.tokenNumber}>#{tokenNumber}</Text>
        </View>
        <View style={styles.badges}>
          {hasSavedBadge && (
            <View style={[styles.badge, styles.savedBadge]}>
              <Text style={[styles.badgeText, { color: colors.blue }]}>Saved</Text>
            </View>
          )}
          {hasRepeatBadge && (
            <View style={[styles.badge, styles.repeatBadge]}>
              <Text style={[styles.badgeText, { color: '#9A3412' }]}>Repeat</Text>
            </View>
          )}
        </View>
        <Pressable
          style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.6 }]}
          onPress={onAddWorksheet}
          hitSlop={8}
        >
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      {/* Carousel nav */}
      {worksheets.length > 1 && (
        <View style={styles.carouselNav}>
          <Pressable onPress={() => goTo(activeIndex - 1)} disabled={activeIndex === 0} hitSlop={12}>
            <Text style={[styles.chevron, activeIndex === 0 && styles.chevronDisabled]}>‹</Text>
          </Pressable>
          <Text style={styles.carouselLabel}>
            Worksheet {activeIndex + 1} of {worksheets.length}
          </Text>
          {worksheets.length > 1 && (
            <Pressable
              onPress={() => onRemoveWorksheet(worksheets[activeIndex].worksheetEntryId)}
              hitSlop={8}
            >
              <Text style={styles.trashText}>Remove</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => goTo(activeIndex + 1)}
            disabled={activeIndex === worksheets.length - 1}
            hitSlop={12}
          >
            <Text style={[styles.chevron, activeIndex === worksheets.length - 1 && styles.chevronDisabled]}>›</Text>
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
    borderRadius: borderRadius.xl,
    marginHorizontal: CARD_HORIZONTAL_MARGIN,
    marginBottom: spacing.md,
    padding: CARD_PADDING,
    ...Platform.select({
      ios: {
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
  headerInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.gray900,
  },
  tokenNumber: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    marginTop: 1,
  },
  badges: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  savedBadge: {
    backgroundColor: '#EFF6FF',
  },
  repeatBadge: {
    backgroundColor: '#FFF7ED',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 20,
    fontWeight: '400',
    color: colors.gray500,
    lineHeight: 22,
  },
  carouselNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray200,
  },
  chevron: {
    fontSize: 28,
    fontWeight: '300',
    color: colors.primary,
    paddingHorizontal: spacing.xs,
  },
  chevronDisabled: {
    color: colors.gray300,
  },
  carouselLabel: {
    fontSize: fontSize.sm,
    color: colors.gray600,
    fontWeight: '500',
  },
  trashText: {
    fontSize: fontSize.xs,
    color: colors.red,
    fontWeight: '500',
  },
});
