# Teacher Mobile Capture Design

## Context

Teachers need a fast mobile workflow for submitting worksheet images from a random pile of papers. The current web upload page can direct-upload and queue grading, but teachers should not need to keep the page open while images are prepared, uploaded, converted, or graded.

The first mobile release should focus on capture speed and reliable queueing. OCR, YOLO, and automatic student matching are explicitly deferred.

## Goals

- Let a teacher choose a class and date once, then capture worksheets quickly.
- Support random paper order by making student lookup search-first.
- Capture two pages in the v1 UI, while keeping the data model ready for any number of pages.
- Let teachers review, retake, or queue after page 2 is captured.
- Upload in the background and leave conversion/grading to the backend.
- Preserve a future path for document scanning, OCR token matching, and detector-assisted page/header detection.

## Non-Goals

- Rebuild the full teacher dashboard in React Native.
- Add OCR, YOLO, or automatic token/name matching in v1.
- Require teachers to wait for client-side conversion or grading.
- Hard-code two-page assumptions in the upload queue or backend contract.

## Recommended Approach

Build a small Expo companion app for the teacher grading capture workflow only. Keep the existing Next.js app for desktop/admin use.

Use Expo with EAS builds rather than relying on Expo Go, because reliable background uploads and document scanning are native-adjacent capabilities. Start with search-based student selection and document scanner or native crop support for page detection. Add OCR and YOLO only after the manual capture flow is working and measured.

## Capture Flow

1. Teacher signs in and opens the worksheet capture flow.
2. Teacher selects class and date.
3. Teacher searches by student name or token number.
4. Teacher selects a student.
5. Camera captures page 1.
6. Camera captures page 2.
7. App shows a review state with:
   - Queue
   - Retake Page 1
   - Retake Page 2
   - Cancel
8. On Queue, the app saves local files, adds an upload job, clears the selected student, and returns to search.

For v1, the frontend requires two pages before queueing. Internally, the queue stores `pages[]`, so later versions can support one page, more than two pages, or optional page counts without reworking the backend integration.

## Data Model

```ts
type CapturedWorksheet = {
  localId: string;
  classId: string;
  studentId: string;
  studentName: string;
  tokenNumber: string;
  submittedOn: string;
  worksheetNumber?: number;
  pages: CapturedPage[];
  status: 'draft' | 'queued' | 'uploading' | 'uploaded' | 'failed';
};

type CapturedPage = {
  pageNumber: number;
  localUri: string;
  mimeType: string;
  width?: number;
  height?: number;
  uploadStatus: 'local' | 'uploading' | 'uploaded' | 'failed';
};
```

## Upload And Processing

The app should persist captured images locally before queueing upload. Upload jobs should use the existing direct-upload/session shape where each worksheet has an array of files with `pageNumber`, `fileName`, `mimeType`, and `fileSize`.

The mobile client should not do expensive conversion or grading. After upload, the backend should finalize the upload session, queue grading, process the worksheet images, and expose status for the app to poll or receive via push notification.

## Error Handling

- If upload fails, keep local files and show a retryable queue item.
- If the app is backgrounded, upload should continue when the OS permits.
- If the app is force-quit, iOS may stop background work; the app should resume/retry queued jobs on next launch.
- If the same student already has a queued worksheet for the selected date, show a duplicate warning before queueing.
- If the teacher cancels during review, keep the current capture draft until they explicitly discard or choose another student.

## Future Extensions

- Add document scanning/cropping for page boundary detection.
- Add OCR over the captured still image to read token number and student name.
- Add detector-assisted token/name region detection only if template crop plus OCR is unreliable.
- Add support for one-page or multi-page worksheets by changing the capture UI requirement, not the queue model.

## Validation

- Test with a random pile workflow using a realistic class size.
- Verify capture-to-queue speed on physical iOS and Android devices.
- Verify background upload behavior with app switch, screen lock, poor network, and app relaunch.
- Verify duplicate warnings and retake paths.
- Verify backend accepts variable `pages[]` even while v1 UI only sends two pages.
