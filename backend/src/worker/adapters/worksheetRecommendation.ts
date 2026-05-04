/**
 * Worksheet progression recommendation — ported from
 * `backend/src/services/worksheetRecommendation.ts` and a small private
 * helper `getEffectiveWorksheetNumber` from `controllers/worksheetController.ts`.
 *
 * These are pure functions (no Prisma, no I/O) so the worker can reuse the
 * exact Express behavior when computing "what worksheet should this
 * student attempt next" from their history. The routes that depend on it
 * are `GET /api/worksheets/class-date` and `POST /api/worksheets/recommend-next`
 * (both pending in Phase 5.13.B).
 */

export interface WorksheetHistoryEntry {
  grade: number | null;
  submittedOn?: Date | null;
  createdAt?: Date | null;
  effectiveWorksheetNumber: number | null;
}

export interface WorksheetRecommendation {
  lastWorksheetNumber: number | null;
  lastGrade: number | null;
  completedWorksheetNumbers: number[];
  recommendedWorksheetNumber: number;
  isRecommendedRepeated: boolean;
}

/**
 * Returns the positive worksheet number that should be treated as
 * canonical for a given row — preferring the explicit `worksheetNumber`
 * column, falling back to the template's `worksheetNumber`. Anything
 * non-positive means "no meaningful worksheet number" (e.g. absent
 * students whose `worksheetNumber` is 0).
 */
export function getEffectiveWorksheetNumber(
  worksheetNumber: number | null | undefined,
  templateWorksheetNumber: number | null | undefined
): number | null {
  if (typeof worksheetNumber === 'number' && worksheetNumber > 0) {
    return worksheetNumber;
  }
  if (typeof templateWorksheetNumber === 'number' && templateWorksheetNumber > 0) {
    return templateWorksheetNumber;
  }
  return null;
}

function toTimestamp(value?: Date | null): number {
  return value instanceof Date ? value.getTime() : Number.NEGATIVE_INFINITY;
}

function toDayKey(entry: WorksheetHistoryEntry): string {
  const primaryDate = entry.submittedOn ?? entry.createdAt;
  if (!(primaryDate instanceof Date)) return '';
  return primaryDate.toISOString().slice(0, 10);
}

/**
 * Compute a worksheet recommendation from the student's graded history.
 *
 * Algorithm (1:1 with Express):
 *  1. Filter to entries with a positive `effectiveWorksheetNumber`.
 *  2. Build the set of completed worksheet numbers (for "already
 *     attempted" detection on the recommendation).
 *  3. If there is no valid history, recommend worksheet 1.
 *  4. Find the latest day's worksheets — ties broken by `createdAt`.
 *  5. Within that day, pick the highest-numbered worksheet; ties broken
 *     by `submittedOn` then `createdAt`.
 *  6. If the last grade is `null`, recommend the same worksheet again
 *     marked as repeat (an absent/missing row).
 *  7. If the last grade ≥ progressionThreshold, recommend the next
 *     number; flag repeat if the student already did that number.
 *  8. Otherwise, recommend the same worksheet again as a repeat.
 */
export function buildWorksheetRecommendationFromHistory(
  history: WorksheetHistoryEntry[],
  progressionThreshold: number
): WorksheetRecommendation {
  const validHistory = history.filter(
    (entry): entry is WorksheetHistoryEntry & { effectiveWorksheetNumber: number } =>
      entry.effectiveWorksheetNumber !== null
  );

  const completedWorksheetNumbers = [
    ...new Set(
      validHistory
        .map((entry) => entry.effectiveWorksheetNumber)
        .filter((n): n is number => n > 0)
    ),
  ].sort((a, b) => a - b);

  if (validHistory.length === 0) {
    return {
      lastWorksheetNumber: null,
      lastGrade: null,
      completedWorksheetNumbers,
      recommendedWorksheetNumber: 1,
      isRecommendedRepeated: false,
    };
  }

  const latestDayKey = [...validHistory]
    .sort((a, b) => {
      const sub = toTimestamp(b.submittedOn) - toTimestamp(a.submittedOn);
      if (sub !== 0) return sub;
      return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
    })
    .map(toDayKey)
    .find((key) => key !== '');

  const latestDayHistory = latestDayKey
    ? validHistory.filter((entry) => toDayKey(entry) === latestDayKey)
    : validHistory;

  const baseWorksheet = [...latestDayHistory].sort((a, b) => {
    if (b.effectiveWorksheetNumber !== a.effectiveWorksheetNumber) {
      return b.effectiveWorksheetNumber - a.effectiveWorksheetNumber;
    }
    const sub = toTimestamp(b.submittedOn) - toTimestamp(a.submittedOn);
    if (sub !== 0) return sub;
    return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
  })[0];

  const lastWorksheetNumber = baseWorksheet.effectiveWorksheetNumber;
  const lastGrade = baseWorksheet.grade;

  if (lastGrade === null) {
    return {
      lastWorksheetNumber,
      lastGrade: null,
      completedWorksheetNumbers,
      recommendedWorksheetNumber: lastWorksheetNumber,
      isRecommendedRepeated: true,
    };
  }

  if (lastGrade >= progressionThreshold) {
    const next = lastWorksheetNumber + 1;
    return {
      lastWorksheetNumber,
      lastGrade,
      completedWorksheetNumbers,
      recommendedWorksheetNumber: next,
      isRecommendedRepeated: completedWorksheetNumbers.includes(next),
    };
  }

  return {
    lastWorksheetNumber,
    lastGrade,
    completedWorksheetNumbers,
    recommendedWorksheetNumber: lastWorksheetNumber,
    isRecommendedRepeated: true,
  };
}
