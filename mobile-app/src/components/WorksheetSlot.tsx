import React from 'react';
import {
  ActivityIndicator,
  Platform,
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
  id?: string | null;
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
      {/* Worksheet # and Grade */}
      <View style={styles.fieldsRow}>
        <View style={styles.fieldGroup}>
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
        <View style={styles.fieldGroup}>
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
          <Pressable style={styles.detailsButton} onPress={onShowDetails} hitSlop={8}>
            <Text style={styles.detailsButtonText}>Details</Text>
            {wrongCount > 0 && (
              <View style={styles.wrongBadge}>
                <Text style={styles.wrongBadgeText}>{wrongCount}</Text>
              </View>
            )}
          </Pressable>
        )}
      </View>

      {/* Wrong questions */}
      <View>
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

      {/* Pages */}
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

      {/* Scan both */}
      <Pressable
        style={({ pressed }) => [
          styles.scanBothButton,
          isDisabled && styles.disabled,
          pressed && { opacity: 0.7 },
        ]}
        onPress={onScanBothPages}
        disabled={isDisabled}
      >
        <Text style={styles.scanBothText}>📷  Scan Both Pages</Text>
      </Pressable>

      {/* Toggles */}
      <View style={styles.togglesRow}>
        <View style={styles.toggleItem}>
          <Switch
            value={data.isAbsent}
            onValueChange={(val) => onFieldChange('isAbsent', val)}
            trackColor={{ true: colors.gray500, false: colors.gray200 }}
            thumbColor={Platform.select({ android: data.isAbsent ? colors.gray600 : colors.gray100 })}
            disabled={disabled}
          />
          <Text style={styles.toggleLabel}>Absent</Text>
        </View>
        <View style={styles.toggleItem}>
          <Switch
            value={data.isIncorrectGrade}
            onValueChange={(val) => onFieldChange('isIncorrectGrade', val)}
            trackColor={{ true: '#EF4444', false: colors.gray200 }}
            thumbColor={Platform.select({ android: data.isIncorrectGrade ? '#DC2626' : colors.gray100 })}
            disabled={disabled}
          />
          <Text style={styles.toggleLabel}>Incorrect Grade</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.aiGradeButton,
            (!canGrade || data.isAbsent) && styles.disabled,
            pressed && { opacity: 0.8 },
          ]}
          onPress={onAiGrade}
          disabled={!canGrade || data.isAbsent}
        >
          {data.isUploading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.aiGradeText}>AI Grade</Text>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.saveButton,
            !canSave && styles.disabled,
            pressed && { opacity: 0.8 },
          ]}
          onPress={onSave}
          disabled={!canSave}
        >
          <Text style={styles.saveText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  fieldsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-end',
  },
  fieldGroup: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    color: colors.gray500,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.gray50,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.select({ ios: 12, android: 10 }),
    fontSize: fontSize.md,
    color: colors.gray900,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  inputDisabled: {
    backgroundColor: colors.gray100,
    color: colors.gray400,
    borderColor: colors.gray100,
  },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.md,
  },
  detailsButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  wrongBadge: {
    backgroundColor: colors.red,
    borderRadius: borderRadius.full,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  wrongBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.white,
  },
  pagesRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  scanBothButton: {
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.blueLight,
  },
  scanBothText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
  togglesRow: {
    flexDirection: 'row',
    gap: spacing.xxl,
  },
  toggleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleLabel: {
    fontSize: fontSize.sm,
    color: colors.gray700,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiGradeButton: {
    backgroundColor: colors.primary,
  },
  aiGradeText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.white,
  },
  saveButton: {
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  saveText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.gray700,
  },
  disabled: {
    opacity: 0.4,
  },
});
