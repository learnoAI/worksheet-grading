import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { apiClient } from '../api/client';
import { GradingJobSummary } from '../types';

export function useGradingJobs(intervalMs = 5_000) {
  const [summary, setSummary] = useState<GradingJobSummary | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const response = await apiClient.getTeacherJobsToday();
      if (response.summary) {
        setSummary(response.summary);
      }
    } catch {
      // Silently ignore polling errors
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    timerRef.current = setInterval(fetchJobs, intervalMs);

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        fetchJobs();
      }
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      subscription.remove();
    };
  }, [fetchJobs, intervalMs]);

  const activeCount = summary ? summary.queued + summary.processing : 0;

  return { summary, activeCount, refresh: fetchJobs };
}
