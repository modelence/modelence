import { useState, useEffect } from 'react';

type LoaderResult<T> = {
  isLoading: boolean;
  error: Error | null;
  data: T | null;
};

export function useLoader<T>(loaderName: string, ...args: any[]): LoaderResult<T> {
  const [result, setResult] = useState<LoaderResult<T>>({
    isLoading: true,
    error: null,
    data: null,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`/api/internal/loader/${loaderName}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error. status: ${response.status}`);
        }

        const data = await response.json();
        setResult({ isLoading: false, error: null, data });
      } catch (error) {
        setResult({ isLoading: false, error: error as Error, data: null });
      }
    };

    fetchData();
  }, [loaderName, ...args]);

  return result;
}
