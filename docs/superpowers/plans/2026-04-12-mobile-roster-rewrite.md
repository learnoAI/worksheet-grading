# Mobile Roster Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile app's capture-first UI with a web-app-style roster-of-cards layout, adding platform-native document scanning, while reusing existing api/queue/auth modules.

**Architecture:** Clean rewrite of the UI layer into separate screen/component/hook files. The existing `src/api/client.ts`, `src/queue/storage.ts`, `src/queue/uploader.ts`, `src/auth/session.ts`, `src/types.ts`, `src/config.ts`, and `src/utils/` are reused with extensions. New screens (RosterScreen, QueueScreen) and components are built in isolation and composed in the final screens.

**Tech Stack:** Expo 54, React Native 0.81, TypeScript 5.9, `react-native-document-scanner-plugin` (platform-native scanning), `@react-native-community/datetimepicker` (native date picker), `expo-sqlite` (local queue), `expo-file-system` (S3 uploads), `expo-secure-store` (auth tokens).

**Design doc:** `docs/plans/2026-04-12-mobile-roster-rewrite-design.md`

**Verification strategy:** `npm run typecheck` after every code task. Manual device testing after screen-level tasks.

---

## File Structure

```
mobile-app/
  App.tsx                         — auth gate + tab navigation (rewritten, slim)
  src/
    screens/
      LoginScreen.tsx             — extracted from current App.tsx, minimal changes
      RosterScreen.tsx            — main roster view (new)
      QueueScreen.tsx             — filterable queue (rewritten)
    components/
      StudentCard.tsx             — per-student card with carousel (new)
      WorksheetSlot.tsx           — single worksheet form within carousel (new)
      PageSlot.tsx                — page image slot with scan/pick buttons (new)
      GradingDetailsModal.tsx     — full-screen grading details (new)
      ImagePreviewModal.tsx       — full-screen image viewer (new)
      StatChips.tsx               — horizontal stats row (new)
      GradingStatusBanner.tsx     — compact tappable job status (new)
      DatePicker.tsx              — native date picker wrapper (new)
    hooks/
      useRoster.ts                — class/date/student state + save/grade actions (new)
      useGradingJobs.ts           — job polling + status banner data (new)
      useDocumentScanner.ts       — scanner + gallery picker (new)
      useNetworkStatus.ts         — online/offline tracking (new)
    api/client.ts                 — extended with save/delete/jobs endpoints
    queue/storage.ts              — no changes
    queue/uploader.ts             — no changes
    auth/session.ts               — no changes
    types.ts                      — extended with roster view types
    config.ts                     — no changes
    utils/date.ts                 — no changes
    utils/id.ts                   — no changes
    theme.ts                      — shared colors/spacing constants (new)
```

---

### Task 1: Install Dependencies & Create Theme

**Files:**
- Modify: `mobile-app/package.json`
- Create: `mobile-app/src/theme.ts`

- [ ] **Step 1: Install new dependencies**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app
npx expo install @react-native-community/datetimepicker
npm install react-native-document-scanner-plugin
```

- [ ] **Step 2: Add document scanner plugin to app.json**

In `mobile-app/app.json`, add to the `plugins` array:

```json
[
  "expo-secure-store",
  "expo-sqlite",
  "expo-image-picker",
  "react-native-document-scanner-plugin"
]
```

- [ ] **Step 3: Create theme.ts**

```typescript
// mobile-app/src/theme.ts
export const colors = {
  primary: '#007C77',
  primaryLight: '#e0f2f1',
  accent: '#D54B43',
  amber: '#F59E0B',
  amberLight: '#FEF3C7',
  green: '#10B981',
  greenLight: '#D1FAE5',
  blue: '#3B82F6',
  blueLight: '#DBEAFE',
  red: '#EF4444',
  redLight: '#FEE2E2',
  orange: '#F97316',
  orangeLight: '#FED7AA',
  white: '#FFFFFF',
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',
  black: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  title: 28,
} as const;

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;
```

- [ ] **Step 4: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add mobile-app/package.json mobile-app/package-lock.json mobile-app/app.json mobile-app/src/theme.ts
git commit -m "feat(mobile): add document scanner and date picker deps, create theme"
```

---

### Task 2: Extend API Client & Types

**Files:**
- Modify: `mobile-app/src/api/client.ts`
- Modify: `mobile-app/src/types.ts`

- [ ] **Step 1: Add save/delete/jobs types to types.ts**

Append to `mobile-app/src/types.ts`:

```typescript
export interface CreateGradedWorksheetData {
  classId: string;
  studentId: string;
  worksheetNumber: number;
  grade: number;
  submittedOn: string;
  isAbsent?: boolean;
  isRepeated?: boolean;
  isCorrectGrade?: boolean;
  isIncorrectGrade?: boolean;
  gradingDetails?: GradingDetails | null;
  wrongQuestionNumbers?: string | null;
}

export interface SavedWorksheet {
  id: string;
  classId: string;
  studentId: string;
  worksheetNumber: number;
  grade: number;
  submittedOn: string;
  isAbsent?: boolean;
  isRepeated?: boolean;
  isCorrectGrade?: boolean;
  isIncorrectGrade?: boolean;
  gradingDetails?: GradingDetails | null;
  wrongQuestionNumbers?: string | null;
  images?: WorksheetImageRecord[];
}

export interface BatchSaveRequest {
  classId: string;
  submittedOn: string;
  worksheets: Array<{
    studentId: string;
    worksheetNumber?: number;
    grade?: string | number;
    isAbsent?: boolean;
    isRepeated?: boolean;
    isIncorrectGrade?: boolean;
    gradingDetails?: GradingDetails | null;
    wrongQuestionNumbers?: string;
    action?: 'save' | 'delete';
  }>;
}

export interface BatchSaveResponse {
  success: boolean;
  saved: number;
  updated: number;
  deleted: number;
  failed: number;
  errors: { studentId: string; error: string }[];
}

export interface GradingJobSummary {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}
```

- [ ] **Step 2: Add new API methods to client.ts**

Add these methods to the `ApiClient` class in `mobile-app/src/api/client.ts`:

