# Mobile App Roster Rewrite Design

**Date:** 2026-04-12
**Goal:** Replace the mobile app's capture-first workflow with a roster-of-cards layout matching the web app's teacher upload page, plus platform-native document scanning.

## Decisions

| Decision | Choice |
|----------|--------|
| Layout | Single-column stack of student cards (web app grid adapted for mobile) |
| Capture flow replaced? | Yes — roster-first, not capture-first |
| Document scanning | Platform-native (iOS VNDocumentCameraViewController, Android ML Kit) via `react-native-document-scanner-plugin` |
| Image input methods | Document scanner + photo library picker per page slot |
| Multi-page scan | "Scan Pages" button captures both pages in one session; per-slot buttons for retakes. Auto-assign first 2 pages, toast if extras discarded. |
| Queue tab | Kept — filterable dashboard, tap item navigates to its card on Roster tab |
| Save vs AI Grade | Two separate actions, matching web app. Save = direct API call. AI Grade = local queue → upload → grading job. |
| Mark Ungraded as Absent | Top toolbar overflow menu (not bottom bar) |
| Grading status | Compact tappable banner at top of roster + badge on Queue tab |
| Stats | Horizontal row of compact chips (Graded X/Y, Worksheets N, Absent M, %) |
| Wrong questions | Visible directly on card |
| Grading details | Full-screen modal on tap |
| Image preview | Small thumbnails inline, tap for full-screen |
| Incorrect grade checkbox | Yes, on each card |
| Multiple worksheets per student | Carousel with swipe + chevron arrows |
| Date picker | Proper native date picker (not text input) |
| Analytics | Deferred to later iteration |
| Codebase approach | Clean rewrite of UI layer; reuse existing api/, queue/, auth/ modules |

## File Structure

```
mobile-app/
  App.tsx                        — auth gate, navigation setup
  src/
    screens/
      LoginScreen.tsx            — login (minimal changes from current)
      RosterScreen.tsx           — main roster view (replaces CaptureScreen)
      QueueScreen.tsx            — filterable queue dashboard
    components/
      StudentCard.tsx            — per-student card with carousel
      WorksheetSlot.tsx          — single worksheet within carousel
      PageSlot.tsx               — page 1/2 image slot with scan/pick
      GradingDetailsModal.tsx    — full-screen grading details
      ImagePreviewModal.tsx      — full-screen image viewer
      StatChips.tsx              — horizontal stats row
      GradingStatusBanner.tsx    — compact job status banner, tappable
      DatePicker.tsx             — native date picker wrapper
    hooks/
      useRoster.ts               — class/date selection, student data fetching
      useGradingJobs.ts          — job polling and status tracking
      useDocumentScanner.ts      — scanner + gallery picker logic
    api/    (existing, no changes)
    queue/  (existing, minor extensions)
    auth/   (existing, no changes)
    types.ts (existing, extended)
    config.ts (existing, no changes)
    utils/  (existing, no changes)
```

## Screen Layouts

### Roster Screen (top to bottom)

1. **Header bar** — title, logout button, overflow menu containing "Mark Ungraded as Absent"
2. **Grading status banner** — compact single line: "3 grading · 2 queued · 5 done" with spinner when active. Tapping navigates to Queue tab.
3. **Class selector** — horizontal scrolling chips
4. **Date picker** — native platform date picker (calendar/wheel)
5. **Stat chips** — single horizontal row: Graded X/Y | Worksheets N | Absent M | Completion %
6. **Search bar** — filter by student name or token number
7. **Student cards** — single-column scrollable list
8. **Sticky bottom bar** — "AI Grade All (N)" + "Save All" buttons

### Student Card

**Header row:**
- Avatar (color-coded initials)
- Student name
- Token number
- Status badges: Saved (blue), Repeat (orange)
- "+" button to add worksheet

**Worksheet carousel** (swipeable, chevron arrows, "Worksheet X of Y", trash icon):
- Worksheet # input (number)
- Grade dropdown (0–40)
- Wrong question numbers (visible on card, not behind modal)
- Info button with badge → opens GradingDetailsModal (full-screen)
- Page slots (2 side-by-side):
  - Small thumbnail preview (tap → full-screen ImagePreviewModal)
  - Document scanner button (per-slot, for retakes)
  - Gallery picker button (per-slot)
- "Scan Pages" button — opens scanner for multi-page capture, fills both slots
- Checkboxes: Absent, Incorrect Grade
- Action buttons: "AI Grade", "Save"

### Queue Screen

- Filterable list of queued/uploading/grading/failed items
- Per item: student name, token, worksheet #, date, status, error message
- Tap → navigate to Roster tab, scroll to student's card
- Actions: retry failed uploads, cancel/discard items
- Auto-refreshes grading statuses on screen focus
- Badge count on tab icon for active items

### Grading Details Modal (full-screen)

- Summary: correct / wrong / unanswered / score %
- Overall feedback text
- Wrong answers: question number, student answer, correct answer, feedback
- Unanswered questions: question number, expected answer
- Correct answers (collapsed/scrollable)

## Data Flow

### Save (per-card or bulk)

Direct API call, no local queue:
1. Validate: absent students save with worksheetNumber=0, grade=0. Non-absent require worksheetNumber > 0.
2. Call `POST /worksheets/grade` (create) or `PUT /worksheets/grade/{id}` (update)
3. Toast on success/failure
4. Bulk "Save All" runs all valid saves in parallel

### AI Grade (per-card or bulk)

Local queue for resilience:
1. Validate: worksheet # required, at least 1 page image required
2. Insert into SQLite queue (status: queued)
3. Upload worker picks up:
   - Create upload session (`POST /worksheet-processing/upload-session`)
   - Upload pages to presigned S3 URLs
   - Finalize (`POST /worksheet-processing/upload-session/{batchId}/finalize`)
4. Poll grading job status (`POST /grading-jobs/batch-status`)
5. On completion: update card inline with grade, wrong questions, grading details
6. Clean up local files after successful completion

### Offline Behavior

- Save and AI Grade buttons disabled when offline
- Queue items persist in SQLite
- Uploads resume automatically when connectivity returns
- Offline banner shown (matching web app pattern)

## New Dependency

- `react-native-document-scanner-plugin` — wraps iOS VNDocumentCameraViewController and Android ML Kit document scanner. Requires Expo dev build (not Expo Go).

## Not in Scope

- Analytics (PostHog) — deferred to follow-up iteration
- Push notifications for grading completion
- Client-side image compression (backend handles conversion)
- OCR / YOLO integration
