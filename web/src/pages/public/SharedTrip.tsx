import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { ForwardDialog } from "@/components/ForwardDialog";
import { Lightbox } from "@/components/Lightbox";
import { Spinner } from "@/components/Spinner";
import { useTheme } from "@/themes/ThemeProvider";
import { ThemedShareView } from "@/themes/share";
import { isThemeId } from "@/themes/tokens";
import type { ShareScope } from "@/themes/share/types";

export function SharedTripPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { refresh: refreshTheme, setLocalTheme } = useTheme();
  const [scope, setScope] = useState<ShareScope | null>(null);
  const [tripScope, setTripScope] = useState<ShareScope | null>(null);
  const [tripLoading, setTripLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api
      .publicScope()
      .then((d) => {
        const s = d as ShareScope;
        setScope(s);
        // Share scope carries the current public theme; sync the provider
        // so we paint with the right tokens without a second round-trip.
        if (isThemeId(s.theme)) setLocalTheme(s.theme);
        else refreshTheme();
      })
      .catch((err) => {
        if (
          err &&
          typeof err === "object" &&
          "status" in err &&
          (err as { status: number }).status === 401
        ) {
          navigate("/", { replace: true });
        }
        setError(String(err));
      });
  }, [navigate, refreshTheme, setLocalTheme]);

  useEffect(() => {
    if (!scope || scope.scope !== "multi") return;
    const raw = search.get("trip");
    if (!raw) {
      setTripScope(null);
      return;
    }
    const id = Number(raw);
    setTripLoading(true);
    api
      .publicTripScope(id)
      .then((d) => setTripScope(d as ShareScope))
      .catch(() => setTripScope(null))
      .finally(() => setTripLoading(false));
  }, [scope, search]);

  const activeScope = scope?.scope === "multi" ? tripScope : scope;

  const loadMore = useCallback(async () => {
    if (!activeScope || loadingMore) return;
    const cursor = activeScope.next_cursor;
    if (cursor == null) return;
    setLoadingMore(true);
    try {
      const page = await api.publicNextAssets({
        cursor,
        limit: 100,
        tripID: scope?.scope === "multi" ? activeScope.trip_id : undefined,
      });
      const append = (s: ShareScope | null): ShareScope | null => {
        if (!s) return s;
        const seen = new Set((s.assets ?? []).map((a) => a.id));
        const merged = [
          ...(s.assets ?? []),
          ...page.assets.filter((a) => !seen.has(a.id)),
        ];
        return { ...s, assets: merged, next_cursor: page.next_cursor };
      };
      if (scope?.scope === "multi") setTripScope(append);
      else setScope(append);
    } finally {
      setLoadingMore(false);
    }
  }, [activeScope, loadingMore, scope?.scope]);

  useEffect(() => {
    if (!activeScope || activeScope.next_cursor == null) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [activeScope, loadMore]);

  useEffect(() => {
    if (!activeScope?.assets) return;
    const raw = search.get("asset");
    if (!raw) {
      setActiveIndex(null);
      return;
    }
    const aid = Number(raw);
    const i = activeScope.assets.findIndex((a) => a.id === aid);
    if (i >= 0) setActiveIndex(i);
    else if (activeScope.next_cursor != null && !loadingMore) loadMore();
  }, [activeScope, search, loadingMore, loadMore]);

  function openAt(i: number) {
    const aid = activeScope?.assets?.[i]?.id;
    if (aid == null) return;
    const next = new URLSearchParams(search);
    next.set("asset", String(aid));
    setSearch(next);
  }
  function closeLightbox() {
    const next = new URLSearchParams(search);
    next.delete("asset");
    setSearch(next);
  }
  function openTrip(id: number) {
    setSearch({ trip: String(id) });
  }
  function backToTrips() {
    setSearch({});
  }
  function logout() {
    void api.publicLogout().then(() => navigate("/"));
  }

  if (error && !scope) return <div className="p-8 text-rose-600">{error}</div>;
  if (!scope) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-zinc-500">
        <Spinner /> 加载中…
      </div>
    );
  }

  const isMulti = scope.scope === "multi";
  const viewing = isMulti ? tripScope : scope;

  return (
    <>
      <ThemedShareView
        scope={scope}
        viewing={viewing}
        isMulti={isMulti}
        tripLoading={tripLoading}
        loadingMore={loadingMore}
        sentinelRef={sentinelRef}
        onOpenAsset={openAt}
        onOpenTrip={openTrip}
        onBackToTrips={backToTrips}
        onForward={() => setForwardOpen(true)}
        onLogout={logout}
      />

      {activeIndex !== null && viewing?.assets && viewing.assets.length > 0 && (
        <Lightbox
          assets={viewing.assets}
          index={activeIndex}
          hasMore={viewing.next_cursor != null}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          onClose={closeLightbox}
          onIndexChange={openAt}
        />
      )}
      {forwardOpen && (
        <ForwardDialog
          tripTitle={viewing?.title}
          onClose={() => setForwardOpen(false)}
        />
      )}
    </>
  );
}
