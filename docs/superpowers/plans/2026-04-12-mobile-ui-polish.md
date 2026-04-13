# Mobile UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Teacher Capture mobile app from functional prototype to production-quality native feel — proper icons, refined typography, improved card density, platform-specific touches.

**Architecture:** Polish-in-place. No structural changes — upgrade existing StyleSheet-based components. One new dependency (`expo-blur`). All changes are visual/style-only with no logic modifications.

**Tech Stack:** React Native (Expo SDK 54), TypeScript, `@expo/vector-icons` (Ionicons), `expo-blur`

**Design doc:** `docs/plans/2026-04-12-mobile-ui-polish-design.md`

**NOTE:** This is a pure UI polish project. There are no unit-testable behavior changes. Each task ends with a typecheck (`npx tsc --noEmit`) and visual verification on device/simulator. TDD does not apply to style changes.

---

## File Structure

**Modified files (14):**
- `mobile-app/src/theme.ts` — expanded tokens, shadow presets
- `mobile-app/App.tsx` — vector icons in tab bar, platform tab config
- `mobile-app/src/screens/LoginScreen.tsx` — background wash, app icon, input/button polish
- `mobile-app/src/screens/RosterScreen.tsx` — blur header, stats labels, empty state, bottom bar
- `mobile-app/src/screens/QueueScreen.tsx` — accent borders, status dots, button styles
- `mobile-app/src/screens/SettingsScreen.tsx` — section headers, avatar color, version text
- `mobile-app/src/components/StudentCard.tsx` — avatar size, icon buttons, card shadow/radius
- `mobile-app/src/components/WorksheetSlot.tsx` — icon buttons, AI Grade icon
- `mobile-app/src/components/PageSlot.tsx` — thumbnail preview, icon+text buttons
- `mobile-app/src/components/DatePicker.tsx` — chevron icons, layout animation
- `mobile-app/src/components/StatChips.tsx` — permanent labels layout
- `mobile-app/src/components/GradingDetailsModal.tsx` — drag handle, bolder summary
- `mobile-app/src/components/ImagePreviewModal.tsx` — drag handle
- `mobile-app/src/components/GradingStatusBanner.tsx` — vector icons

**New dependency:**
- `expo-blur` (adds to `package.json`)

---

### Task 1: Foundation — Install expo-blur and expand theme.ts

**Files:**
- Modify: `mobile-app/package.json` (via npm)
- Modify: `mobile-app/src/theme.ts`

- [ ] **Step 1: Install expo-blur**

Run from `mobile-app/`:
```bash
npx expo install expo-blur
```
Expected: `expo-blur` added to `package.json` dependencies.

- [ ] **Step 2: Expand theme.ts with new tokens**

Replace the entire contents of `mobile-app/src/theme.ts` with:

```typescript
import { Platform } from 'react-native';

export const colors = {
  // Primary — warm indigo
  primary: '#6366F1',
  primaryLight: '#EEF2FF',
  primaryDark: '#4F46E5',

  // Accent — soft coral
  accent: '#F97066',
  accentLight: '#FEF2F2',

  // Semantic
  amber: '#E8A317',
  amberLight: '#FEF9C3',
  green: '#22C55E',
  greenLight: '#DCFCE7',
  blue: '#818CF8',
  blueLight: '#E0E7FF',
  red: '#EF4444',
  redLight: '#FEF2F2',
  orange: '#F59E0B',
  orangeLight: '#FEF3C7',

  // Neutrals — warm grays
  white: '#FFFFFF',
  gray50: '#FAFAF9',
  gray100: '#F5F5F4',
  gray200: '#E7E5E4',
  gray300: '#D6D3D1',
  gray400: '#A8A29E',
  gray500: '#78716C',
  gray600: '#57534E',
  gray700: '#44403C',
  gray800: '#292524',
  gray900: '#1C1917',
  black: '#000000',

  // Special
  loginBg: '#F5F3FF',
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
  caption: 10,
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
  xxl: 20,
  full: 9999,
} as const;

/** Platform-aware card shadow */
export const cardShadow = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
  },
  android: {
    elevation: 3,
  },
}) as object;

/** Lighter shadow for smaller elements */
export const softShadow = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  android: {
    elevation: 1,
  },
}) as object;

/** Ripple config for Android Pressable buttons */
export const androidRipple = { color: 'rgba(0,0,0,0.08)' };
```

- [ ] **Step 3: Verify typecheck**

Run from `mobile-app/`:
```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add mobile-app/package.json mobile-app/package-lock.json mobile-app/src/theme.ts
git commit -m "feat(mobile): install expo-blur, expand theme tokens with shadows and caption size"
```

