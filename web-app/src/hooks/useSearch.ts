import { useState, useEffect, useMemo } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function useSearch<T>(
  items: T[],
  searchTerm: string,
  searchKeys: (keyof T)[],
  debounceDelay = 300
) {
  const debouncedSearchTerm = useDebounce(searchTerm, debounceDelay);

  const filteredItems = useMemo(() => {
    if (!debouncedSearchTerm.trim()) return items;

    const searchLower = debouncedSearchTerm.toLowerCase();
    return items.filter(item =>
      searchKeys.some(key => {
        const value = item[key];
        return value && 
               typeof value === 'string' && 
               value.toLowerCase().includes(searchLower);
      })
    );
  }, [items, debouncedSearchTerm, searchKeys]);

  return {
    filteredItems,
    searchTerm: debouncedSearchTerm,
  };
}

export function usePagination<T>(
  items: T[],
  itemsPerPage: number = 10
) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(items.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = items.slice(startIndex, endIndex);

  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const nextPage = () => {
    if (hasNextPage) setCurrentPage(prev => prev + 1);
  };

  const prevPage = () => {
    if (hasPrevPage) setCurrentPage(prev => prev - 1);
  };

  const resetPagination = () => {
    setCurrentPage(1);
  };

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  return {
    currentItems,
    currentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
    goToPage,
    nextPage,
    prevPage,
    resetPagination,
    itemsPerPage,
    totalItems: items.length,
  };
}