```typescript
  async createGradedWorksheet(data: CreateGradedWorksheetData): Promise<SavedWorksheet> {
    const body = data.isAbsent
      ? { ...data, worksheetNumber: 0, grade: 0 }
      : data;
    return this.request('/worksheets/grade', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateGradedWorksheet(id: string, data: CreateGradedWorksheetData): Promise<SavedWorksheet> {
    const body = data.isAbsent
      ? { ...data, worksheetNumber: 0, grade: 0 }
      : data;
    return this.request(`/worksheets/grade/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async deleteGradedWorksheet(id: string): Promise<void> {
    return this.request(`/worksheets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async getWorksheetById(id: string): Promise<SavedWorksheet> {
    return this.request(`/worksheets/${encodeURIComponent(id)}`);
  }

  async getTeacherJobsToday(): Promise<TeacherJobsResponse> {
    return this.request('/grading-jobs/teacher/today');
  }

  async batchSaveWorksheets(
    classId: string,
    submittedOn: string,
    worksheets: BatchSaveRequest['worksheets'],
  ): Promise<BatchSaveResponse> {
    return this.request('/worksheets/batch-save', {
      method: 'POST',
      body: JSON.stringify({ classId, submittedOn, worksheets }),
    });
  }
```

Also add the new type imports at the top of `client.ts`:

```typescript
import {
  BatchSaveRequest,
  BatchSaveResponse,
  ClassDateResponse,
  CreateGradedWorksheetData,
  DirectUploadSession,
  DirectUploadWorksheetRequest,
  FinalizeDirectUploadSessionResponse,
  GradingJob,
  SavedWorksheet,
  TeacherClass,
  TeacherJobsResponse,
  User,
} from '../types';
```

- [ ] **Step 3: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add mobile-app/src/api/client.ts mobile-app/src/types.ts
git commit -m "feat(mobile): extend API client with save, delete, and jobs endpoints"
```

---

### Task 3: Extract LoginScreen

**Files:**
- Create: `mobile-app/src/screens/LoginScreen.tsx`

- [ ] **Step 1: Create LoginScreen.tsx**

Extract the login UI from the current `App.tsx` into its own file. The login screen accepts `onLogin` callback and renders the username/password form:

```typescript
// mobile-app/src/screens/LoginScreen.tsx
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, apiClient } from '../api/client';
import { saveAuthToken } from '../auth/session';
import { API_BASE_URL, isSupportedTeacherRole } from '../config';
import { colors, fontSize, spacing, borderRadius } from '../theme';
import { User } from '../types';

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      Alert.alert('Error', 'Username and password are required.');
      return;
    }

    setLoading(true);
    try {
      const { user, token } = await apiClient.login(trimmedUsername, password);

      if (!isSupportedTeacherRole(user.role)) {
        Alert.alert('Access Denied', 'Only teachers, admins, and superadmins can use this app.');
        return;
      }

      await saveAuthToken(token);
      apiClient.setToken(token);
      onLogin(user);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Unable to connect. Check your network and try again.';
      Alert.alert('Login Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <Text style={styles.title}>Teacher Capture</Text>
        <Text style={styles.subtitle}>Sign in to get started</Text>

        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={colors.gray400}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.gray400}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!loading}
          onSubmitEditing={handleLogin}
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </Pressable>

        <Text style={styles.endpoint} numberOfLines={1}>
          {API_BASE_URL}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.gray500,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    color: colors.gray900,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  endpoint: {
    fontSize: fontSize.xs,
    color: colors.gray400,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/screens/LoginScreen.tsx
git commit -m "feat(mobile): extract LoginScreen to its own file"
```

---

### Task 4: useNetworkStatus Hook

**Files:**
- Create: `mobile-app/src/hooks/useNetworkStatus.ts`

- [ ] **Step 1: Create useNetworkStatus.ts**

Simple hook that tracks `navigator.onLine` state via event listeners. React Native doesn't have `navigator.onLine` by default, so we use a try/fetch approach and the `NetInfo`-equivalent pattern with AppState:

```typescript
// mobile-app/src/hooks/useNetworkStatus.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { API_BASE_URL } from '../config';

export function useNetworkStatus(checkIntervalMs = 30_000) {
  const [isOnline, setIsOnline] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      setIsOnline(true);
    } catch {
      setIsOnline(false);
    }
  }, []);

  useEffect(() => {
    check();
    intervalRef.current = setInterval(check, checkIntervalMs);

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        check();
      }
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      subscription.remove();
    };
  }, [check, checkIntervalMs]);

  return isOnline;
}
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/hooks/useNetworkStatus.ts
git commit -m "feat(mobile): add useNetworkStatus hook"
```

---

### Task 5: useDocumentScanner Hook

**Files:**
- Create: `mobile-app/src/hooks/useDocumentScanner.ts`

- [ ] **Step 1: Create useDocumentScanner.ts**

```typescript
// mobile-app/src/hooks/useDocumentScanner.ts
import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import DocumentScanner from 'react-native-document-scanner-plugin';

export interface ScannedPage {
  uri: string;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
  fileSize?: number;
}

export function useDocumentScanner() {
  const scanPages = useCallback(async (): Promise<ScannedPage[]> => {
    try {
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: 2,
      });

      if (!result.scannedImages || result.scannedImages.length === 0) {
        return [];
      }

      const pages: ScannedPage[] = result.scannedImages.map((uri, index) => ({
        uri: Platform.OS === 'android' ? uri : uri,
        mimeType: 'image/jpeg',
        fileName: `scan-page-${index + 1}.jpg`,
      }));

      if (pages.length > 2) {
        Alert.alert(
          'Extra pages',
          `${pages.length} pages scanned, using first 2.`,
        );
      }

      return pages.slice(0, 2);
    } catch (error) {
      if (error instanceof Error && error.message?.includes('cancel')) {
        return [];
      }
      Alert.alert('Scanner Error', 'Unable to open document scanner.');
      return [];
    }
  }, []);

  const scanSinglePage = useCallback(async (): Promise<ScannedPage | null> => {
    try {
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: 1,
      });

      if (!result.scannedImages || result.scannedImages.length === 0) {
        return null;
      }

      return {
        uri: result.scannedImages[0],
        mimeType: 'image/jpeg',
        fileName: 'scan-page.jpg',
      };
    } catch (error) {
      if (error instanceof Error && error.message?.includes('cancel')) {
        return null;
      }
      Alert.alert('Scanner Error', 'Unable to open document scanner.');
      return null;
    }
  }, []);

  const pickFromGallery = useCallback(async (): Promise<ScannedPage | null> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Please allow photo library access.');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      exif: true,
    });

    if (result.canceled || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    return {
      uri: asset.uri,
      mimeType: asset.mimeType || 'image/jpeg',
      fileName: asset.fileName || `gallery-${Date.now()}.jpg`,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize ?? undefined,
    };
  }, []);

  return { scanPages, scanSinglePage, pickFromGallery };
}
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

Note: `react-native-document-scanner-plugin` types may need a declaration file if the package doesn't ship types. If typecheck fails with "could not find declaration file", create `mobile-app/src/types/react-native-document-scanner-plugin.d.ts`:

```typescript
declare module 'react-native-document-scanner-plugin' {
  interface ScanDocumentOptions {
    maxNumDocuments?: number;
  }
  interface ScanDocumentResult {
    scannedImages?: string[];
    status?: string;
  }
  const DocumentScanner: {
    scanDocument(options?: ScanDocumentOptions): Promise<ScanDocumentResult>;
  };
  export default DocumentScanner;
}
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/hooks/useDocumentScanner.ts mobile-app/src/types/
git commit -m "feat(mobile): add useDocumentScanner hook with scanner + gallery"
```