---

### Task 2: App.tsx — Tab bar icons and platform config

**Files:**
- Modify: `mobile-app/App.tsx`

- [ ] **Step 1: Replace tab bar emoji with Ionicons**

In `mobile-app/App.tsx`, add import at the top:

```typescript
import { Ionicons } from '@expo/vector-icons';
```

Replace the three `tabBarIcon` emoji renderers in the `Tab.Screen` options. Each currently looks like:
```tsx
tabBarIcon: ({ color }) => (
  <Text style={{ fontSize: 20, color }}>📋</Text>
),
```

Replace with:

For the Roster tab:
```tsx
tabBarIcon: ({ color, size }) => (
  <Ionicons name="document-text-outline" size={size} color={color} />
),
```

For the Queue tab:
```tsx
tabBarIcon: ({ color, size }) => (
  <Ionicons name="cloud-upload-outline" size={size} color={color} />
),
```

For the Settings tab:
```tsx
tabBarIcon: ({ color, size }) => (
  <Ionicons name="settings-outline" size={size} color={color} />
),
```

- [ ] **Step 2: Add platform-specific tab bar styling**

In the `screenOptions` object of `Tab.Navigator`, update `tabBarStyle` and add Android ripple:

```tsx
screenOptions={{
  headerShown: false,
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.gray400,
  tabBarStyle: {
    borderTopColor: colors.gray200,
    borderTopWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      android: { height: 64, paddingBottom: 8, paddingTop: 4 },
      ios: {},
    }),
  },
  tabBarLabelStyle: {
    fontSize: 11,
    fontWeight: '500',
  },
}}
```

Also add `Platform` to the import from `react-native` (it's not currently imported in App.tsx):
```typescript
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
```

Remove `Text` from the import if it's no longer used in App.tsx after removing the emoji icons (check — it may still be used elsewhere in the file). Actually `Text` is no longer used in the `MainTabs` function's JSX after this change, but it's imported at the top level. Leave it for now, the linter can clean it up.

- [ ] **Step 3: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add mobile-app/App.tsx
git commit -m "feat(mobile): replace tab bar emoji with Ionicons, platform tab styling"
```

---

### Task 3: DatePicker — Chevron icons and layout animation

**Files:**
- Modify: `mobile-app/src/components/DatePicker.tsx`

- [ ] **Step 1: Replace chevron emoji with Ionicons, add LayoutAnimation**

In `mobile-app/src/components/DatePicker.tsx`:

Add imports:
```typescript
import { Ionicons } from '@expo/vector-icons';
```

Add `LayoutAnimation, UIManager` to the `react-native` import:
```typescript
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
```

Add Android LayoutAnimation enablement at the top of the file (after imports):
```typescript
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
```

In the `DatePicker` component, update the toggle handler to animate:
```typescript
const toggleShow = () => {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  setShow(!show);
};
```

Update the Pressable's `onPress` from `() => setShow(!show)` to `toggleShow`.

Replace the chevron Text:
```tsx
{/* Old: <Text style={styles.chevron}>{show ? '▲' : '▼'}</Text> */}
<Ionicons
  name={show ? 'chevron-up' : 'chevron-down'}
  size={14}
  color={colors.gray400}
/>
```

Remove the `chevron` style from the StyleSheet (no longer needed).

- [ ] **Step 2: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/components/DatePicker.tsx
git commit -m "feat(mobile): DatePicker chevron icons and expand/collapse animation"
```

---

### Task 4: StatChips — Permanent labels

**Files:**
- Modify: `mobile-app/src/components/StatChips.tsx`

- [ ] **Step 1: Replace tooltip-on-tap with always-visible labels**

Replace the entire `mobile-app/src/components/StatChips.tsx` with:

```typescript
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from '../theme';

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
    <View style={styles.container}>
      <View style={styles.stat}>
        <Text style={[styles.value, { color: colors.primary }]}>
          {studentsGraded}/{totalStudents}
        </Text>
        <Text style={styles.label}>Graded</Text>
      </View>
      <View style={styles.separator} />
      <View style={styles.stat}>
        <Text style={[styles.value, { color: colors.green }]}>
          {worksheetsGraded}
        </Text>
        <Text style={styles.label}>Worksheets</Text>
      </View>
      <View style={styles.separator} />
      <View style={styles.stat}>
        <Text style={[styles.value, { color: colors.orange }]}>
          {absentCount}
        </Text>
        <Text style={styles.label}>Absent</Text>
      </View>
      <View style={styles.separator} />
      <View style={styles.stat}>
        <Text style={[styles.value, { color: colors.primary }]}>
          {completion}%
        </Text>
        <Text style={styles.label}>Complete</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  stat: {
    alignItems: 'center',
  },
  value: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  label: {
    fontSize: fontSize.caption,
    color: colors.gray400,
    fontWeight: '500',
    marginTop: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  separator: {
    width: 1,
    height: 24,
    backgroundColor: colors.gray200,
  },
});
```

- [ ] **Step 2: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/components/StatChips.tsx
git commit -m "feat(mobile): StatChips with permanent labels instead of tooltip-on-tap"
```

---

### Task 5: PageSlot — Thumbnail preview and icon buttons

**Files:**
- Modify: `mobile-app/src/components/PageSlot.tsx`

- [ ] **Step 1: Add thumbnail and icon+text buttons**

Replace the entire `mobile-app/src/components/PageSlot.tsx` with:

```typescript
import React from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fontSize, spacing, borderRadius, androidRipple } from '../theme';

