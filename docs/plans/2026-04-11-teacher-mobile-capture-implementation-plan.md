# Teacher Mobile Capture Implementation Plan

## Scope

Build a small Expo React Native companion app for the teacher worksheet capture workflow described in `docs/plans/2026-04-11-teacher-mobile-capture-design.md`.

The app should support fast manual student search, two-page capture, review with queue/retake actions, durable local queueing, and direct upload to the existing backend/R2 upload session flow. OCR, YOLO, and automatic student matching remain out of scope for v1.

## Current Backend Fit

The existing backend already has the main mobile upload primitives:

- `POST /api/auth/login`
- `GET /api/auth/me`
- teacher classes through the existing class API used by the web app
- `GET /api/worksheets/class-date?classId=...&submittedOn=...`
- `POST /api/worksheet-processing/upload-session`
- `GET /api/worksheet-processing/upload-session/:batchId`
- `POST /api/worksheet-processing/upload-session/:batchId/finalize`
- `GET /api/grading-jobs/class/:classId?date=...`
- `POST /api/grading-jobs/batch-status`

The mobile app should reuse the direct upload session shape instead of adding a separate upload endpoint.

## Phase 0: Confirm Native Package Choices

Before writing app code, make a quick proof spike on a real iOS and Android device:

- Confirm a document scanning package or native module choice works in an EAS dev build.
- Confirm `expo-file-system/legacy` upload with `FileSystemSessionType.BACKGROUND` can PUT a local image file to a signed URL.
- Confirm iOS behavior when the app is backgrounded, screen is locked, and reopened.
- Confirm Android behavior when the app is backgrounded and reopened.

Preferred initial package set:

- Expo app with TypeScript and EAS dev builds.
- `expo-secure-store` for auth token.
- `expo-file-system` plus `expo-file-system/legacy` for local file persistence and background upload.
- `expo-sqlite` for a durable local queue.
- `expo-camera` or the selected document scanner module for capture.
- React Navigation or Expo Router, based on the scaffold chosen.

Do not rely on Expo Go for validation because scanner/background upload behavior needs native capabilities.

## Phase 1: Scaffold Mobile App

Create a root-level `mobile-app/` package.

Tasks:

- Scaffold an Expo TypeScript app.
- Add `eas.json` and app config for dev builds.
- Configure environment handling for `API_BASE_URL`.
- Add root documentation for how to run the mobile app locally.
- Add mobile app lint/typecheck scripts.
- Keep `web-app/` and `backend/` untouched except for shared API needs discovered later.

Acceptance criteria:

- `mobile-app` runs in an EAS dev build.
- App can read `API_BASE_URL`.
- The repo can build existing `web-app` and `backend` without depending on the mobile app.

## Phase 2: Authentication Shell

Implement a minimal login/session layer for teachers.

Tasks:

- Add API client wrapper with bearer token support.
- Add login screen using `POST /api/auth/login`.
- Store token in SecureStore.
- Add startup session restore with `GET /api/auth/me`.
- Gate the capture flow to teacher/admin/superadmin users only.
- Add logout that clears token and local in-memory auth state.

Acceptance criteria:

- Teacher can sign in on a physical device.
- Token persists across app restart.
- Expired/invalid token returns the app to login without losing local queued uploads.

## Phase 3: Class, Date, And Roster Loading

Implement the setup state before capture.

Tasks:

- Load teacher classes using the same backend API as the web dashboard.
- Let teacher select class and submitted date.
- Load `GET /api/worksheets/class-date` for the selected class/date.
- Normalize students into a local searchable roster:
  - `studentId`
  - `studentName`
  - `tokenNumber`
  - existing worksheets for duplicate warnings
  - recommended/default worksheet number when available
- Cache the last selected class/date locally for faster reopen.

Acceptance criteria:

- Teacher can pick class/date once and stay in the capture flow.
- Student search works by partial token number and partial name.
- Existing worksheets for the date can be recognized for duplicate warnings.

## Phase 4: Capture UI

Build the fast random-pile capture screen.

Tasks:

- Create a single capture screen with:
  - class/date header
  - large student search field
  - selected student summary
  - camera/scanner action
  - page 1 and page 2 capture slots
  - review state after page 2
- Implement capture states:
  - no student selected
  - student selected, page 1 needed
  - page 1 captured, page 2 needed
  - both pages captured, review
- Review actions:
  - Queue
  - Retake Page 1
  - Retake Page 2
  - Cancel
- Clear selected student and page draft after Queue.
- Keep the local model as `pages[]` even though the UI only renders page 1 and page 2.

