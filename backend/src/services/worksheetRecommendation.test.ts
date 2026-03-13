import { describe, expect, it } from 'vitest';

import { buildWorksheetRecommendationFromHistory } from './worksheetRecommendation';

describe('buildWorksheetRecommendationFromHistory', () => {
  it('uses the highest worksheet number when multiple worksheets exist on the same day', () => {
    const history = [
      {
        grade: 40,
        submittedOn: new Date('2026-03-12T00:00:00.000Z'),
        createdAt: new Date('2026-03-12T08:00:00.000Z'),
        effectiveWorksheetNumber: 857,
      },
      {
        grade: 38,
        submittedOn: new Date('2026-03-12T00:00:00.000Z'),
        createdAt: new Date('2026-03-12T08:10:00.000Z'),
        effectiveWorksheetNumber: 858,
      },
      {
        grade: 36,
        submittedOn: new Date('2026-03-12T00:00:00.000Z'),
        createdAt: new Date('2026-03-12T08:20:00.000Z'),
        effectiveWorksheetNumber: 859,
      },
      {
        grade: 35,
        submittedOn: new Date('2026-03-12T00:00:00.000Z'),
        createdAt: new Date('2026-03-12T08:30:00.000Z'),
        effectiveWorksheetNumber: 860,
      },
    ];

    const recommendation = buildWorksheetRecommendationFromHistory(history, 32);

    expect(recommendation.lastWorksheetNumber).toBe(860);
    expect(recommendation.lastGrade).toBe(35);
    expect(recommendation.recommendedWorksheetNumber).toBe(861);
    expect(recommendation.isRecommendedRepeated).toBe(false);
    expect(recommendation.completedWorksheetNumbers).toEqual([857, 858, 859, 860]);
  });

  it('repeats the highest worksheet number when the highest worksheet is below threshold', () => {
    const history = [
      {
        grade: 40,
        submittedOn: new Date('2026-03-11T00:00:00.000Z'),
        createdAt: new Date('2026-03-11T08:00:00.000Z'),
        effectiveWorksheetNumber: 859,
      },
      {
        grade: 20,
        submittedOn: new Date('2026-03-12T00:00:00.000Z'),
        createdAt: new Date('2026-03-12T08:00:00.000Z'),
        effectiveWorksheetNumber: 860,
      },
    ];

    const recommendation = buildWorksheetRecommendationFromHistory(history, 32);

    expect(recommendation.lastWorksheetNumber).toBe(860);
    expect(recommendation.lastGrade).toBe(20);
    expect(recommendation.recommendedWorksheetNumber).toBe(860);
    expect(recommendation.isRecommendedRepeated).toBe(true);
  });

  it('uses the latest attempt when the same highest worksheet appears on multiple dates', () => {
    const history = [
      {
        grade: 20,
        submittedOn: new Date('2026-03-10T00:00:00.000Z'),
        createdAt: new Date('2026-03-10T08:00:00.000Z'),
        effectiveWorksheetNumber: 861,
      },
      {
        grade: 34,
        submittedOn: new Date('2026-03-12T00:00:00.000Z'),
        createdAt: new Date('2026-03-12T08:00:00.000Z'),
        effectiveWorksheetNumber: 861,
      },
    ];

    const recommendation = buildWorksheetRecommendationFromHistory(history, 32);

    expect(recommendation.lastWorksheetNumber).toBe(861);
    expect(recommendation.lastGrade).toBe(34);
    expect(recommendation.recommendedWorksheetNumber).toBe(862);
    expect(recommendation.isRecommendedRepeated).toBe(false);
  });

  it('ignores an older inflated worksheet number and uses the latest date bucket', () => {
    const history = [
      {
        grade: 38,
        submittedOn: new Date('2026-01-10T00:00:00.000Z'),
        createdAt: new Date('2026-01-10T08:00:00.000Z'),
        effectiveWorksheetNumber: 1889,
      },
      {
        grade: 37,
        submittedOn: new Date('2026-03-12T00:00:00.000Z'),
        createdAt: new Date('2026-03-12T08:00:00.000Z'),
        effectiveWorksheetNumber: 1276,
      },
      {
        grade: 36,
        submittedOn: new Date('2026-03-12T00:00:00.000Z'),
        createdAt: new Date('2026-03-12T08:10:00.000Z'),
        effectiveWorksheetNumber: 1277,
      },
    ];

    const recommendation = buildWorksheetRecommendationFromHistory(history, 32);

    expect(recommendation.lastWorksheetNumber).toBe(1277);
    expect(recommendation.lastGrade).toBe(36);
    expect(recommendation.recommendedWorksheetNumber).toBe(1278);
    expect(recommendation.isRecommendedRepeated).toBe(false);
  });
});
