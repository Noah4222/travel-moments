import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type PublicAsset, type PublicTripSummary } from "@/lib/api";
import { Badge, Button, Card } from "@/components/ui";
import { ForwardDialog } from "@/components/ForwardDialog";
import { CommentBox } from "@/components/CommentBox";
import { PicturePreview } from "@/components/PicturePreview";
import { Lightbox } from "@/components/Lightbox";
import { Spinner } from "@/components/Spinner";

type Scope = {
  scope: string;
  trip_id?: number;
  title?: string;
  subtitle?: string;
  share_note?: string;
  assets?: PublicAsset[];
  trips?: PublicTripSummary[];
};

export function SharedTripPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [scope, setScope] = useState<Scope | null>(null);
  const [tripScope, setTripScope] = useState<Scope | null>(null);
  const [tripLoading, setTripLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);

  useEffect(() => {
    api
      .publicScope()
      .then((d) => setScope(d as Scope))
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
  }, [navigate]);

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
      .then((d) => setTripScope(d as Scope))
      .catch(() => setTripScope(null))
      .finally(() => setTripLoading(false));
  }, [scope, search]);

  const activeScope = scope?.scope === "multi" ? tripScope : scope;
  useEffect(() => {
    if (!activeScope?.assets) return;
    const raw = search.get("asset");
    if (!raw) {
      setActiveIndex(null);
      return;
    }
    const aid = Number(raw);
    const i = activeScope.assets.findIndex((a) => a.id === aid);
    setActiveIndex(i >= 0 ? i : null);
  }, [activeScope, search]);

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

  if (error && !scope) return <div className="p-8 text-rose-600">{error}</div>;
  if (!scope) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-zinc-500">
        <Spinner /> 加载中…
      </div>
    );
  }

  const isMulti = scope.scope === "multi";
  const showingTripView = !isMulti || !!tripScope;
  const viewing = isMulti ? tripScope : scope;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="min-w-0">
            {isMulti && tripScope && (
              <button
                onClick={backToTrips}
                className="mb-1 text-xs text-zinc-500 hover:text-zinc-700"
              >
                ← 返回相册列表
              </button>
            )}
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {showingTripView
                ? viewing?.title || "Travel Moments"
                : "相册集"}
            </h1>
            {viewing?.subtitle && (
              <p className="text-xs text-zinc-500">📍 {viewing.subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setForwardOpen(true)}>
              转发
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => api.publicLogout().then(() => navigate("/"))}
            >
              退出
            </Button>
          </div>
        </div>
        {scope.share_note && !tripScope && (
          <p className="mx-auto max-w-5xl px-4 pb-3 text-sm text-zinc-500">
            📝 {scope.share_note}
          </p>
        )}
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {isMulti && !tripScope ? (
          <TripListView trips={scope.trips ?? []} onOpen={openTrip} />
        ) : tripLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-zinc-500">
            <Spinner /> 加载中…
          </div>
        ) : viewing?.assets && viewing.assets.length > 0 ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {viewing.assets.map((a, i) => (
              <PublicTile key={a.id} asset={a} onClick={() => openAt(i)} />
            ))}
          </ul>
        ) : (
          <Card className="p-8 text-center text-sm text-zinc-500">还没有内容</Card>
        )}

        {showingTripView && viewing?.trip_id != null && (
          <CollapsibleBoard tripID={viewing.trip_id} />
        )}
      </main>

      {activeIndex !== null && viewing?.assets && viewing.assets.length > 0 && (
        <Lightbox
          assets={viewing.assets}
          index={activeIndex}
          onClose={closeLightbox}
          onIndexChange={openAt}
        />
      )}
      {forwardOpen && <ForwardDialog onClose={() => setForwardOpen(false)} />}
    </div>
  );
}

function TripListView({
  trips,
  onOpen,
}: {
  trips: PublicTripSummary[];
  onOpen: (id: number) => void;
}) {
  if (trips.length === 0) {
    return <Card className="p-8 text-center text-sm text-zinc-500">没有相册</Card>;
  }
  return (
    <ul className="space-y-5">
      {trips.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onOpen(t.id)}
            className="block w-full text-left"
          >
            <Card className="overflow-hidden transition hover:shadow-lg">
              <div className="relative aspect-[21/9] bg-zinc-100 dark:bg-zinc-900">
                <PicturePreview
                  urls={t.cover_url}
                  className="h-full w-full object-cover"
                  loading="eager"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
                  <div className="mb-1 flex items-center gap-2 text-xs text-white/80">
                    {t.location && <span>📍 {t.location}</span>}
                    <span>{t.asset_count} 张内容</span>
                  </div>
                  <h2 className="text-2xl font-semibold drop-shadow-md">{t.title}</h2>
                  {t.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-white/85">
                      {t.description}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CollapsibleBoard({ tripID }: { tripID: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-medium text-zinc-700 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        <span>💬 留言板</span>
        <span className="text-xs text-zinc-400">{open ? "收起 ▴" : "展开 ▾"}</span>
      </button>
      {open && (
        <div className="mt-4">
          <CommentBox targetType="trip" targetID={tripID} />
        </div>
      )}
    </Card>
  );
}

function PublicTile({ asset, onClick }: { asset: PublicAsset; onClick: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const live = asset.is_live_photo && asset.urls.motion;

  return (
    <li
      className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900"
      onMouseEnter={() => {
        if (live && videoRef.current) {
          videoRef.current.currentTime = 0;
          void videoRef.current.play();
        }
      }}
      onMouseLeave={() => {
        if (live && videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
        }
      }}
    >
      <button type="button" onClick={onClick} className="block h-full w-full">
        <PicturePreview
          urls={asset.kind === "video" ? asset.urls.video_cover : asset.urls.thumb}
          className="h-full w-full object-cover transition group-hover:scale-105"
        />
        {live && (
          <video
            ref={videoRef}
            src={asset.urls.motion}
            muted
            playsInline
            preload="none"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition group-hover:opacity-100"
          />
        )}
      </button>
      <div className="pointer-events-none absolute left-2 top-2 flex gap-1">
        {asset.kind === "video" && <Badge tone="warning">▶ 视频</Badge>}
        {live && <Badge tone="neutral">⚡ Live</Badge>}
      </div>
      {asset.view_count != null && (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
          👁 {asset.view_count}
        </span>
      )}
    </li>
  );
}
