# Teacher Capture Mobile App

Expo companion app for teacher worksheet capture.

## Setup

Install dependencies:

```sh
npm install
```

Point the app at the deployed backend API:

```sh
EXPO_PUBLIC_API_BASE_URL=https://king-prawn-app-k2urh.ondigitalocean.app/worksheet-grading-backend/api npm run start
```

For local backend testing on a physical device, use your machine's LAN IP instead of `localhost`.

## Development Builds

Camera, SecureStore, SQLite, and background file uploads should be validated in an EAS development build rather than Expo Go.

```sh
npx eas build --profile development --platform ios
npx eas build --profile development --platform android
```

## Checks

```sh
npm run typecheck
npm run lint
```

## Workflow Covered

- Teacher/admin/superadmin login with persisted SecureStore token.
- Class and submitted date selection.
- Class/date roster load with duplicate worksheet warnings.
- Search by partial student name or token number.
- Two page camera capture with review, retake, cancel, and queue actions.
- Durable SQLite queue with copied app-owned image files.
- Direct upload session integration with file-based PUT uploads.
- Retry, cancel, and grading status refresh from the queue screen.