interface PageSlotProps {
  pageNumber: number;
  imageUri?: string | null;
  imageUrl?: string | null;
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
  const hasImage = !!(imageUri || imageUrl);
  const displayUri = imageUri || imageUrl;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>P{pageNumber}</Text>
        {hasImage && displayUri && (
          <Pressable onPress={onPreview} hitSlop={8}>
            <Image source={{ uri: displayUri }} style={styles.thumbnail} />
          </Pressable>
        )}
        {hasImage && !displayUri && (
          <View style={styles.tick}>
            <Ionicons name="checkmark-circle" size={20} color={colors.green} />
          </View>
        )}
      </View>
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.scanBtn,
            disabled && styles.disabled,
            Platform.OS === 'ios' && pressed && styles.pressed,
          ]}
          onPress={onScan}
          disabled={disabled}
          android_ripple={androidRipple}
        >
          <Ionicons name="camera-outline" size={14} color={colors.white} />
          <Text style={styles.scanBtnText}>Scan</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.galleryBtn,
            disabled && styles.disabled,
            Platform.OS === 'ios' && pressed && styles.pressed,
          ]}
          onPress={onPickGallery}
          disabled={disabled}
          android_ripple={androidRipple}
        >
          <Ionicons name="image-outline" size={14} color={colors.gray700} />
          <Text style={styles.galleryBtnText}>Gallery</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    color: colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.gray100,
  },
  tick: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  scanBtn: {
    backgroundColor: colors.primaryDark,
  },
  scanBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.white,
  },
  galleryBtn: {
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  galleryBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.gray700,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
});
```

- [ ] **Step 2: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/components/PageSlot.tsx
git commit -m "feat(mobile): PageSlot with thumbnail preview and icon+text buttons"
```

---

### Task 6: GradingStatusBanner — Vector icons

**Files:**
- Modify: `mobile-app/src/components/GradingStatusBanner.tsx`

- [ ] **Step 1: Replace emoji with Ionicons**

In `mobile-app/src/components/GradingStatusBanner.tsx`:

Add import:
```typescript
import { Ionicons } from '@expo/vector-icons';
```

Replace the icon rendering block (the three-way ternary for `isActive`, `hasJobs`, default):

```tsx
{/* Old: emoji-based icons */}
{/* New: */}
{isActive ? (
  <ActivityIndicator size="small" color={colors.primary} />
) : hasJobs ? (
  <Ionicons name="checkmark-circle" size={20} color={colors.green} />
) : (
  <Ionicons name="cloud-upload-outline" size={20} color={colors.gray400} />
)}
```

Replace the arrow at the end:
```tsx
{/* Old: <Text style={styles.arrow}>›</Text> */}
<Ionicons name="chevron-forward" size={18} color={colors.gray300} />
```

Remove `icon` and `arrow` styles from the StyleSheet (no longer needed).

Import `softShadow` from theme and use it in the `banner` style instead of inline Platform.select shadow:
```typescript
import { colors, fontSize, spacing, borderRadius, softShadow } from '../theme';
```

Replace the banner shadow:
```typescript
banner: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: colors.white,
  borderRadius: borderRadius.lg,
  marginHorizontal: spacing.lg,
  marginVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.md,
  gap: spacing.md,
  ...softShadow,
},
```

