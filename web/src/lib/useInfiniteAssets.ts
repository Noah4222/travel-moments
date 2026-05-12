import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Asset } from "./api";

export type InfiniteAssets = {
  assets: Asset[];
  total: number | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Optimistic local mutations after upload / delete. */
  setAssets: React.Dispatch<React.SetStateAction<Asset[]>>;
};

/**
 * Cursor-paginated asset feed for a trip. Keeps `assets` accumulated across
 * pages; `loadMore` advances by one page; `reload` resets to the first page.
 */
export function useInfiniteAssets(
  tripId: number,
  pageSize = 100,
): InfiniteAssets {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Race guard: ignore responses from a stale reload.
  const reloadToken = useRef(0);

  const reload = useCallback(async () => {
    const token = ++reloadToken.current;
    setLoading(true);
    setError(null);
    try {
      const page = await api.listAssets(tripId, { limit: pageSize });
      if (reloadToken.current !== token) return;
      setAssets(page.assets);
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor != null);
      setTotal(page.total ?? page.assets.length);
    } catch (err) {
      if (reloadToken.current === token) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (reloadToken.current === token) setLoading(false);
    }
  }, [tripId, pageSize]);

  const loadMore = useCallback(async () => {
    if (cursor == null || loadingMore) return;
    const token = reloadToken.current;
    setLoadingMore(true);
    try {
      const page = await api.listAssets(tripId, {
        cursor,
        limit: pageSize,
      });
      if (reloadToken.current !== token) return;
      setAssets((cur) => {
        // Dedupe in case the same id arrived twice (e.g. concurrent uploads).
        const seen = new Set(cur.map((a) => a.id));
        return [...cur, ...page.assets.filter((a) => !seen.has(a.id))];
      });
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor != null);
    } catch (err) {
      if (reloadToken.current === token) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (reloadToken.current === token) setLoadingMore(false);
    }
  }, [tripId, cursor, loadingMore, pageSize]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    assets,
    total,
    loading,
    loadingMore,
    hasMore,
    error,
    reload,
    loadMore,
    setAssets,
  };
}
