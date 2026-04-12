import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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

  // Modal state
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

  // Handlers
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
    ({ item }: { item: TeacherClass }) => (
      <Pressable
        style={[
          styles.classChip,
          item.id === roster.selectedClassId && styles.classChipActive,
        ]}
        onPress={() => roster.setSelectedClassId(item.id)}
      >
        <Text
          style={[
            styles.classChipText,
            item.id === roster.selectedClassId && styles.classChipTextActive,
          ]}
        >
          {item.name}
        </Text>
      </Pressable>
    ),
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
        <Text style={styles.title}>Worksheets</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => setMenuVisible(!menuVisible)} style={styles.menuButton}>
            <Text style={styles.menuDots}>⋯</Text>
          </Pressable>
          <Pressable onPress={onLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>
      </View>

      {/* Overflow menu */}
      {menuVisible && (
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

      {/* Class chips */}
      <FlatList
        horizontal
        data={roster.classes}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.classChips}
        renderItem={renderClassChip}
      />

      {/* Date picker */}
      <View style={styles.dateRow}>
        <DatePicker value={roster.submittedOn} onChange={roster.setSubmittedOn} label="Date" />
      </View>

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
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or token #"
          placeholderTextColor={colors.gray400}
          value={roster.searchQuery}
          onChangeText={roster.setSearchQuery}
        />
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
            style={[styles.bottomButton, styles.gradeAllButton, (!isOnline || eligibleUploadCount === 0) && styles.disabled]}
            onPress={() => roster.aiGradeAll()}
            disabled={!isOnline || eligibleUploadCount === 0}
          >
            <Text style={styles.gradeAllText}>
              AI Grade All{eligibleUploadCount > 0 ? ` (${eligibleUploadCount})` : ''}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.bottomButton, styles.saveAllButton, !isOnline && styles.disabled]}
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
    backgroundColor: colors.gray50,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.gray50,
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuButton: {
    padding: spacing.sm,
  },
  menuDots: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.gray600,
  },
  logoutButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  logoutText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
  },
  overflowMenu: {
    position: 'absolute',
    top: 60,
    right: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 100,
  },
  menuItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuItemText: {
    fontSize: fontSize.md,
    color: colors.gray800,
  },
  offlineBanner: {
    backgroundColor: colors.redLight,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  offlineText: {
    fontSize: fontSize.sm,
    color: colors.red,
  },
  classChips: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  classChip: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.gray100,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  classChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  classChipText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.gray700,
  },
  classChipTextActive: {
    color: colors.white,
  },
  dateRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  searchRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.gray900,
    backgroundColor: colors.white,
  },
  errorBanner: {
    backgroundColor: colors.redLight,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.red,
  },
  listContent: {
    paddingBottom: 100, // Space for bottom bar
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.gray400,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.gray100,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xxl,
  },
  bottomButton: {
    flex: 1,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  gradeAllButton: {
    backgroundColor: colors.blue,
  },
  gradeAllText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.white,
  },
  saveAllButton: {
    backgroundColor: colors.primary,
  },
  saveAllText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.white,
  },
  disabled: {
    opacity: 0.4,
  },
});
