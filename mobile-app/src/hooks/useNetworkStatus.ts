import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { API_BASE_URL } from '../config';

export function useNetworkStatus(checkIntervalMs = 30_000) {
  const [isOnline, setIsOnline] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      setIsOnline(true);
    } catch {
      setIsOnline(false);
    }
  }, []);

  useEffect(() => {
    check();
    intervalRef.current = setInterval(check, checkIntervalMs);

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        check();
      }
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      subscription.remove();
    };
  }, [check, checkIntervalMs]);

  return isOnline;
}