- [ ] **Step 2: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/components/GradingStatusBanner.tsx
git commit -m "feat(mobile): GradingStatusBanner with vector icons and theme shadows"
```

---

### Task 7: StudentCard — Avatar, icons, card styling

**Files:**
- Modify: `mobile-app/src/components/StudentCard.tsx`

- [ ] **Step 1: Add Ionicons import and update card styles**

In `mobile-app/src/components/StudentCard.tsx`:

Add import:
```typescript
import { Ionicons } from '@expo/vector-icons';
```

Update the theme import to include new tokens:
```typescript
import { colors, fontSize, spacing, borderRadius, cardShadow, androidRipple } from '../theme';
```

- [ ] **Step 2: Replace text-based icons with Ionicons in JSX**

Replace the add button (`+`):
```tsx
{/* Old: <Text style={styles.addButtonText}>+</Text> */}
<Ionicons name="add-circle-outline" size={24} color={colors.primary} />
```

Replace carousel chevrons. The left chevron:
```tsx
{/* Old: <Text style={[styles.chevron, activeIndex === 0 && styles.chevronDisabled]}>‹</Text> */}
<Ionicons
  name="chevron-back"
  size={22}
  color={activeIndex === 0 ? colors.gray300 : colors.primary}
/>
```

The right chevron:
```tsx
{/* Old: <Text style={[styles.chevron, activeIndex === worksheets.length - 1 && styles.chevronDisabled]}>›</Text> */}
<Ionicons
  name="chevron-forward"
  size={22}
  color={activeIndex === worksheets.length - 1 ? colors.gray300 : colors.primary}
/>
```

- [ ] **Step 3: Update card and avatar styles**

In the StyleSheet, update these styles:

```typescript
card: {
  backgroundColor: colors.white,
  borderRadius: borderRadius.xxl,
  marginHorizontal: CARD_HORIZONTAL_MARGIN,
  marginBottom: spacing.md,
  padding: CARD_PADDING,
  ...cardShadow,
},
```

Update `CARD_PADDING` constant at the top of the file:
```typescript
const CARD_PADDING = spacing.xl;
```

Update avatar size:
```typescript
avatar: {
  width: 44,
  height: 44,
  borderRadius: 22,
  justifyContent: 'center',
  alignItems: 'center',
},
```

Update `addButton`:
```typescript
addButton: {
  width: 36,
  height: 36,
  borderRadius: 18,
  backgroundColor: colors.primaryLight,
  justifyContent: 'center',
  alignItems: 'center',
},
```

Remove `addButtonText` style (no longer used).
Remove `chevron` and `chevronDisabled` styles (no longer used).

- [ ] **Step 4: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add mobile-app/src/components/StudentCard.tsx
git commit -m "feat(mobile): StudentCard with vector icons, larger avatar, refined card shadow"
```

---

### Task 8: WorksheetSlot — Icon buttons and AI Grade icon

**Files:**
- Modify: `mobile-app/src/components/WorksheetSlot.tsx`

- [ ] **Step 1: Add Ionicons and update imports**

In `mobile-app/src/components/WorksheetSlot.tsx`:

Add import:
```typescript
import { Ionicons } from '@expo/vector-icons';
```

Update theme import:
```typescript
import { colors, fontSize, spacing, borderRadius, androidRipple } from '../theme';
```

- [ ] **Step 2: Update Scan Both Pages button**

Replace the `scanBothButton` Pressable content:
```tsx
<Pressable
  style={({ pressed }) => [
    styles.scanBothButton,
    isDisabled && styles.disabled,
    Platform.OS === 'ios' && pressed && styles.pressed,
  ]}
  onPress={onScanBothPages}
  disabled={isDisabled}
  android_ripple={androidRipple}
>
  <Ionicons name="camera-outline" size={18} color={colors.primary} style={{ marginRight: spacing.sm }} />
  <Text style={styles.scanBothText}>Scan Both Pages</Text>
</Pressable>
```

Update `scanBothButton` style to use flexDirection row:
```typescript
scanBothButton: {
  backgroundColor: colors.primaryLight,
  borderRadius: borderRadius.lg,
  paddingVertical: 14,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderColor: colors.blueLight,
  overflow: 'hidden',
},
```

- [ ] **Step 3: Update AI Grade button with icon**

Replace the AI Grade button content:
```tsx
<Pressable
  style={({ pressed }) => [
    styles.actionButton,
    styles.aiGradeButton,
    (!canGrade || data.isAbsent) && styles.disabled,
    Platform.OS === 'ios' && pressed && styles.pressed,
  ]}
  onPress={onAiGrade}
  disabled={!canGrade || data.isAbsent}
  android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
>
  {data.isUploading ? (
    <ActivityIndicator size="small" color={colors.white} />
  ) : (
    <View style={styles.aiGradeContent}>
      <Ionicons name="flash-outline" size={16} color={colors.white} />
      <Text style={styles.aiGradeText}>AI Grade</Text>
    </View>
  )}
</Pressable>
```

