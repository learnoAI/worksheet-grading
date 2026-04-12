import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
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
import { GradingDetails, TeacherClass, User } from '../types';

interface RosterScreenProps {
  user: User;
  onLogout: () => void;
  onNavigateToQueue: () => void;
}

export function RosterScreen({ user, onLogout, onNavigateToQueue }: RosterScreenProps) {
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

  const renderClassChip = useCallback(
    ({ item }: { item: TeacherClass }) => {
      const isActive = item.id === roster.selectedClassId;
      return (
        <Pressable
          style={[styles.classChip, isActive && styles.classChipActive]}
          onPress={() => roster.setSelectedClassId(item.id)}
        >
          <Text style={[styles.classChipText, isActive && styles.classChipTextActive]}>
            {item.name}
          </Text>
        </Pressable>
      );
    },
    [roster],
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
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Worksheets</Text>
          <DatePicker value={roster.submittedOn} onChange={roster.setSubmittedOn} />
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setMenuVisible(!menuVisible)}
            style={styles.headerButton}
            hitSlop={8}
          >
            <Text style={styles.moreIcon}>...</Text>
          </Pressable>
          <Pressable onPress={onLogout} style={styles.headerButton} hitSlop={8}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </Pressable>
        </View>
      </View>

      {/* Overflow menu */}
      {menuVisible && (
        <>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
          <View style={styles.overflowMenu}>
            <Pressable
              style={styles.menuItem}
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

      {/* Grading status banner */}
      <GradingStatusBanner summary={summary} onPress={onNavigateToQueue} />

      {/* Class selector */}
      <FlatList
        horizontal
        data={roster.classes}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.classChips}
        renderItem={renderClassChip}
      />

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

      {/* Sticky bottom bar */}
      {roster.selectedClassId && (
        <View style={styles.bottomBar}>
          <Pressable
            style={({ pressed }) => [
              styles.bottomButton,
              styles.gradeAllButton,
              (!isOnline || eligibleUploadCount === 0) && styles.disabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => roster.aiGradeAll()}
            disabled={!isOnline || eligibleUploadCount === 0}
          >
            <Text style={styles.gradeAllText}>
              AI Grade All{eligibleUploadCount > 0 ? ` (${eligibleUploadCount})` : ''}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.bottomButton,
              styles.saveAllButton,
              !isOnline && styles.disabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => roster.saveAll()}
            disabled={!isOnline}
          >
            <Text style={styles.saveAllText}>Save All</Text>
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
    backgroundColor: Platform.select({
      ios: colors.gray50,
      android: colors.gray100,
    }),
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
    alignItems: 'flex-start',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray200,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.gray900,
    letterSpacing: -0.5,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
  headerButton: {
    paddingVertical: spacing.xs,
  },
  moreIcon: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.gray500,
    letterSpacing: 2,
  },
  logoutText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '500',
  },

  // Overflow menu
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99,
  },
  overflowMenu: {
    position: 'absolute',
    top: 80,
    right: spacing.xl,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    ...Platform.select({
      ios: {
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
      },
      android: {
        elevation: 8,
      },
    }),
    zIndex: 100,
    minWidth: 220,
  },
  menuItem: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  menuItemText: {
    fontSize: fontSize.md,
    color: colors.gray800,
  },

  // Banners
  offlineBanner: {
    backgroundColor: '#FEF2F2',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
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
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  classChip: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
    borderRadius: borderRadius.full,
    backgroundColor: colors.white,
    ...Platform.select({
      ios: {
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  classChipActive: {
    backgroundColor: colors.primary,
    ...Platform.select({
      ios: {
        shadowOpacity: 0.15,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  classChipText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.gray700,
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
      ios: '#E8E8ED',
      android: colors.white,
    }),
    borderRadius: Platform.select({
      ios: 10,
      android: borderRadius.md,
    }),
    paddingHorizontal: spacing.md,
    ...Platform.select({
      android: {
        elevation: 1,
        borderWidth: 0,
      },
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
    backgroundColor: '#FEF2F2',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
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
    paddingBottom: 100,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 3,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.gray400,
  },

  // Bottom bar
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
    paddingTop: spacing.md,
    paddingBottom: Platform.select({ ios: spacing.xxl + 8, android: spacing.lg }),
    ...Platform.select({
      ios: {
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  bottomButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  gradeAllButton: {
    backgroundColor: colors.blue,
  },
  gradeAllText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.white,
  },
  saveAllButton: {
    backgroundColor: colors.primary,
  },
  saveAllText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.white,
  },
  disabled: {
    opacity: 0.4,
  },
});
