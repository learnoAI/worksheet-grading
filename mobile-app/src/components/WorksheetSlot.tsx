import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PageSlot } from './PageSlot';
import { colors, fontSize, spacing, borderRadius } from '../theme';
import { GradingDetails } from '../types';

export interface WorksheetSlotData {
  worksheetEntryId: string;
  worksheetNumber: number;
  grade: string;
  isAbsent: boolean;
  isIncorrectGrade: boolean;
  isUploading: boolean;
  page1Uri?: string | null;
  page2Uri?: string | null;
  page1Url?: string | null;
  page2Url?: string | null;
  gradingDetails?: GradingDetails | null;
  wrongQuestionNumbers?: string | null;
  id?: string | null; // database ID
  existing?: boolean;
  jobId?: string | null;
  jobStatus?: string | null;
  isRepeated?: boolean;
}

interface WorksheetSlotProps {
  data: WorksheetSlotData;
  disabled?: boolean;
  isOffline?: boolean;
  onFieldChange: (field: string, value: string | number | boolean) => void;
  onPageScan: (pageNumber: number) => void;
  onPageGallery: (pageNumber: number) => void;
  onPagePreview: (pageNumber: number) => void;
  onScanBothPages: () => void;
  onAiGrade: () => void;
  onSave: () => void;
  onShowDetails: () => void;
}

export function WorksheetSlot({
  data,
  disabled,
  isOffline,
  onFieldChange,
  onPageScan,
  onPageGallery,
  onPagePreview,
  onScanBothPages,
  onAiGrade,
  onSave,
  onShowDetails,
}: WorksheetSlotProps) {
  const isDisabled = disabled || data.isAbsent;
  const hasPages = !!(data.page1Uri || data.page1Url || data.page2Uri || data.page2Url);
  const canGrade = !isOffline && !data.isUploading && data.worksheetNumber > 0 && hasPages;
  const canSave = !isOffline && !data.isUploading;
  const wrongCount = data.gradingDetails
    ? data.gradingDetails.wrong_answers + data.gradingDetails.unanswered
    : 0;

  return (
    <View style={styles.container}>
      {/* Worksheet # and Grade row */}
      <View style={styles.row}>
        <View style={styles.fieldSmall}>
          <Text style={styles.fieldLabel}>Worksheet #</Text>
          <TextInput
            style={[styles.input, isDisabled && styles.inputDisabled]}
            keyboardType="number-pad"
            value={data.worksheetNumber > 0 ? String(data.worksheetNumber) : ''}
            onChangeText={(text) => {
              const num = parseInt(text, 10);
              onFieldChange('worksheetNumber', Number.isNaN(num) ? 0 : num);
            }}
            editable={!isDisabled}
            placeholder="#"
            placeholderTextColor={colors.gray400}
          />
        </View>
        <View style={styles.fieldSmall}>
          <Text style={styles.fieldLabel}>Grade</Text>
          <TextInput
            style={[styles.input, isDisabled && styles.inputDisabled]}
            keyboardType="number-pad"
            value={data.grade}
            onChangeText={(text) => onFieldChange('grade', text)}
            editable={!isDisabled}
            placeholder="0-40"
            placeholderTextColor={colors.gray400}
          />
        </View>
        {data.gradingDetails && (
          <Pressable style={styles.infoButton} onPress={onShowDetails}>
            <Text style={styles.infoButtonText}>ℹ</Text>
            {wrongCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{wrongCount}</Text>
              </View>
            )}
          </Pressable>
        )}
      </View>

      {/* Wrong questions */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Wrong Questions</Text>
        <TextInput
          style={[styles.input, isDisabled && styles.inputDisabled]}
          value={data.wrongQuestionNumbers || ''}
          onChangeText={(text) => onFieldChange('wrongQuestionNumbers', text)}
          editable={!isDisabled}
          placeholder="e.g. 1, 3, 7"
          placeholderTextColor={colors.gray400}
        />
      </View>

      {/* Page slots */}
      <View style={styles.pagesRow}>
        <PageSlot
          pageNumber={1}
          imageUri={data.page1Uri}
          imageUrl={data.page1Url}
          disabled={isDisabled}
          onScan={() => onPageScan(1)}
          onPickGallery={() => onPageGallery(1)}
          onPreview={() => onPagePreview(1)}
        />
        <PageSlot
          pageNumber={2}
          imageUri={data.page2Uri}
          imageUrl={data.page2Url}
          disabled={isDisabled}
          onScan={() => onPageScan(2)}
          onPickGallery={() => onPageGallery(2)}
          onPreview={() => onPagePreview(2)}
        />
      </View>

      {/* Scan both pages button */}
      <Pressable
        style={[styles.scanBothButton, isDisabled && styles.disabled]}
        onPress={onScanBothPages}
        disabled={isDisabled}
      >
        <Text style={styles.scanBothText}>Scan Pages</Text>
      </Pressable>

      {/* Checkboxes */}
      <View style={styles.checkboxRow}>
        <View style={styles.checkboxItem}>
          <Switch
            value={data.isAbsent}
            onValueChange={(val) => onFieldChange('isAbsent', val)}
            trackColor={{ true: colors.gray400, false: colors.gray200 }}
            disabled={disabled}
          />
          <Text style={styles.checkboxLabel}>Absent</Text>
        </View>
        <View style={styles.checkboxItem}>
          <Switch
            value={data.isIncorrectGrade}
            onValueChange={(val) => onFieldChange('isIncorrectGrade', val)}
            trackColor={{ true: colors.red, false: colors.gray200 }}
            disabled={disabled}
          />
          <Text style={styles.checkboxLabel}>Incorrect Grade</Text>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.gradeButton, (!canGrade || data.isAbsent) && styles.disabled]}
          onPress={onAiGrade}
          disabled={!canGrade || data.isAbsent}
        >
          {data.isUploading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.gradeButtonText}>AI Grade</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.saveButton, !canSave && styles.disabled]}
          onPress={onSave}
          disabled={!canSave}
        >
          <Text style={styles.saveButtonText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  fieldSmall: {
    flex: 1,
  },
  field: {},
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.gray900,
  },
  inputDisabled: {
    backgroundColor: colors.gray100,
    color: colors.gray400,
  },
  pagesRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  scanBothButton: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  scanBothText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.primary,
  },
  checkboxRow: {
    flexDirection: 'row',
    gap: spacing.xl,
  },
  checkboxItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  checkboxLabel: {
    fontSize: fontSize.sm,
    color: colors.gray700,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  gradeButton: {
    flex: 1,
    backgroundColor: colors.blue,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  gradeButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.white,
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.gray700,
  },
  disabled: {
    opacity: 0.4,
  },
  infoButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoButtonText: {
    fontSize: fontSize.xl,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: colors.red,
    borderRadius: borderRadius.full,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.white,
  },
});
