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

function toTimestamp(value?: Date | null): number {
  return value instanceof Date ? value.getTime() : Number.NEGATIVE_INFINITY;
}

function toDayKey(entry: WorksheetHistoryEntry): string {
  const primaryDate = entry.submittedOn ?? entry.createdAt;
  if (!(primaryDate instanceof Date)) {
    return '';
  }

  return primaryDate.toISOString().slice(0, 10);
}

export function buildWorksheetRecommendationFromHistory(
  history: WorksheetHistoryEntry[],
  progressionThreshold: number,
  currentClassCompletedNumbers?: number[]
): WorksheetRecommendation {
  const validHistory = history.filter(
    (entry): entry is WorksheetHistoryEntry & { effectiveWorksheetNumber: number } =>
      entry.effectiveWorksheetNumber !== null
  );

  const completedWorksheetNumbers = [...new Set(
    validHistory
      .map((entry) => entry.effectiveWorksheetNumber)
      .filter((worksheetNumber): worksheetNumber is number => worksheetNumber > 0)
  )].sort((a, b) => a - b);

  // For isRecommendedRepeated, check against current class only (if provided)
  // so that worksheets completed in old classes don't incorrectly flag as repeated
  const repeatedCheckNumbers = currentClassCompletedNumbers ?? completedWorksheetNumbers;

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
      const submittedOnDelta = toTimestamp(b.submittedOn) - toTimestamp(a.submittedOn);
      if (submittedOnDelta !== 0) {
        return submittedOnDelta;
      }

      return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
    })
    .map((entry) => toDayKey(entry))
    .find((dayKey) => dayKey !== '');

  const latestDayHistory = latestDayKey
    ? validHistory.filter((entry) => toDayKey(entry) === latestDayKey)
    : validHistory;

  const baseWorksheet = [...latestDayHistory].sort((a, b) => {
    if (b.effectiveWorksheetNumber !== a.effectiveWorksheetNumber) {
      return b.effectiveWorksheetNumber - a.effectiveWorksheetNumber;
    }

    const submittedOnDelta = toTimestamp(b.submittedOn) - toTimestamp(a.submittedOn);
    if (submittedOnDelta !== 0) {
      return submittedOnDelta;
    }

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
    const recommendedWorksheetNumber = lastWorksheetNumber + 1;
    return {
      lastWorksheetNumber,
      lastGrade,
      completedWorksheetNumbers,
      recommendedWorksheetNumber,
      isRecommendedRepeated: repeatedCheckNumbers.includes(recommendedWorksheetNumber),
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
