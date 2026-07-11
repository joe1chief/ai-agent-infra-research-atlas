import { useCallback, useEffect, useState } from "react";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable in private or hardened browser contexts.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
export function useFavorites() {
  const [favorites, setFavorites] = useLocalStorage<string[]>("infra-atlas:favorites", []);
  const toggle = useCallback(
    (workId: string) => {
      setFavorites((current) =>
        current.includes(workId) ? current.filter((id) => id !== workId) : [...current, workId],
      );
    },
    [setFavorites],
  );
  return { favorites, toggle };
}
