# Mobile UI Polish Design

**Date:** 2026-04-12
**Goal:** Transform the Teacher Capture mobile app from functional prototype to production-quality native feel.
**Approach:** Polish-in-place — upgrade existing StyleSheet-based components with proper icons, refined typography, better card density, and platform-specific native touches.
**New dependency:** `expo-blur` (for iOS frosted glass headers)

---

## 1. Icons & Typography

### Icon Replacements

Replace all emoji icons with `@expo/vector-icons` (Ionicons), already bundled with Expo.

| Current | New | Location |
|---------|-----|----------|
| `📋` | `Ionicons: document-text-outline / document-text` | Tab bar — Worksheets |
| `📤` | `Ionicons: cloud-upload-outline / cloud-upload` | Tab bar — Queue |
| `⚙️` | `Ionicons: settings-outline / settings` | Tab bar — Settings |
| `🔍` | `Ionicons: search` | Search bars (RosterScreen, QueueScreen) |
| `📷` | `Ionicons: camera-outline` | Scan Both Pages button |
| `✓` tick | `Ionicons: checkmark-circle` | PageSlot captured indicator |
| `✓` job done | `Ionicons: checkmark-circle` | GradingStatusBanner |
| `📤` upload | `Ionicons: cloud-upload-outline` | GradingStatusBanner |
| `...` menu | `Ionicons: ellipsis-horizontal` | RosterScreen overflow menu |
| `‹›` chevrons | `Ionicons: chevron-back / chevron-forward` | StudentCard carousel |
| `▲▼` | `Ionicons: chevron-down / chevron-up` | DatePicker toggle |
| `+` add | `Ionicons: add-circle-outline` | StudentCard add worksheet |

### Typography Refinements

- Title headers: add `letterSpacing: -0.5` for tighter display feel
- Labels (11px uppercase): increase `letterSpacing` to 0.8
- Add `caption` size: 10px for very small metadata

---

## 2. Card Layout & Information Density

### StudentCard

- Avatar: 40px -> 44px
- Badges (Saved/Repeat): keep inline but ensure proper gap
- Add button: `add-circle-outline` icon tinted primary instead of plain `+`
- Card shadow: iOS `shadowOpacity: 0.10`, `shadowRadius: 12`; Android `elevation: 3`
- Card border radius: 16 -> 20
- Card padding: 16 -> 20

### WorksheetSlot

- Page slots: show 48x48 rounded thumbnail when image captured (instead of just checkmark)
- Scan button: camera icon + "Scan" text, filled primary
- Gallery button: image icon + "Gallery" text, outline style
- "Scan Both Pages": tonal secondary style with camera icon left-aligned
- "AI Grade" button: add `flash-outline` icon before text
- Inputs: keep bordered style but refine border color to lighter gray

### PageSlot

- Captured state: 48x48 rounded thumbnail preview, tappable for full preview
- Scan: `camera-outline` icon + text
- Gallery: `image-outline` icon + text

---

## 3. Screen-Level Polish

### LoginScreen

- Background: subtle tinted wash (`#F5F3FF` at top fading to white)
- App icon area: large rounded square (80x80) in primary color with initials "TC"
- Input focus state: primary border color
- Sign In button: 52px height, shadow, 14px border radius

### RosterScreen

- Sticky header: `BlurView` on iOS for translucent effect, solid white with elevation on Android
- Stats row: show labels permanently — "12/30 Graded · 15 WS · 3 Absent · 40%"
- Search bar: proper platform search field with icon inside
- Bottom action bar: frosted glass on iOS, safe area padding, 48px button height
- Empty state: large muted icon (64px) + descriptive text

### QueueScreen

- Header: consistent with RosterScreen header style
- Queue cards: 4px left accent border colored by status (green=done, amber=queued, red=failed, indigo=processing)
- Page status: small colored dots instead of text
- Retry button: filled amber; Discard: subtle outline

### SettingsScreen

- Section headers: "Account" above profile card
- Profile avatar: 56px, use same `avatarColor()` algorithm as StudentCard
- App version: gray caption text at bottom

### Modals

- Drag handle: 36x4px gray pill at top
- GradingDetails: taller summary cards, bolder numbers
- ImagePreview: keep current, drag handle addition

---

## 4. Platform-Specific Native Feel

### iOS

- `expo-blur` BlurView for sticky headers and bottom bars
- Consistent font weights: '600' semibold, '700' bold headers only
- Pressed states: scale 0.98 transform
- Switches: default iOS green track (don't override unless semantic)

### Android

- Ripple effect: `android_ripple={{ color: 'rgba(0,0,0,0.08)' }}` on all Pressable buttons
- Elevation shadows tuned per Material 3
- Bottom nav: 80dp height to match Material 3 spec
- Status bar: dark style on light screens

### Shared

- Consistent press feedback: scale on iOS, ripple on Android (no more `opacity: 0.7`)
- `LayoutAnimation` for DatePicker expand/collapse
- ActivityIndicator kept (no skeleton shimmer needed)

---

## Files Affected

- `src/theme.ts` — expanded tokens, shadow presets, press feedback helpers
- `App.tsx` — vector icons in tab bar, ripple config
- `src/screens/LoginScreen.tsx` — background, icon area, input/button refinements
- `src/screens/RosterScreen.tsx` — blur header, stats labels, empty state, bottom bar
- `src/screens/QueueScreen.tsx` — accent borders, status dots, button styles
- `src/screens/SettingsScreen.tsx` — section headers, avatar, version text
- `src/components/StudentCard.tsx` — avatar size, icon buttons, card styling
- `src/components/WorksheetSlot.tsx` — icon buttons, AI Grade icon, input refinements
- `src/components/PageSlot.tsx` — thumbnails, icon+text buttons
- `src/components/DatePicker.tsx` — chevron icons, layout animation
- `src/components/StatChips.tsx` — permanent labels, layout rework
- `src/components/GradingDetailsModal.tsx` — drag handle, bolder summary
- `src/components/ImagePreviewModal.tsx` — drag handle
- `src/components/GradingStatusBanner.tsx` — vector icons

## New Dependency

- `expo-blur` — frosted glass effect for iOS headers/bars