Add `aiGradeContent` style and update `aiGradeButton` + `actionButton`:
```typescript
aiGradeContent: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.xs,
},
actionButton: {
  flex: 1,
  borderRadius: borderRadius.lg,
  paddingVertical: 14,
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
},
```

- [ ] **Step 4: Update Save button with platform press feedback**

Replace the Save Pressable:
```tsx
<Pressable
  style={({ pressed }) => [
    styles.actionButton,
    styles.saveButton,
    !canSave && styles.disabled,
    Platform.OS === 'ios' && pressed && styles.pressed,
  ]}
  onPress={onSave}
  disabled={!canSave}
  android_ripple={androidRipple}
>
  <Text style={styles.saveText}>Save</Text>
</Pressable>
```

- [ ] **Step 5: Update field label letter spacing**

```typescript
fieldLabel: {
  fontSize: fontSize.xs,
  fontWeight: '500',
  color: colors.gray500,
  marginBottom: spacing.xs,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
},
```

- [ ] **Step 6: Add pressed style to StyleSheet**

```typescript
pressed: {
  transform: [{ scale: 0.98 }],
},
```

- [ ] **Step 7: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add mobile-app/src/components/WorksheetSlot.tsx
git commit -m "feat(mobile): WorksheetSlot with icon buttons, AI Grade flash icon, platform press"
```

---

### Task 9: GradingDetailsModal — Drag handle and bolder summary

**Files:**
- Modify: `mobile-app/src/components/GradingDetailsModal.tsx`

- [ ] **Step 1: Add drag handle and refine summary cards**

In `mobile-app/src/components/GradingDetailsModal.tsx`:

Add a drag handle View right after `<SafeAreaView style={styles.container}>`:
```tsx
<SafeAreaView style={styles.container}>
  <View style={styles.dragHandleBar}>
    <View style={styles.dragHandle} />
  </View>
  {/* rest of header... */}
```

Add these styles:
```typescript
dragHandleBar: {
  alignItems: 'center',
  paddingTop: spacing.sm,
  paddingBottom: spacing.xs,
},
dragHandle: {
  width: 36,
  height: 4,
  borderRadius: 2,
  backgroundColor: colors.gray300,
},
```

Update `summaryCard` to be taller with bolder numbers:
```typescript
summaryCard: {
  flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.lg,
  borderRadius: borderRadius.lg,
},
summaryValue: {
  fontSize: fontSize.xxl,
  fontWeight: '800',
},
```

Update `sectionTitle` letter spacing:
```typescript
sectionTitle: {
  fontSize: fontSize.md,
  fontWeight: '700',
  color: colors.gray800,
  marginBottom: spacing.sm,
  letterSpacing: -0.3,
},
```

- [ ] **Step 2: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/components/GradingDetailsModal.tsx
git commit -m "feat(mobile): GradingDetailsModal with drag handle and bolder summary"
```

---

### Task 10: ImagePreviewModal — Drag handle

**Files:**
- Modify: `mobile-app/src/components/ImagePreviewModal.tsx`

- [ ] **Step 1: Add drag handle**

In `mobile-app/src/components/ImagePreviewModal.tsx`:

Add a drag handle right after `<SafeAreaView style={styles.container}>`:
```tsx
<SafeAreaView style={styles.container}>
  <View style={styles.dragHandleBar}>
    <View style={styles.dragHandle} />
  </View>
  {/* rest of header... */}
```

Add these styles:
```typescript
dragHandleBar: {
  alignItems: 'center',
  paddingTop: spacing.sm,
  paddingBottom: spacing.xs,
},
dragHandle: {
  width: 36,
  height: 4,
  borderRadius: 2,
  backgroundColor: colors.gray600,
},
```

- [ ] **Step 2: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/components/ImagePreviewModal.tsx
git commit -m "feat(mobile): ImagePreviewModal with drag handle"
```

---

### Task 11: LoginScreen — Background, app icon, input/button polish

**Files:**
- Modify: `mobile-app/src/screens/LoginScreen.tsx`

- [ ] **Step 1: Add app icon and refine styles**

In `mobile-app/src/screens/LoginScreen.tsx`:

Add `Ionicons` import:
```typescript
import { Ionicons } from '@expo/vector-icons';
```

Update theme import:
```typescript
import { colors, fontSize, spacing, borderRadius, cardShadow } from '../theme';
```

Replace the content inside `<KeyboardAvoidingView>` (the title area) with:
```tsx
<View style={styles.iconContainer}>
  <View style={styles.appIcon}>
    <Ionicons name="school" size={36} color={colors.white} />
  </View>
