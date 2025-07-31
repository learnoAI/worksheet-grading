import { useState, useCallback } from 'react';

export interface LoadingStateHook {
  isLoading: boolean;
  error: string | null;
}

export function useLoadingState(initialLoading = false) {
  const [state, setState] = useState<LoadingStateHook>({
    isLoading: initialLoading,
    error: null,
  });

  const setLoading = useCallback((loading: boolean) => {
    setState(prev => ({ ...prev, isLoading: loading, error: null }));
  }, []);

  const setError = useCallback((error: string) => {
    setState({ isLoading: false, error });
  }, []);

  const reset = useCallback(() => {
    setState({ isLoading: false, error: null });
  }, []);

  return {
    ...state,
    setLoading,
    setError,
    reset,
  };
}

export function useAsyncOperation<T extends any[], R>(
  operation: (...args: T) => Promise<R>
) {
  const { isLoading, error, setLoading, setError, reset } = useLoadingState();

  const execute = useCallback(
    async (...args: T): Promise<R | null> => {
      try {
        setLoading(true);
        const result = await operation(...args);
        reset();
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        return null;
      }
    },
    [operation, setLoading, setError, reset]
  );

  return {
    execute,
    isLoading,
    error,
    reset,
  };
}
