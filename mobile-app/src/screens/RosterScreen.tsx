import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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

import { DatePicker } from '../components/DatePicker';
import { GradingDetailsModal } from '../components/GradingDetailsModal';
import { GradingStatusBanner } from '../components/GradingStatusBanner';
import { ImagePreviewModal } from '../components/ImagePreviewModal';
import { StatChips } from '../components/StatChips';
import { StudentCard } from '../components/StudentCard';
import { useDocumentScanner } from '../hooks/useDocumentScanner';
import { useGradingJobs } from '../hooks/useGradingJobs';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useRoster, RosterStudent } from '../hooks/useRoster';
import { colors, fontSize, spacing, borderRadius } from '../theme';
import { GradingDetails, User } from '../types';

interface RosterScreenProps {
  user: User;
  onNavigateToQueue: () => void;
}

export function RosterScreen({ user, onNavigateToQueue }: RosterScreenProps) {
  const isOnline = useNetworkStatus();
  const roster = useRoster(user);
  const { summary } = useGradingJobs();
  const { scanPages, scanSinglePage, pickFromGallery } = useDocumentScanner();

  const [detailsModal, setDetailsModal] = useState<{
    visible: boolean;
    details: GradingDetails | null;
    studentName: string;
  }>({ visible: false, details: null, studentName: '' });

  const [previewModal, setPreviewModal] = useState<{
    visible: boolean;
    uri: string | null;
    title: string;
  }>({ visible: false, uri: null, title: '' });

  const [menuVisible, setMenuVisible] = useState(false);

  const handlePageScan = useCallback(
    async (worksheetEntryId: string, pageNumber: number) => {
      const result = await scanSinglePage();
      if (result) {
        roster.setPageImage(worksheetEntryId, pageNumber, result.uri, result.mimeType, result.fileName);
      }
    },
    [scanSinglePage, roster],
  );

  const handlePageGallery = useCallback(
    async (worksheetEntryId: string, pageNumber: number) => {
      const result = await pickFromGallery();
      if (result) {
        roster.setPageImage(worksheetEntryId, pageNumber, result.uri, result.mimeType, result.fileName);
      }
    },
    [pickFromGallery, roster],
  );

  const handleScanBothPages = useCallback(
    async (worksheetEntryId: string) => {
      const pages = await scanPages();
      if (pages.length >= 1) {
        roster.setPageImage(worksheetEntryId, 1, pages[0].uri, pages[0].mimeType, pages[0].fileName);
      }
      if (pages.length >= 2) {
        roster.setPageImage(worksheetEntryId, 2, pages[1].uri, pages[1].mimeType, pages[1].fileName);
      }
    },
    [scanPages, roster],
  );

  const handlePagePreview = useCallback(
    (worksheetEntryId: string, pageNumber: number) => {
      const ws = roster.getWorksheet(worksheetEntryId);
      if (!ws) return;
      const uri = pageNumber === 1 ? (ws.page1Uri || ws.page1Url) : (ws.page2Uri || ws.page2Url);
      if (uri) {
        const student = roster.findStudentForWorksheet(worksheetEntryId);
        setPreviewModal({
          visible: true,
          uri,
          title: `${student?.studentName || ''} - Page ${pageNumber}`,
        });
      }
    },
    [roster],
  );

  const handleShowDetails = useCallback(
    (worksheetEntryId: string) => {
      const ws = roster.getWorksheet(worksheetEntryId);
      const student = roster.findStudentForWorksheet(worksheetEntryId);
      if (ws?.gradingDetails) {
        setDetailsModal({
          visible: true,
          details: ws.gradingDetails,
          studentName: student?.studentName || '',
        });
      }
    },
    [roster],
  );

  const renderStudent = useCallback(
    ({ item }: { item: RosterStudent }) => (
      <StudentCard
        studentId={item.studentId}
        studentName={item.studentName}
        tokenNumber={item.tokenNumber}
        worksheets={item.worksheets}
        isOffline={!isOnline}
        onFieldChange={roster.updateField}
        onPageScan={handlePageScan}
        onPageGallery={handlePageGallery}
        onPagePreview={handlePagePreview}
        onScanBothPages={handleScanBothPages}
        onAiGrade={(id) => roster.aiGrade(id)}
        onSave={(id) => roster.saveStudent(id)}
        onShowDetails={handleShowDetails}
        onAddWorksheet={() => roster.addWorksheet(item.studentId)}
        onRemoveWorksheet={roster.removeWorksheet}
      />
    ),
    [
      isOnline,
      roster,
      handlePageScan,
      handlePageGallery,
      handlePagePreview,
      handleScanBothPages,
      handleShowDetails,
    ],
  );

  const eligibleUploadCount = roster.students.reduce(
    (count, s) =>
      count +
      s.worksheets.filter(
        (ws) => !ws.isAbsent && ws.worksheetNumber > 0 && (ws.page1Uri || ws.page2Uri),
      ).length,
    0,
  );

  if (roster.loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header: date + menu */}
      <View style={styles.header}>
        <DatePicker value={roster.submittedOn} onChange={roster.setSubmittedOn} />
        <Pressable
          onPress={() => setMenuVisible(!menuVisible)}
          style={({ pressed }) => [styles.menuButton, pressed && { opacity: 0.5 }]}
          hitSlop={12}
        >
          <Text style={styles.menuDots}>...</Text>
        </Pressable>
      </View>

      {/* Class selector — right below header */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.classChips}
      >
        {roster.classes.map((cls) => {
          const isActive = cls.id === roster.selectedClassId;
          return (
            <Pressable
              key={cls.id}
              style={[styles.classChip, isActive && styles.classChipActive]}
              onPress={() => roster.setSelectedClassId(cls.id)}
            >
              <Text style={[styles.classChipText, isActive && styles.classChipTextActive]}>
                {cls.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Overflow menu */}
      {menuVisible && (
        <>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
          <View style={styles.overflowMenu}>
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              onPress={() => {
                setMenuVisible(false);
                roster.markUngradedAbsent();
              }}
            >
              <Text style={styles.menuItemText}>Mark Ungraded as Absent</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* Offline banner */}
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            You are offline. Upload, AI Grade, and Save are disabled.
          </Text>
        </View>
      )}

      {/* Grading status */}
      <GradingStatusBanner summary={summary} onPress={onNavigateToQueue} />

      {/* Stats */}
      {roster.stats && (
        <StatChips
          totalStudents={roster.stats.totalStudents}
          studentsGraded={roster.stats.studentsWithWorksheets}
          worksheetsGraded={roster.stats.gradedCount}
          absentCount={roster.stats.absentCount}
        />
      )}

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or token #"
            placeholderTextColor={colors.gray400}
            value={roster.searchQuery}
            onChangeText={roster.setSearchQuery}
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* Error */}
      {roster.error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{roster.error}</Text>
        </View>
      )}

      {/* Student cards */}
      {roster.loadingRoster ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={roster.filteredStudents}
          keyExtractor={(item) => item.studentId}
          renderItem={renderStudent}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {roster.searchQuery ? 'No students match your search.' : 'Select a class to see students.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Bottom bar */}
      {roster.selectedClassId && (
        <View style={styles.bottomBar}>
          <Pressable
            style={({ pressed }) => [
              styles.bottomBtn,
              styles.gradeAllBtn,
              (!isOnline || eligibleUploadCount === 0) && styles.disabled,
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
            onPress={() => roster.aiGradeAll()}
            disabled={!isOnline || eligibleUploadCount === 0}
          >
            <Text style={styles.bottomBtnText}>
              AI Grade{eligibleUploadCount > 0 ? ` (${eligibleUploadCount})` : ''}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.bottomBtn,
              styles.saveAllBtn,
              !isOnline && styles.disabled,
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
            onPress={() => roster.saveAll()}
            disabled={!isOnline}
          >
            <Text style={[styles.bottomBtnText, styles.saveAllBtnText]}>Save All</Text>
          </Pressable>
        </View>
      )}

      {/* Modals */}
      <GradingDetailsModal
        visible={detailsModal.visible}
        details={detailsModal.details}
        studentName={detailsModal.studentName}
        onClose={() => setDetailsModal({ visible: false, details: null, studentName: '' })}
      />
      <ImagePreviewModal
        visible={previewModal.visible}
        uri={previewModal.uri}
        title={previewModal.title}
        onClose={() => setPreviewModal({ visible: false, uri: null, title: '' })}
      />
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

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray200,
  },
  menuButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuDots: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.gray600,
    letterSpacing: 1,
    marginTop: -6,
  },

  // Menu
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99,
  },
  overflowMenu: {
    position: 'absolute',
    top: 60,
    right: spacing.xl,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    ...Platform.select({
      ios: {
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 24,
      },
      android: { elevation: 8 },
    }),
    zIndex: 100,
    minWidth: 240,
    overflow: 'hidden',
  },
  menuItem: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  menuItemPressed: {
    backgroundColor: colors.gray50,
  },
  menuItemText: {
    fontSize: fontSize.md,
    color: colors.gray800,
    fontWeight: '500',
  },

  // Banners
  offlineBanner: {
    backgroundColor: colors.accentLight,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  offlineText: {
    fontSize: fontSize.sm,
    color: '#991B1B',
    fontWeight: '500',
  },

  // Class chips
  classChips: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  classChip: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
  },
  classChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  classChipText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.gray800,
  },
  classChipTextActive: {
    color: colors.white,
  },

  // Search
  searchRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Platform.select({
      ios: colors.gray200,
      android: colors.white,
    }),
    borderRadius: Platform.select({ ios: 10, android: borderRadius.md }),
    paddingHorizontal: spacing.md,
    ...Platform.select({
      android: { elevation: 1 },
    }),
  },
  searchIcon: {
    fontSize: 14,
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.gray900,
    paddingVertical: Platform.select({ ios: 10, android: 12 }),
  },

  // Error
  errorBanner: {
    backgroundColor: colors.accentLight,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    fontSize: fontSize.sm,
    color: '#991B1B',
    fontWeight: '500',
  },

  // List
  listContent: {
    paddingTop: spacing.xs,
    paddingBottom: 80,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 3,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.gray400,
  },

  // Bottom bar — compact
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray200,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: Platform.select({ ios: spacing.xxl + 4, android: spacing.md }),
  },
  bottomBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradeAllBtn: {
    backgroundColor: colors.primary,
  },
  saveAllBtn: {
    backgroundColor: colors.gray100,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  bottomBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.white,
  },
  saveAllBtnText: {
    color: colors.gray700,
  },
  disabled: {
    opacity: 0.35,
  },
});