---

### Task 6: DatePicker Component

**Files:**
- Create: `mobile-app/src/components/DatePicker.tsx`

- [ ] **Step 1: Create DatePicker.tsx**

```typescript
// mobile-app/src/components/DatePicker.tsx
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';
import { formatShortDate, toDateInputValue } from '../utils/date';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  label?: string;
}

export function DatePicker({ value, onChange, label }: DatePickerProps) {
  const [show, setShow] = useState(false);

  const dateObj = new Date(`${value}T00:00:00`);

  const handleChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShow(false);
    }
    if (selected) {
      onChange(toDateInputValue(selected));
    }
  };

  if (Platform.OS === 'ios') {
    return (
      <View style={styles.wrapper}>
        {label && <Text style={styles.label}>{label}</Text>}
        <DateTimePicker
          value={dateObj}
          mode="date"
          display="compact"
          onChange={handleChange}
          style={styles.iosPicker}
        />
      </View>
    );
  }

  // Android: show a button that opens the picker
  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Pressable style={styles.androidButton} onPress={() => setShow(true)}>
        <Text style={styles.androidButtonText}>{formatShortDate(value)}</Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display="default"
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.gray700,
    marginBottom: spacing.xs,
  },
  iosPicker: {
    alignSelf: 'flex-start',
  },
  androidButton: {
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
  },
  androidButtonText: {
    fontSize: fontSize.md,
    color: colors.gray800,
  },
});
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/components/DatePicker.tsx
git commit -m "feat(mobile): add native DatePicker component"
```

---

### Task 7: StatChips & GradingStatusBanner Components

**Files:**
- Create: `mobile-app/src/components/StatChips.tsx`
- Create: `mobile-app/src/components/GradingStatusBanner.tsx`

- [ ] **Step 1: Create StatChips.tsx**

```typescript
// mobile-app/src/components/StatChips.tsx
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';

interface StatChipsProps {
  totalStudents: number;
  studentsGraded: number;
  worksheetsGraded: number;
  absentCount: number;
}

export function StatChips({
  totalStudents,
  studentsGraded,
  worksheetsGraded,
  absentCount,
}: StatChipsProps) {
  const completion =
    totalStudents > 0 ? Math.round((studentsGraded / totalStudents) * 100) : 0;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      <View style={[styles.chip, { backgroundColor: colors.blueLight }]}>
        <Text style={[styles.chipText, { color: colors.blue }]}>
          Graded {studentsGraded}/{totalStudents}
        </Text>
      </View>
      <View style={[styles.chip, { backgroundColor: colors.greenLight }]}>
        <Text style={[styles.chipText, { color: colors.green }]}>
          Worksheets {worksheetsGraded}
        </Text>
      </View>
      <View style={[styles.chip, { backgroundColor: colors.orangeLight }]}>
        <Text style={[styles.chipText, { color: colors.orange }]}>
          Absent {absentCount}
        </Text>
      </View>
      <View style={[styles.chip, { backgroundColor: colors.primaryLight }]}>
        <Text style={[styles.chipText, { color: colors.primary }]}>
          {completion}%
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  chipText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
```

- [ ] **Step 2: Create GradingStatusBanner.tsx**

```typescript
// mobile-app/src/components/GradingStatusBanner.tsx
import React from 'react';
import {
  ActivityIndicator,
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
    <Pressable style={styles.banner} onPress={onPress}>
      {isActive && <ActivityIndicator size="small" color={colors.blue} />}
      {!isActive && <Text style={styles.checkmark}>✓</Text>}
      <View style={styles.pills}>
        {summary.processing > 0 && (
          <Text style={[styles.pill, styles.processingPill]}>
            {summary.processing} grading
          </Text>
        )}
        {summary.queued > 0 && (
          <Text style={[styles.pill, styles.queuedPill]}>
            {summary.queued} queued
          </Text>
        )}
        {summary.completed > 0 && (
          <Text style={[styles.pill, styles.completedPill]}>
            {summary.completed} done
          </Text>
        )}
        {summary.failed > 0 && (
          <Text style={[styles.pill, styles.failedPill]}>
            {summary.failed} failed
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gray50,
    borderRadius: borderRadius.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  checkmark: {
    fontSize: fontSize.md,
    color: colors.green,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  processingPill: {
    backgroundColor: colors.blueLight,
    color: colors.blue,
  },
  queuedPill: {
    backgroundColor: colors.amberLight,
    color: colors.amber,
  },
  completedPill: {
    backgroundColor: colors.greenLight,
    color: colors.green,
  },
  failedPill: {
    backgroundColor: colors.redLight,
    color: colors.red,
  },
});
```

- [ ] **Step 3: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add mobile-app/src/components/StatChips.tsx mobile-app/src/components/GradingStatusBanner.tsx
git commit -m "feat(mobile): add StatChips and GradingStatusBanner components"
```

---

### Task 8: ImagePreviewModal & GradingDetailsModal

**Files:**
- Create: `mobile-app/src/components/ImagePreviewModal.tsx`
- Create: `mobile-app/src/components/GradingDetailsModal.tsx`

- [ ] **Step 1: Create ImagePreviewModal.tsx**

```typescript
// mobile-app/src/components/ImagePreviewModal.tsx
import React from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, spacing } from '../theme';

interface ImagePreviewModalProps {
  visible: boolean;
  uri: string | null;
  title?: string;
  onClose: () => void;
}

export function ImagePreviewModal({
  visible,
  uri,
  title,
  onClose,
}: ImagePreviewModalProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{title || 'Image Preview'}</Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        {uri && (
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.white,
  },
  closeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  closeText: {
    fontSize: fontSize.md,
    color: colors.blue,
    fontWeight: '600',
  },
  image: {
    flex: 1,
  },
});
```

- [ ] **Step 2: Create GradingDetailsModal.tsx**

```typescript
// mobile-app/src/components/GradingDetailsModal.tsx
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, spacing, borderRadius } from '../theme';
import { GradingDetails, QuestionScore } from '../types';

interface GradingDetailsModalProps {
  visible: boolean;
  details: GradingDetails | null;
  studentName: string;
  onClose: () => void;
}

function QuestionRow({ q, type }: { q: QuestionScore; type: 'wrong' | 'unanswered' | 'correct' }) {
  const bgColor =
    type === 'wrong' ? colors.redLight : type === 'unanswered' ? colors.amberLight : colors.greenLight;
  const textColor =
    type === 'wrong' ? colors.red : type === 'unanswered' ? colors.amber : colors.green;

  return (
    <View style={[styles.questionRow, { backgroundColor: bgColor }]}>
      <Text style={[styles.questionNumber, { color: textColor }]}>Q{q.question_number}</Text>
      <View style={styles.questionContent}>
        {q.student_answer ? (
          <Text style={styles.answerText}>Student: {q.student_answer}</Text>
        ) : null}
        <Text style={styles.answerText}>Correct: {q.correct_answer}</Text>
        {q.feedback ? <Text style={styles.feedbackText}>{q.feedback}</Text> : null}
      </View>
    </View>
  );
}

