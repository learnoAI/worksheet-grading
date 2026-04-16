import { describe, expect, it } from 'vitest';
import {
  buildWorksheetRecommendationFromHistory,
  getEffectiveWorksheetNumber,
  type WorksheetHistoryEntry,
} from './worksheetRecommendation';

describe('getEffectiveWorksheetNumber', () => {
  it('prefers the worksheetNumber column when positive', () => {
    expect(getEffectiveWorksheetNumber(3, 5)).toBe(3);
  });

  it('falls back to the template worksheetNumber when column is non-positive', () => {
    expect(getEffectiveWorksheetNumber(0, 5)).toBe(5);
    expect(getEffectiveWorksheetNumber(null, 5)).toBe(5);
    expect(getEffectiveWorksheetNumber(undefined, 5)).toBe(5);
  });

  it('returns null when neither is positive', () => {
    expect(getEffectiveWorksheetNumber(0, 0)).toBeNull();
    expect(getEffectiveWorksheetNumber(null, null)).toBeNull();
    expect(getEffectiveWorksheetNumber(-3, 0)).toBeNull();
  });
});

describe('buildWorksheetRecommendationFromHistory', () => {
  it('recommends worksheet 1 when history is empty', () => {
    const rec = buildWorksheetRecommendationFromHistory([], 32);
    expect(rec).toEqual({
      lastWorksheetNumber: null,
      lastGrade: null,
      completedWorksheetNumbers: [],
      recommendedWorksheetNumber: 1,
      isRecommendedRepeated: false,
    });
  });

  it('recommends next worksheet when last grade meets threshold', () => {
    const history: WorksheetHistoryEntry[] = [
      {
        grade: 35,
        submittedOn: new Date('2026-04-10'),
        createdAt: new Date('2026-04-10T09:00:00Z'),
        effectiveWorksheetNumber: 5,
      },
    ];
    const rec = buildWorksheetRecommendationFromHistory(history, 32);
    expect(rec.lastWorksheetNumber).toBe(5);
    expect(rec.lastGrade).toBe(35);
    expect(rec.recommendedWorksheetNumber).toBe(6);
    expect(rec.isRecommendedRepeated).toBe(false);
    expect(rec.completedWorksheetNumbers).toEqual([5]);
  });

  it('recommends repeat when last grade is below threshold', () => {
    const history: WorksheetHistoryEntry[] = [
      {
        grade: 20,
        submittedOn: new Date('2026-04-10'),
        effectiveWorksheetNumber: 5,
      },
    ];
    const rec = buildWorksheetRecommendationFromHistory(history, 32);
    expect(rec.recommendedWorksheetNumber).toBe(5);
    expect(rec.isRecommendedRepeated).toBe(true);
  });

  it('recommends repeat when last grade is null', () => {
    const history: WorksheetHistoryEntry[] = [
      {
        grade: null,
        submittedOn: new Date('2026-04-10'),
        effectiveWorksheetNumber: 5,
      },
    ];
    const rec = buildWorksheetRecommendationFromHistory(history, 32);
    expect(rec.recommendedWorksheetNumber).toBe(5);
    expect(rec.isRecommendedRepeated).toBe(true);
    expect(rec.lastGrade).toBeNull();
  });

  it('uses latest-day worksheet as the base, picking highest number on that day', () => {
    // Two days: older day has worksheet 8, latest day has worksheets 4 and 6.
    // Recommendation base should be 6 (highest on the latest day).
    const history: WorksheetHistoryEntry[] = [
      {
        grade: 35,
        submittedOn: new Date('2026-04-01'),
        createdAt: new Date('2026-04-01T09:00:00Z'),
        effectiveWorksheetNumber: 8,
      },
      {
        grade: 35,
        submittedOn: new Date('2026-04-10'),
        createdAt: new Date('2026-04-10T09:00:00Z'),
        effectiveWorksheetNumber: 4,
      },
      {
        grade: 35,
        submittedOn: new Date('2026-04-10'),
        createdAt: new Date('2026-04-10T10:00:00Z'),
        effectiveWorksheetNumber: 6,
      },
    ];
    const rec = buildWorksheetRecommendationFromHistory(history, 32);
    expect(rec.lastWorksheetNumber).toBe(6);
    expect(rec.recommendedWorksheetNumber).toBe(7);
    expect(rec.completedWorksheetNumbers).toEqual([4, 6, 8]);
  });

  it('flags isRecommendedRepeated when the next number was already attempted', () => {
    const history: WorksheetHistoryEntry[] = [
      {
        grade: 35,
        submittedOn: new Date('2026-04-01'),
        effectiveWorksheetNumber: 6,
      },
      {
        grade: 35,
        submittedOn: new Date('2026-04-10'),
        effectiveWorksheetNumber: 5,
      },
    ];
    const rec = buildWorksheetRecommendationFromHistory(history, 32);
    // Last day = Apr 10 with worksheet 5, passing grade, so next = 6.
    // But 6 is already in completedWorksheetNumbers → mark as repeat.
    expect(rec.recommendedWorksheetNumber).toBe(6);
    expect(rec.isRecommendedRepeated).toBe(true);
  });

  it('ignores entries with null effectiveWorksheetNumber', () => {
    const history: WorksheetHistoryEntry[] = [
      {
        grade: 35,
        submittedOn: new Date('2026-04-10'),
        effectiveWorksheetNumber: null,
      },
      {
        grade: 35,
        submittedOn: new Date('2026-04-05'),
        effectiveWorksheetNumber: 3,
      },
    ];
    const rec = buildWorksheetRecommendationFromHistory(history, 32);
    expect(rec.lastWorksheetNumber).toBe(3);
    expect(rec.completedWorksheetNumbers).toEqual([3]);
  });

  it('falls back to createdAt when submittedOn is missing for day key', () => {
    const history: WorksheetHistoryEntry[] = [
      {
        grade: 35,
        createdAt: new Date('2026-04-10T09:00:00Z'),
        submittedOn: null,
        effectiveWorksheetNumber: 4,
      },
    ];
    const rec = buildWorksheetRecommendationFromHistory(history, 32);
    expect(rec.lastWorksheetNumber).toBe(4);
    expect(rec.recommendedWorksheetNumber).toBe(5);
  });
});