</View>
<Text style={styles.title}>Teacher Capture</Text>
<Text style={styles.subtitle}>Sign in to get started</Text>
```

- [ ] **Step 2: Update styles**

Update/add these styles:

```typescript
container: {
  flex: 1,
  backgroundColor: colors.loginBg,
},
inner: {
  flex: 1,
  justifyContent: 'center',
  paddingHorizontal: spacing.xxl,
},
iconContainer: {
  alignItems: 'center',
  marginBottom: spacing.xl,
},
appIcon: {
  width: 80,
  height: 80,
  borderRadius: borderRadius.xxl,
  backgroundColor: colors.primary,
  justifyContent: 'center',
  alignItems: 'center',
  ...cardShadow,
},
title: {
  fontSize: fontSize.title,
  fontWeight: '800',
  color: colors.gray900,
  textAlign: 'center',
  marginBottom: spacing.xs,
  letterSpacing: -0.5,
},
subtitle: {
  fontSize: fontSize.md,
  color: colors.gray500,
  textAlign: 'center',
  marginBottom: spacing.xxl,
},
input: {
  borderWidth: 1,
  borderColor: colors.gray200,
  borderRadius: borderRadius.lg,
  paddingHorizontal: spacing.lg,
  paddingVertical: 14,
  fontSize: fontSize.md,
  color: colors.gray900,
  marginBottom: spacing.md,
  backgroundColor: colors.white,
},
button: {
  backgroundColor: colors.primary,
  borderRadius: 14,
  paddingVertical: 16,
  alignItems: 'center',
  marginTop: spacing.sm,
  ...cardShadow,
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
```

- [ ] **Step 3: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add mobile-app/src/screens/LoginScreen.tsx
git commit -m "feat(mobile): LoginScreen with app icon, tinted background, polished inputs"
```

---

### Task 12: RosterScreen — Blur header, empty state, bottom bar polish

**Files:**
- Modify: `mobile-app/src/screens/RosterScreen.tsx`

- [ ] **Step 1: Add imports**

In `mobile-app/src/screens/RosterScreen.tsx`:

Add imports:
```typescript
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
```

Update theme import:
```typescript
import { colors, fontSize, spacing, borderRadius, androidRipple } from '../theme';
```

- [ ] **Step 2: Replace search icon emoji**

Replace the search icon:
```tsx
{/* Old: <Text style={styles.searchIcon}>🔍</Text> */}
<Ionicons name="search" size={16} color={colors.gray400} style={{ marginRight: spacing.sm }} />
```

Remove the `searchIcon` style from StyleSheet.

- [ ] **Step 3: Replace menu dots with Ionicons**

Replace the menu button content:
```tsx
{/* Old: <Text style={styles.menuDots}>...</Text> */}
<Ionicons name="ellipsis-horizontal" size={18} color={colors.gray600} />
```

Remove the `menuDots` style from StyleSheet.

- [ ] **Step 4: Update empty state with icon**

Replace the `ListEmptyComponent`:
```tsx
ListEmptyComponent={
  <View style={styles.emptyState}>
    <Ionicons
      name={roster.searchQuery ? 'search-outline' : 'document-text-outline'}
      size={64}
      color={colors.gray300}
    />
    <Text style={styles.emptyText}>
      {roster.searchQuery ? 'No students match your search.' : 'Select a class to see students.'}
    </Text>
  </View>
}
```

Update `emptyState` style:
```typescript
emptyState: {
  alignItems: 'center',
  paddingVertical: spacing.xxl * 3,
  gap: spacing.md,
},
```

- [ ] **Step 5: Wrap sticky header with BlurView on iOS**

Replace the sticky header wrapper. Change:
```tsx
<View style={styles.stickyHeader}>
```
to:
```tsx
{Platform.OS === 'ios' ? (
  <BlurView intensity={80} tint="systemChromeMaterial" style={styles.stickyHeader}>
```

And the closing tag:
```tsx
{/* Old: </View> */}
{Platform.OS === 'ios' ? (
  </BlurView>
) : (
  // Keep the View version for Android
)}
```

Actually, a cleaner approach — wrap the content conditionally:

```tsx
{/* Sticky header */}
<View style={[styles.stickyHeader, Platform.OS === 'android' && styles.stickyHeaderAndroid]}>
  {Platform.OS === 'ios' && (
    <BlurView
      intensity={80}
      tint="systemChromeMaterial"
      style={StyleSheet.absoluteFill}
    />
  )}
  {/* Date + menu */}
  <View style={styles.headerRow}>
    {/* ... existing content unchanged ... */}
  </View>
  {/* ... rest of sticky header content unchanged ... */}
</View>
```

Add styles:
```typescript
stickyHeader: {
  backgroundColor: Platform.select({ ios: 'transparent', android: colors.white }),
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: colors.gray200,
  paddingBottom: spacing.sm,
  overflow: 'hidden',
},
stickyHeaderAndroid: {
  backgroundColor: colors.white,
  elevation: 2,
},
```

- [ ] **Step 6: Polish bottom action bar**

Update the bottom bar for iOS blur effect:

```tsx
{roster.selectedClassId && (
  <View style={styles.bottomBar}>
    {Platform.OS === 'ios' && (
      <BlurView
        intensity={80}
        tint="systemChromeMaterial"
        style={StyleSheet.absoluteFill}
      />
    )}
    <Pressable
      style={({ pressed }) => [
        styles.bottomBtn,
        styles.gradeAllBtn,
        (!isOnline || eligibleUploadCount === 0) && styles.disabled,
        Platform.OS === 'ios' && pressed && styles.pressed,
      ]}
      onPress={() => roster.aiGradeAll()}
      disabled={!isOnline || eligibleUploadCount === 0}
      android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
    >
      <Ionicons name="flash-outline" size={16} color={colors.white} style={{ marginRight: spacing.xs }} />
      <Text style={styles.bottomBtnText}>
        AI Grade{eligibleUploadCount > 0 ? ` (${eligibleUploadCount})` : ''}
      </Text>
    </Pressable>
    <Pressable
      style={({ pressed }) => [
        styles.bottomBtn,
        styles.saveAllBtn,
        !isOnline && styles.disabled,
        Platform.OS === 'ios' && pressed && styles.pressed,
      ]}
      onPress={() => roster.saveAll()}
      disabled={!isOnline}
      android_ripple={androidRipple}
    >
      <Text style={[styles.bottomBtnText, styles.saveAllBtnText]}>Save All</Text>
    </Pressable>
  </View>
)}
```

Update bottom bar styles:
```typescript
bottomBar: {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  flexDirection: 'row',
  gap: spacing.md,
  backgroundColor: Platform.select({ ios: 'transparent', android: colors.white }),
  borderTopWidth: StyleSheet.hairlineWidth,
  borderTopColor: colors.gray200,
  paddingHorizontal: spacing.xl,
  paddingTop: spacing.sm,
  paddingBottom: Platform.select({ ios: spacing.xxl + 4, android: spacing.md }),
  overflow: 'hidden',
},
bottomBtn: {
  flex: 1,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  paddingVertical: 14,
  borderRadius: borderRadius.xxl,
},
```

Add pressed style:
```typescript
pressed: {
  transform: [{ scale: 0.98 }],
},
```

- [ ] **Step 7: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add mobile-app/src/screens/RosterScreen.tsx
git commit -m "feat(mobile): RosterScreen with blur header, vector icons, polished bottom bar"
```

---

### Task 13: QueueScreen — Accent borders, status dots, button styles

**Files:**
- Modify: `mobile-app/src/screens/QueueScreen.tsx`

- [ ] **Step 1: Add imports**

In `mobile-app/src/screens/QueueScreen.tsx`:

Add import:
```typescript
import { Ionicons } from '@expo/vector-icons';
```

Update theme import:
```typescript
import { colors, fontSize, spacing, borderRadius, cardShadow, androidRipple } from '../theme';
```

- [ ] **Step 2: Add accent color mapping for left border**

Add this mapping after `STATUS_DISPLAY`:
```typescript
const STATUS_ACCENT: Record<string, string> = {
  queued: colors.amber,
  uploading: colors.primary,
  uploaded: colors.primary,
  grading_queued: colors.primary,
  processing: colors.primary,
  completed: colors.green,
  failed: colors.red,
};
```

- [ ] **Step 3: Update queue card with accent border and status dots**

In the `renderItem`, update the card:
```tsx
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
      {/* ... cardHeader stays the same ... */}

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
```

- [ ] **Step 4: Replace search icon emoji**

Replace the filter search icon:
```tsx
{/* Old: <Text style={styles.filterIcon}>🔍</Text> */}
<Ionicons name="search" size={16} color={colors.gray400} style={{ marginRight: spacing.sm }} />
```

Remove the `filterIcon` style.

- [ ] **Step 5: Add/update styles**

Add these new styles and update existing ones:

```typescript
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
pressed: {
  transform: [{ scale: 0.98 }],
},
```

Update `retryButton` to include icon layout:
```typescript
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
```

Remove `pageStatus`, `pageUploaded`, `pageFailed` styles (replaced by dots).

Update the card style to use theme shadow:
```typescript
card: {
  backgroundColor: colors.white,
  marginHorizontal: spacing.lg,
  marginBottom: spacing.sm,
  borderRadius: borderRadius.xl,
  padding: spacing.lg,
  overflow: 'hidden',
  ...cardShadow,
},
```

- [ ] **Step 6: Update title letterSpacing**

```typescript
title: {
  fontSize: fontSize.xxl,
  fontWeight: '700',
  color: colors.gray900,
  letterSpacing: -0.5,
},
```

- [ ] **Step 7: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add mobile-app/src/screens/QueueScreen.tsx
git commit -m "feat(mobile): QueueScreen with accent borders, status dots, polished buttons"
```

---

### Task 14: SettingsScreen — Section headers, avatar color, version text

**Files:**
- Modify: `mobile-app/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Add avatarColor utility and version display**

In `mobile-app/src/screens/SettingsScreen.tsx`:

Update imports:
```typescript
import { colors, fontSize, spacing, borderRadius, cardShadow } from '../theme';
```

Add the `avatarColor` function (same as StudentCard — copy it):
```typescript
function avatarColor(name: string): string {
  const hues = ['#0D9488', '#3B82F6', '#D54B43', '#D97706', '#059669', '#EA580C'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hues[Math.abs(hash) % hues.length];
}
```

- [ ] **Step 2: Update the JSX**

Replace the component return body:
```tsx
return (
  <SafeAreaView style={styles.container} edges={['top']}>
    <Text style={styles.title}>Settings</Text>

    <Text style={styles.sectionHeader}>Account</Text>
    <View style={styles.section}>
      <View style={styles.card}>
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: avatarColor(user.name || user.username) }]}>
            <Text style={styles.avatarText}>
              {(user.name || user.username).charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user.name || user.username}</Text>
            <Text style={styles.profileRole}>{user.role}</Text>
          </View>
        </View>
      </View>
    </View>

    <View style={styles.section}>
      <View style={styles.card}>
        <Pressable
          style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
          onPress={handleSignOut}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      </View>
    </View>

    <Text style={styles.versionText}>Teacher Capture v1.0.0</Text>
  </SafeAreaView>
);
```

- [ ] **Step 3: Update styles**

Update/add these styles:

```typescript
title: {
  fontSize: fontSize.title,
  fontWeight: '700',
  color: colors.gray900,
  paddingHorizontal: spacing.xl,
  paddingTop: spacing.lg,
  paddingBottom: spacing.sm,
  letterSpacing: -0.5,
},
sectionHeader: {
  fontSize: fontSize.xs,
  fontWeight: '600',
  color: colors.gray400,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  paddingHorizontal: spacing.xl,
  paddingTop: spacing.lg,
  paddingBottom: spacing.sm,
},
card: {
  backgroundColor: colors.white,
  marginHorizontal: spacing.lg,
  borderRadius: borderRadius.xl,
  overflow: 'hidden',
  ...cardShadow,
},
avatar: {
  width: 56,
  height: 56,
  borderRadius: 28,
  justifyContent: 'center',
  alignItems: 'center',
},
avatarText: {
  fontSize: fontSize.xl,
  fontWeight: '700',
  color: colors.white,
},
versionText: {
  fontSize: fontSize.caption,
  color: colors.gray400,
  textAlign: 'center',
  marginTop: spacing.xxl * 2,
},
```

Remove the old inline `avatar: { backgroundColor: colors.primary }` style.

- [ ] **Step 4: Verify typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add mobile-app/src/screens/SettingsScreen.tsx
git commit -m "feat(mobile): SettingsScreen with section headers, colored avatar, version text"
```

---

### Task 15: Final verification — Full build and visual check

- [ ] **Step 1: Run full typecheck**

```bash
cd mobile-app && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 2: Run lint**

```bash
cd mobile-app && npx expo lint
```
Expected: No blocking errors.

- [ ] **Step 3: Start the dev server and verify visually**

```bash
cd mobile-app && npx expo start
```

Open on iOS Simulator and Android emulator. Check each screen:
- **Login**: indigo background wash, app icon, polished inputs
- **Roster**: blur header on iOS, Ionicons everywhere, stats with labels, bottom bar with blur
- **Queue**: left accent borders, status dots, Ionicons
- **Settings**: section header, colored avatar, version text
- **Modals**: drag handles present
- **Tab bar**: Ionicons instead of emoji

- [ ] **Step 4: Final commit if any typecheck/lint fixes needed**

```bash
git add -A
git commit -m "fix(mobile): address lint/typecheck issues from UI polish"
```