export function GradingDetailsModal({
  visible,
  details,
  studentName,
  onClose,
}: GradingDetailsModalProps) {
  if (!details) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Grading Details</Text>
            <Text style={styles.subtitle}>{studentName}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {/* Summary */}
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, { backgroundColor: colors.greenLight }]}>
              <Text style={[styles.summaryValue, { color: colors.green }]}>
                {details.correct_answers}
              </Text>
              <Text style={styles.summaryLabel}>Correct</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.redLight }]}>
              <Text style={[styles.summaryValue, { color: colors.red }]}>
                {details.wrong_answers}
              </Text>
              <Text style={styles.summaryLabel}>Wrong</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.amberLight }]}>
              <Text style={[styles.summaryValue, { color: colors.amber }]}>
                {details.unanswered}
              </Text>
              <Text style={styles.summaryLabel}>Unanswered</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.blueLight }]}>
              <Text style={[styles.summaryValue, { color: colors.blue }]}>
                {Math.round(details.grade_percentage)}%
              </Text>
              <Text style={styles.summaryLabel}>Score</Text>
            </View>
          </View>

          {/* Feedback */}
          {details.overall_feedback ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Feedback</Text>
              <Text style={styles.feedbackBody}>{details.overall_feedback}</Text>
            </View>
          ) : null}

          {/* Wrong */}
          {details.wrong_questions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Wrong Answers ({details.wrong_questions.length})
              </Text>
              {details.wrong_questions.map((q) => (
                <QuestionRow key={q.question_number} q={q} type="wrong" />
              ))}
            </View>
          )}

          {/* Unanswered */}
          {details.unanswered_questions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Unanswered ({details.unanswered_questions.length})
              </Text>
              {details.unanswered_questions.map((q) => (
                <QuestionRow key={q.question_number} q={q} type="unanswered" />
              ))}
            </View>
          )}

          {/* Correct (collapsed) */}
          {details.correct_questions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Correct ({details.correct_questions.length})
              </Text>
              {details.correct_questions.slice(0, 5).map((q) => (
                <QuestionRow key={q.question_number} q={q} type="correct" />
              ))}
              {details.correct_questions.length > 5 && (
                <Text style={styles.moreText}>
                  +{details.correct_questions.length - 5} more
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray200,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.gray900,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    marginTop: 2,
  },
  closeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  closeText: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  summaryValue: {
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    color: colors.gray600,
    marginTop: 2,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.gray800,
    marginBottom: spacing.sm,
  },
  questionRow: {
    flexDirection: 'row',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
  },
  questionNumber: {
    fontWeight: '700',
    fontSize: fontSize.sm,
    width: 36,
  },
  questionContent: {
    flex: 1,
  },
  answerText: {
    fontSize: fontSize.sm,
    color: colors.gray700,
  },
  feedbackText: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    fontStyle: 'italic',
    marginTop: 2,
  },
  feedbackBody: {
    fontSize: fontSize.sm,
    color: colors.gray700,
    lineHeight: 20,
  },
  moreText: {
    fontSize: fontSize.sm,
    color: colors.gray400,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
```

- [ ] **Step 3: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add mobile-app/src/components/ImagePreviewModal.tsx mobile-app/src/components/GradingDetailsModal.tsx
git commit -m "feat(mobile): add ImagePreview and GradingDetails modals"
```

---

### Task 9: PageSlot Component

**Files:**
- Create: `mobile-app/src/components/PageSlot.tsx`

- [ ] **Step 1: Create PageSlot.tsx**

A single page upload slot showing thumbnail, scanner button, and gallery button:

```typescript
// mobile-app/src/components/PageSlot.tsx
import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fontSize, spacing, borderRadius } from '../theme';

interface PageSlotProps {
  pageNumber: number;
  imageUri?: string | null;
  imageUrl?: string | null; // remote URL from database
  disabled?: boolean;
  onScan: () => void;
  onPickGallery: () => void;
  onPreview: () => void;
}

export function PageSlot({
  pageNumber,
  imageUri,
  imageUrl,
  disabled,
  onScan,
  onPickGallery,
  onPreview,
}: PageSlotProps) {
  const displayUri = imageUri || imageUrl;
  const hasImage = !!displayUri;
  const isSaved = !imageUri && !!imageUrl;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Page {pageNumber}</Text>

      {hasImage ? (
        <Pressable onPress={onPreview} style={styles.previewContainer}>
          <Image source={{ uri: displayUri! }} style={styles.thumbnail} resizeMode="cover" />
          <Text style={styles.statusText}>
            {isSaved ? 'Saved' : 'Ready'}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.emptySlot}>
          <Text style={styles.emptyText}>No image</Text>
        </View>
      )}

      <View style={styles.buttons}>
        <Pressable
          style={[styles.actionButton, styles.scanButton, disabled && styles.disabled]}
          onPress={onScan}
          disabled={disabled}
        >
          <Text style={styles.scanButtonText}>Scan</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, styles.galleryButton, disabled && styles.disabled]}
          onPress={onPickGallery}
          disabled={disabled}
        >
          <Text style={styles.galleryButtonText}>Gallery</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.xs,
  },
  previewContainer: {
    alignItems: 'center',
  },
  thumbnail: {
    width: '100%',
    height: 80,
    borderRadius: borderRadius.md,
    backgroundColor: colors.gray100,
  },
  statusText: {
    fontSize: fontSize.xs,
    color: colors.green,
    fontWeight: '600',
    marginTop: 2,
  },
  emptySlot: {
    height: 80,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.gray300,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.xs,
    color: colors.gray400,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
  },
  scanButton: {
    backgroundColor: colors.primary,
  },
  scanButtonText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.white,
  },
  galleryButton: {
    backgroundColor: colors.gray100,
    borderWidth: 1,
    borderColor: colors.gray300,
  },
  galleryButtonText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.gray700,
  },
  disabled: {
    opacity: 0.4,
  },
});
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/components/PageSlot.tsx
git commit -m "feat(mobile): add PageSlot component with scan and gallery buttons"
```

---

### Task 10: WorksheetSlot Component

**Files:**
- Create: `mobile-app/src/components/WorksheetSlot.tsx`

This is the form for a single worksheet within the carousel — worksheet number, grade, wrong questions, page slots, checkboxes, and action buttons.

- [ ] **Step 1: Create WorksheetSlot.tsx**

```typescript
// mobile-app/src/components/WorksheetSlot.tsx
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

  // Grade options: 0-40
  const gradeOptions = Array.from({ length: 41 }, (_, i) => i);

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
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/components/WorksheetSlot.tsx
git commit -m "feat(mobile): add WorksheetSlot component with form fields and actions"
```

---

### Task 11: StudentCard Component

**Files:**
- Create: `mobile-app/src/components/StudentCard.tsx`

The per-student card with avatar, badges, carousel navigation, and composed WorksheetSlot:

- [ ] **Step 1: Create StudentCard.tsx**

```typescript
// mobile-app/src/components/StudentCard.tsx
import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
  studentId,
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
  const hasRepeatBadge = worksheets.some(
    (w) => !w.isAbsent && (w as any).isRepeated,
  );

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
          {worksheets[activeIndex]?.worksheetEntryId && worksheets.length > 1 && (
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
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/components/StudentCard.tsx
git commit -m "feat(mobile): add StudentCard component with carousel"
```

---

### Task 12: useGradingJobs Hook

**Files:**
- Create: `mobile-app/src/hooks/useGradingJobs.ts`

- [ ] **Step 1: Create useGradingJobs.ts**

Polls `/grading-jobs/teacher/today` at a configurable interval and returns the summary for the banner + badge:

```typescript
// mobile-app/src/hooks/useGradingJobs.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { apiClient } from '../api/client';
import { GradingJobSummary } from '../types';

export function useGradingJobs(intervalMs = 5_000) {
  const [summary, setSummary] = useState<GradingJobSummary | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    try {
      const response = await apiClient.getTeacherJobsToday();
      if (response.summary) {
        setSummary(response.summary);
      }
    } catch {
      // Silently ignore polling errors
    }
  }, []);

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(fetch, intervalMs);

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        fetch();
      }
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      subscription.remove();
    };
  }, [fetch, intervalMs]);

  const activeCount = summary ? summary.queued + summary.processing : 0;

  return { summary, activeCount, refresh: fetch };
}
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/hooks/useGradingJobs.ts
git commit -m "feat(mobile): add useGradingJobs polling hook"
```

---

### Task 13: useRoster Hook

**Files:**
- Create: `mobile-app/src/hooks/useRoster.ts`

This is the core state management hook. It manages class/date selection, fetches the student roster, maintains worksheet state per student, and handles save/grade actions. This mirrors the state logic in the web app's `page.tsx`.

- [ ] **Step 1: Create useRoster.ts**

```typescript
// mobile-app/src/hooks/useRoster.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { apiClient } from '../api/client';
import { WorksheetSlotData } from '../components/WorksheetSlot';
import { queueCapturedWorksheet } from '../queue/storage';
import {
  ClassDateResponse,
  CapturePageDraft,
  CreateGradedWorksheetData,
  StudentSummary,
  TeacherClass,
  User,
  WorksheetRecord,
} from '../types';
import { toDateInputValue } from '../utils/date';
import { createLocalId } from '../utils/id';

const LAST_SELECTION_KEY = 'teacher-capture-last-selection';

interface LastSelection {
  classId: string;
  submittedOn: string;
}

export interface RosterStudent {
  studentId: string;
  studentName: string;
  tokenNumber: string;
  worksheets: WorksheetSlotData[];
}

interface UseRosterResult {
  // State
  classes: TeacherClass[];
  selectedClassId: string | null;
  submittedOn: string;
  students: RosterStudent[];
  filteredStudents: RosterStudent[];
  searchQuery: string;
  loading: boolean;
  loadingRoster: boolean;
  error: string | null;
  stats: ClassDateResponse['stats'] | null;

  // Actions
  setSelectedClassId: (id: string) => void;
  setSubmittedOn: (date: string) => void;
  setSearchQuery: (query: string) => void;
  updateField: (worksheetEntryId: string, field: string, value: string | number | boolean) => void;
  setPageImage: (worksheetEntryId: string, pageNumber: number, uri: string, mimeType: string, fileName: string) => void;
  addWorksheet: (studentId: string) => void;
  removeWorksheet: (worksheetEntryId: string) => void;
  saveStudent: (worksheetEntryId: string) => Promise<void>;
  saveAll: () => Promise<void>;
  aiGrade: (worksheetEntryId: string) => Promise<void>;
  aiGradeAll: () => Promise<void>;
  markUngradedAbsent: () => void;
  refreshRoster: () => Promise<void>;
  getWorksheet: (worksheetEntryId: string) => WorksheetSlotData | undefined;
  findStudentForWorksheet: (worksheetEntryId: string) => RosterStudent | undefined;
}

function buildInitialWorksheet(
  studentId: string,
  summary: StudentSummary | undefined,
  existing?: WorksheetRecord,
): WorksheetSlotData {
  if (existing) {
    return {
      worksheetEntryId: existing.id || createLocalId('entry'),
      worksheetNumber: existing.worksheetNumber ?? 0,
      grade: existing.grade != null ? String(existing.grade) : '',
      isAbsent: !!existing.isAbsent,
      isIncorrectGrade: !!existing.isIncorrectGrade,
      isUploading: false,
      page1Url: existing.images?.find((img) => img.pageNumber === 1)?.imageUrl ?? null,
      page2Url: existing.images?.find((img) => img.pageNumber === 2)?.imageUrl ?? null,
      gradingDetails: existing.gradingDetails ?? null,
      wrongQuestionNumbers: existing.wrongQuestionNumbers ?? null,
      id: existing.id ?? null,
      existing: true,
      isRepeated: existing.isRepeated ?? false,
    } as WorksheetSlotData & { isRepeated: boolean };
  }

  const wsNum = summary?.recommendedWorksheetNumber ?? 1;
  return {
    worksheetEntryId: createLocalId('entry'),
    worksheetNumber: wsNum,
    grade: '',
    isAbsent: false,
    isIncorrectGrade: false,
    isUploading: false,
    isRepeated: summary?.isRecommendedRepeated ?? false,
  } as WorksheetSlotData & { isRepeated: boolean };
}

export function useRoster(user: User): UseRosterResult {
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [selectedClassId, setSelectedClassIdRaw] = useState<string | null>(null);
  const [submittedOn, setSubmittedOnRaw] = useState(toDateInputValue());
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [stats, setStats] = useState<ClassDateResponse['stats'] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load classes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const teacherClasses = await apiClient.getTeacherClasses(user);
        if (cancelled) return;
        setClasses(teacherClasses);

        const stored = await AsyncStorage.getItem(LAST_SELECTION_KEY);
        const last: LastSelection | null = stored ? JSON.parse(stored) : null;
        if (last && teacherClasses.some((c) => c.id === last.classId)) {
          setSelectedClassIdRaw(last.classId);
          setSubmittedOnRaw(last.submittedOn || toDateInputValue());
        } else if (teacherClasses.length > 0) {
          setSelectedClassIdRaw(teacherClasses[0].id);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load classes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Persist selection
  const setSelectedClassId = useCallback((id: string) => {
    setSelectedClassIdRaw(id);
    AsyncStorage.setItem(LAST_SELECTION_KEY, JSON.stringify({ classId: id, submittedOn }));
  }, [submittedOn]);

  const setSubmittedOn = useCallback((date: string) => {
    setSubmittedOnRaw(date);
    if (selectedClassId) {
      AsyncStorage.setItem(LAST_SELECTION_KEY, JSON.stringify({ classId: selectedClassId, submittedOn: date }));
    }
  }, [selectedClassId]);

  // Load roster
  const loadRoster = useCallback(async () => {
    if (!selectedClassId) return;
    setLoadingRoster(true);
    setError(null);
    try {
      const data = await apiClient.getClassWorksheetsForDate(selectedClassId, submittedOn);
      setStats(data.stats);

      const rosterStudents: RosterStudent[] = data.students.map((s) => {
        const existingWorksheets = data.worksheetsByStudent[s.id] || [];
        const summary = data.studentSummaries[s.id];

        const worksheets: WorksheetSlotData[] =
          existingWorksheets.length > 0
            ? existingWorksheets.map((ws) => buildInitialWorksheet(s.id, summary, ws))
            : [buildInitialWorksheet(s.id, summary)];

        return {
          studentId: s.id,
          studentName: s.name,
          tokenNumber: s.tokenNumber,
          worksheets,
        };
      });

      // Sort by token number
      rosterStudents.sort((a, b) => a.tokenNumber.localeCompare(b.tokenNumber, undefined, { numeric: true }));
      setStudents(rosterStudents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roster');
    } finally {
      setLoadingRoster(false);
    }
  }, [selectedClassId, submittedOn]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return students;
    const q = searchQuery.toLowerCase().trim();
    return students.filter(
      (s) =>
        s.studentName.toLowerCase().includes(q) ||
        s.tokenNumber.toLowerCase().includes(q),
    );
  }, [students, searchQuery]);

  // Update a worksheet field
  const updateField = useCallback(
    (worksheetEntryId: string, field: string, value: string | number | boolean) => {
      setStudents((prev) =>
        prev.map((student) => ({
          ...student,
          worksheets: student.worksheets.map((ws) => {
            if (ws.worksheetEntryId !== worksheetEntryId) return ws;

            if (field === 'isAbsent' && value === true) {
              return {
                ...ws,
                isAbsent: true,
                worksheetNumber: 0,
                grade: '',
                page1Uri: null,
                page2Uri: null,
              };
            }

            return { ...ws, [field]: value };
          }),
        })),
      );

      // Check isRepeated when worksheetNumber changes
      if (field === 'worksheetNumber' && typeof value === 'number' && value > 0 && selectedClassId) {
        const student = students.find((s) =>
          s.worksheets.some((ws) => ws.worksheetEntryId === worksheetEntryId),
        );
        if (student) {
          apiClient
            .checkIsRepeated(selectedClassId, student.studentId, value, submittedOn)
            .then((result) => {
              setStudents((prev) =>
                prev.map((s) => ({
                  ...s,
                  worksheets: s.worksheets.map((ws) =>
                    ws.worksheetEntryId === worksheetEntryId
                      ? { ...ws, isRepeated: result.isRepeated }
                      : ws,
                  ),
                })),
              );
            })
            .catch(() => undefined);
        }
      }
    },
    [selectedClassId, submittedOn, students],
  );

  // Set page image
  const setPageImage = useCallback(
    (worksheetEntryId: string, pageNumber: number, uri: string, mimeType: string, fileName: string) => {
      const key = pageNumber === 1 ? 'page1Uri' : 'page2Uri';
      setStudents((prev) =>
        prev.map((student) => ({
          ...student,
          worksheets: student.worksheets.map((ws) =>
            ws.worksheetEntryId === worksheetEntryId
              ? { ...ws, [key]: uri, isAbsent: false }
              : ws,
          ),
        })),
      );
    },
    [],
  );

  // Add worksheet
  const addWorksheet = useCallback((studentId: string) => {
    setStudents((prev) =>
      prev.map((student) => {
        if (student.studentId !== studentId) return student;
        const maxWs = Math.max(...student.worksheets.map((w) => w.worksheetNumber), 0);
        const newWs: WorksheetSlotData = {
          worksheetEntryId: createLocalId('entry'),
          worksheetNumber: maxWs + 1,
          grade: '',
          isAbsent: false,
          isIncorrectGrade: false,
          isUploading: false,
        };
        return { ...student, worksheets: [...student.worksheets, newWs] };
      }),
    );
  }, []);

  // Remove worksheet
  const removeWorksheet = useCallback((worksheetEntryId: string) => {
    setStudents((prev) =>
      prev.map((student) => {
        if (!student.worksheets.some((ws) => ws.worksheetEntryId === worksheetEntryId)) return student;
        if (student.worksheets.length <= 1) return student; // Keep at least one
        return {
          ...student,
          worksheets: student.worksheets.filter((ws) => ws.worksheetEntryId !== worksheetEntryId),
        };
      }),
    );
  }, []);

  // Save individual student worksheet
  const saveStudent = useCallback(
    async (worksheetEntryId: string) => {
      if (!selectedClassId) return;
      const student = students.find((s) =>
        s.worksheets.some((ws) => ws.worksheetEntryId === worksheetEntryId),
      );
      const ws = student?.worksheets.find((w) => w.worksheetEntryId === worksheetEntryId);
      if (!student || !ws) return;

      const gradeNum = ws.grade ? parseInt(ws.grade, 10) : 0;
      if (!ws.isAbsent && ws.worksheetNumber <= 0) {
        Alert.alert('Validation', 'Worksheet number is required.');
        return;
      }
      if (!ws.isAbsent && ws.grade && (Number.isNaN(gradeNum) || gradeNum < 0 || gradeNum > 40)) {
        Alert.alert('Validation', 'Grade must be between 0 and 40.');
        return;
      }

      const data: CreateGradedWorksheetData = {
        classId: selectedClassId,
        studentId: student.studentId,
        worksheetNumber: ws.worksheetNumber,
        grade: gradeNum,
        submittedOn: new Date(submittedOn).toISOString(),
        isAbsent: ws.isAbsent,
        isRepeated: (ws as any).isRepeated ?? false,
        isIncorrectGrade: ws.isIncorrectGrade,
        gradingDetails: ws.gradingDetails,
        wrongQuestionNumbers: ws.wrongQuestionNumbers,
      };

      try {
        const saved =
          ws.id && ws.existing
            ? await apiClient.updateGradedWorksheet(ws.id, data)
            : await apiClient.createGradedWorksheet(data);

        setStudents((prev) =>
          prev.map((s) => ({
            ...s,
            worksheets: s.worksheets.map((w) =>
              w.worksheetEntryId === worksheetEntryId
                ? { ...w, id: saved.id, existing: true }
                : w,
            ),
          })),
        );

        Alert.alert('Saved', `${student.studentName} saved.`);
      } catch (err) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Save failed');
      }
    },
    [selectedClassId, submittedOn, students],
  );

  // Save all
  const saveAll = useCallback(async () => {
    if (!selectedClassId) return;

    const toSave = students.flatMap((s) =>
      s.worksheets
        .filter((ws) => ws.isAbsent || ws.worksheetNumber > 0)
        .map((ws) => ({ student: s, ws })),
    );

    let successCount = 0;
    let failCount = 0;

    for (const { student, ws } of toSave) {
      const gradeNum = ws.grade ? parseInt(ws.grade, 10) : 0;
      const data: CreateGradedWorksheetData = {
        classId: selectedClassId,
        studentId: student.studentId,
        worksheetNumber: ws.worksheetNumber,
        grade: gradeNum,
        submittedOn: new Date(submittedOn).toISOString(),
        isAbsent: ws.isAbsent,
        isRepeated: (ws as any).isRepeated ?? false,
        isIncorrectGrade: ws.isIncorrectGrade,
        gradingDetails: ws.gradingDetails,
        wrongQuestionNumbers: ws.wrongQuestionNumbers,
      };

      try {
        const saved =
          ws.id && ws.existing
            ? await apiClient.updateGradedWorksheet(ws.id, data)
            : await apiClient.createGradedWorksheet(data);

        setStudents((prev) =>
          prev.map((s) => ({
            ...s,
            worksheets: s.worksheets.map((w) =>
              w.worksheetEntryId === ws.worksheetEntryId
                ? { ...w, id: saved.id, existing: true }
                : w,
            ),
          })),
        );
        successCount++;
      } catch {
        failCount++;
      }
    }

    Alert.alert('Save All', `Saved: ${successCount}, Failed: ${failCount}`);
  }, [selectedClassId, submittedOn, students]);

  // AI Grade — queues to local SQLite
  const aiGrade = useCallback(
    async (worksheetEntryId: string) => {
      if (!selectedClassId) return;
      const student = students.find((s) =>
        s.worksheets.some((ws) => ws.worksheetEntryId === worksheetEntryId),
      );
      const ws = student?.worksheets.find((w) => w.worksheetEntryId === worksheetEntryId);
      if (!student || !ws) return;

      if (ws.worksheetNumber <= 0) {
        Alert.alert('Validation', 'Worksheet number is required.');
        return;
      }
      if (!ws.page1Uri && !ws.page1Url && !ws.page2Uri && !ws.page2Url) {
        Alert.alert('Validation', 'At least one page image is required.');
        return;
      }

      const pages: CapturePageDraft[] = [];
      if (ws.page1Uri) {
        pages.push({ pageNumber: 1, uri: ws.page1Uri, mimeType: 'image/jpeg', fileName: 'page-1.jpg' });
      }
      if (ws.page2Uri) {
        pages.push({ pageNumber: 2, uri: ws.page2Uri, mimeType: 'image/jpeg', fileName: 'page-2.jpg' });
      }

      if (pages.length === 0) {
        Alert.alert('Validation', 'No new page images to upload. Images are already saved on server.');
        return;
      }

      setStudents((prev) =>
        prev.map((s) => ({
          ...s,
          worksheets: s.worksheets.map((w) =>
            w.worksheetEntryId === worksheetEntryId ? { ...w, isUploading: true } : w,
          ),
        })),
      );

      try {
        const className = classes.find((c) => c.id === selectedClassId)?.name;
        await queueCapturedWorksheet({
          classId: selectedClassId,
          className: className ?? null,
          studentId: student.studentId,
          studentName: student.studentName,
          tokenNumber: student.tokenNumber,
          submittedOn,
          worksheetNumber: ws.worksheetNumber,
          isRepeated: (ws as any).isRepeated ?? false,
          pages,
        });

        setStudents((prev) =>
          prev.map((s) => ({
            ...s,
            worksheets: s.worksheets.map((w) =>
              w.worksheetEntryId === worksheetEntryId
                ? { ...w, isUploading: false, page1Uri: null, page2Uri: null }
                : w,
            ),
          })),
        );

        Alert.alert('Queued', `${student.studentName} queued for AI grading.`);
      } catch (err) {
        setStudents((prev) =>
          prev.map((s) => ({
            ...s,
            worksheets: s.worksheets.map((w) =>
              w.worksheetEntryId === worksheetEntryId ? { ...w, isUploading: false } : w,
            ),
          })),
        );
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to queue');
      }
    },
    [selectedClassId, submittedOn, students, classes],
  );

  // AI Grade All
  const aiGradeAll = useCallback(async () => {
    const eligible = students.flatMap((s) =>
      s.worksheets
        .filter(
          (ws) =>
            !ws.isAbsent &&
            ws.worksheetNumber > 0 &&
            (ws.page1Uri || ws.page2Uri),
        )
        .map((ws) => ws.worksheetEntryId),
    );

    if (eligible.length === 0) {
      Alert.alert('Nothing to grade', 'No worksheets have new page images to upload.');
      return;
    }

    for (const entryId of eligible) {
      await aiGrade(entryId);
    }
  }, [students, aiGrade]);

  // Mark ungraded as absent
  const markUngradedAbsent = useCallback(() => {
    const targets = searchQuery.trim() ? filteredStudents : students;
    const ungradedIds = new Set(
      targets
        .filter(
          (s) =>
            s.worksheets.every(
              (ws) => !ws.existing && !ws.grade && ws.worksheetNumber <= 0,
            ),
        )
        .map((s) => s.studentId),
    );

    if (ungradedIds.size === 0) {
      Alert.alert('No Changes', 'All students already have data.');
      return;
    }

    setStudents((prev) =>
      prev.map((student) => {
        if (!ungradedIds.has(student.studentId)) return student;
        return {
          ...student,
          worksheets: student.worksheets.map((ws) => ({
            ...ws,
            isAbsent: true,
            worksheetNumber: 0,
            grade: '',
            page1Uri: null,
            page2Uri: null,
          })),
        };
      }),
    );

    Alert.alert('Done', `${ungradedIds.size} students marked absent.`);
  }, [students, filteredStudents, searchQuery]);

  // Helper getters
  const getWorksheet = useCallback(
    (worksheetEntryId: string) =>
      students
        .flatMap((s) => s.worksheets)
        .find((ws) => ws.worksheetEntryId === worksheetEntryId),
    [students],
  );

  const findStudentForWorksheet = useCallback(
    (worksheetEntryId: string) =>
      students.find((s) =>
        s.worksheets.some((ws) => ws.worksheetEntryId === worksheetEntryId),
      ),
    [students],
  );

  return {
    classes,
    selectedClassId,
    submittedOn,
    students,
    filteredStudents,
    searchQuery,
    loading,
    loadingRoster,
    error,
    stats,
    setSelectedClassId,
    setSubmittedOn,
    setSearchQuery,
    updateField,
    setPageImage,
    addWorksheet,
    removeWorksheet,
    saveStudent,
    saveAll,
    aiGrade,
    aiGradeAll,
    markUngradedAbsent,
    refreshRoster: loadRoster,
    getWorksheet,
    findStudentForWorksheet,
  };
}
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/hooks/useRoster.ts
git commit -m "feat(mobile): add useRoster hook for roster state management"
```

---

### Task 14: RosterScreen

**Files:**
- Create: `mobile-app/src/screens/RosterScreen.tsx`

The main screen that composes all components:

- [ ] **Step 1: Create RosterScreen.tsx**

```typescript
// mobile-app/src/screens/RosterScreen.tsx
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
  onLogout: () => void;
  onNavigateToQueue: () => void;
}

export function RosterScreen({ user, onLogout, onNavigateToQueue }: RosterScreenProps) {
  const isOnline = useNetworkStatus();
  const roster = useRoster(user);
  const { summary, activeCount } = useGradingJobs();
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
        renderItem={({ item }) => (
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
        )}
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
    fontSize: fontSize.sm,
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
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/screens/RosterScreen.tsx
git commit -m "feat(mobile): add RosterScreen composing all roster components"
```

---

### Task 15: QueueScreen

**Files:**
- Create: `mobile-app/src/screens/QueueScreen.tsx`

Filterable queue screen. Tapping an item triggers navigation to the Roster tab (handled by parent via callback).

- [ ] **Step 1: Create QueueScreen.tsx**

```typescript
// mobile-app/src/screens/QueueScreen.tsx
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
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/screens/QueueScreen.tsx
git commit -m "feat(mobile): add QueueScreen with filtering and navigation"
```

---

### Task 16: Rewrite App.tsx

**Files:**
- Modify: `mobile-app/App.tsx`

Replace the entire App.tsx with a slim auth gate + tab navigation that uses the new screens.

- [ ] **Step 1: Rewrite App.tsx**

```typescript
// mobile-app/App.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiClient } from './src/api/client';
import { isSupportedTeacherRole } from './src/config';
import { clearAuthToken, getAuthToken } from './src/auth/session';
import { initializeQueueDatabase, listQueueItems } from './src/queue/storage';
import { LoginScreen } from './src/screens/LoginScreen';
import { RosterScreen } from './src/screens/RosterScreen';
import { QueueScreen } from './src/screens/QueueScreen';
import { colors, fontSize } from './src/theme';
import { User } from './src/types';

type TabParamList = {
  Roster: undefined;
  Queue: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [queueBadge, setQueueBadge] = useState(0);
  const navigationRef = useRef<NavigationContainerRef<TabParamList>>(null);

  // Restore session
  useEffect(() => {
    (async () => {
      try {
        await initializeQueueDatabase();
        const token = await getAuthToken();
        if (!token) return;

        apiClient.setToken(token);
        const currentUser = await apiClient.getCurrentUser();
        if (!isSupportedTeacherRole(currentUser.role)) {
          await clearAuthToken();
          return;
        }
        setUser(currentUser);
      } catch {
        await clearAuthToken();
        apiClient.setToken(null);
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  // Poll queue badge count
  useEffect(() => {
    if (!user) return;
    const updateBadge = async () => {
      try {
        const items = await listQueueItems();
        const active = items.filter(
          (i) => i.status !== 'completed' && i.status !== 'failed',
        ).length;
        setQueueBadge(active);
      } catch {
        // ignore
      }
    };
    updateBadge();
    const interval = setInterval(updateBadge, 10_000);
    return () => clearInterval(interval);
  }, [user]);

  const handleLogout = useCallback(async () => {
    await clearAuthToken();
    apiClient.setToken(null);
    setUser(null);
  }, []);

  const handleLogin = useCallback((loggedInUser: User) => {
    setUser(loggedInUser);
  }, []);

  const handleNavigateToQueue = useCallback(() => {
    navigationRef.current?.navigate('Queue');
  }, []);

  if (restoring) {
    return (
      <SafeAreaProvider>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (!user) {
    return (
      <SafeAreaProvider>
        <LoginScreen onLogin={handleLogin} />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.gray400,
            tabBarStyle: { borderTopColor: colors.gray100 },
          }}
        >
          <Tab.Screen
            name="Roster"
            options={{
              tabBarLabel: 'Worksheets',
              tabBarIcon: ({ color }) => (
                <Text style={{ fontSize: 20, color }}>📋</Text>
              ),
            }}
          >
            {() => (
              <RosterScreen
                user={user}
                onLogout={handleLogout}
                onNavigateToQueue={handleNavigateToQueue}
              />
            )}
          </Tab.Screen>
          <Tab.Screen
            name="Queue"
            options={{
              tabBarLabel: 'Queue',
              tabBarIcon: ({ color }) => (
                <Text style={{ fontSize: 20, color }}>📤</Text>
              ),
              tabBarBadge: queueBadge > 0 ? queueBadge : undefined,
            }}
          >
            {() => <QueueScreen />}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
  },
});
```

- [ ] **Step 2: Verify**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/App.tsx
git commit -m "feat(mobile): rewrite App.tsx with slim auth gate and tab navigation"
```

---

### Task 17: Build & Manual Test

- [ ] **Step 1: Create Expo dev build**

The app uses native modules (`react-native-document-scanner-plugin`, `@react-native-community/datetimepicker`) so it needs a dev build, not Expo Go:

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app
npx expo prebuild
npx expo run:ios
# or: npx expo run:android
```

- [ ] **Step 2: Test login flow**

1. Launch app → login screen shows
2. Enter valid teacher credentials → login succeeds, roster tab appears
3. Kill and relaunch → session restored, goes straight to roster

- [ ] **Step 3: Test roster screen**

1. Class chips appear, first class selected by default
2. Date picker shows today's date, tapping opens native picker
3. Stats chips show correct counts
4. Student cards render in single column, sorted by token number
5. Search filters by name and token number
6. "Mark Ungraded as Absent" in overflow menu works

- [ ] **Step 4: Test document scanning**

1. Tap "Scan Pages" on a student card → native scanner opens
2. Scan 2 pages → both page slots show thumbnails
3. Tap a thumbnail → full-screen preview
4. Tap per-slot "Scan" button → scanner opens for single page retake
5. Tap per-slot "Gallery" button → photo library picker opens
6. Scan 3+ pages → toast warns "3 pages scanned, using first 2"

- [ ] **Step 5: Test save & AI grade**

1. Fill worksheet #, set grade → tap "Save" → saved alert, "Saved" badge appears
2. Upload page images → tap "AI Grade" → queued alert
3. Switch to Queue tab → item appears
4. Tap "Process" on Queue tab → upload begins
5. Grading status banner updates on roster screen

- [ ] **Step 6: Test carousel**

1. Tap "+" on student card → new worksheet slot added
2. Swipe or use chevrons to navigate between worksheets
3. Trash icon removes additional worksheet
4. "Worksheet 1 of 2" label updates correctly

- [ ] **Step 7: Commit any fixes**

```bash
cd /Users/madhavkaushish/saarthi/worksheet-grading/mobile-app
git add -A
git commit -m "fix(mobile): fixes from manual testing"
```