Acceptance criteria:

- A teacher can capture two images for a selected student in under a few taps.
- Retake replaces only the selected page.
- Queue returns immediately to student search.
- Duplicate student/date warning appears before queueing when applicable.

## Phase 5: Durable Local Queue

Persist captured worksheets and page files before upload.

Tasks:

- Copy scanner/camera outputs into an app-owned directory.
- Store queue records in SQLite:
  - worksheet local id
  - class id
  - student id/name/token
  - submitted date
  - worksheet number
  - status
  - backend batch id, item id, job id when known
  - page records with page number, local uri, mime type, size, image id, upload URL expiry, upload status
- Add queue list UI for pending/uploading/failed/uploaded items.
- Add retry and cancel actions.
- Add cleanup for files after backend job is safely queued and no retry is needed.

Acceptance criteria:

- Captured images survive app restart before upload.
- Failed uploads remain retryable.
- Queue state and image files stay consistent if the app is closed mid-flow.

## Phase 6: Direct Upload Worker

Implement the mobile upload pipeline using the existing backend direct-upload API.

Pipeline:

1. Group queued worksheets by class/date into upload session requests.
2. Call `POST /api/worksheet-processing/upload-session`.
3. Persist returned `batchId`, item ids, image ids, signed PUT URLs, and expiry values.
4. Upload each page file to the signed PUT URL using file-based upload.
5. Mark each page uploaded locally when the storage PUT succeeds.
6. Call `POST /api/worksheet-processing/upload-session/:batchId/finalize` with uploaded image ids.
7. Persist returned job ids and move those worksheets to uploaded/queued-for-grading state.
8. Retry failed pages or refresh the session with `GET /api/worksheet-processing/upload-session/:batchId` when signed URLs expire.

Implementation notes:

- Use file-based uploads, not base64 uploads.
- Do not compress or convert on the client in v1.
- Limit concurrent page uploads to a conservative number, for example 2.
- Treat finalization as resumable: if background upload finishes while JS is suspended, finalize when the app next runs.
- Keep upload progress best-effort; correctness matters more than perfectly live progress.

Acceptance criteria:

- Teacher can queue pages and leave the capture screen.
- Upload resumes or retries after app relaunch.
- Backend receives uploaded pages and creates grading jobs through the existing finalization endpoint.

## Phase 7: Grading Status

Show lightweight status after upload.

Tasks:

- Poll `POST /api/grading-jobs/batch-status` for locally known active job ids.
- Poll `GET /api/grading-jobs/class/:classId?date=...` when opening the queue/status screen.
- Show per-student status:
  - queued locally
  - uploading
  - uploaded
  - grading queued
  - processing
  - completed
  - failed
- Add manual refresh.

Acceptance criteria:

- Teacher can see whether a worksheet is still local, uploading, queued for grading, completed, or failed.
- App recovers status after restart using persisted job ids and class/date.

## Phase 8: Backend Hardening, Only If Needed

Avoid backend changes unless the mobile spike finds a gap.

Possible backend additions:

- A mobile-focused roster endpoint if `class-date` returns too much payload.
- Upload session idempotency key keyed by mobile `localId` to prevent duplicates after retry.
- Endpoint to list upload batches by class/date/teacher if local mobile state is lost.
- Push notification registration and grading-complete notifications.

Acceptance criteria:

- Any new endpoint is covered by controller tests.
- Existing web upload page behavior is unchanged.

## Phase 9: QA Matrix

Run tests on physical devices, not only simulators.

Scenarios:

- Capture two pages and queue on iOS.
- Capture two pages and queue on Android.
- App backgrounded during upload.
- Screen locked during upload.
- Network drops before upload session creation.
- Network drops after one page uploads.
- Signed upload URL expires before retry.
- App killed and reopened with local pending items.
- Duplicate student selected for same class/date.
- Teacher retakes page 1 after page 2 exists.
- Backend grading job succeeds.
- Backend grading job fails.

Done criteria:

- No captured worksheet is lost silently.
- Every failed state has a retry or discard path.
- Teachers can continue capturing new worksheets while previous ones upload.
- Existing web upload flow still works.

## Suggested Build Order

1. Scaffold `mobile-app`.
2. Auth and API client.
3. Class/date/roster loading.
4. Manual search and two-page capture UI with mocked queue.
5. SQLite queue and local file persistence.
6. Direct upload session integration.
7. Background upload spike hardening.
8. Status polling.
9. Device QA.
10. Optional backend idempotency/push improvements.
