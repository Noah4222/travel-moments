import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type Asset, type Trip } from "@/lib/api";
import { Badge, Button, Card } from "@/components/ui";
import { PicturePreview } from "@/components/PicturePreview";
import { Lightbox } from "@/components/Lightbox";

/**
 * Admin / editor preview of an album — same browsing experience as a share
 * page but skips password & visit tracking. Useful to review what visitors
 * will see.
 */
export function TripPreviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const tripId = Number(id);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.getTrip(tripId), api.listAssets(tripId)])
      .then(([t, as]) => {
        setTrip(t);
        setAssets(as);
      })
      .catch((err) => setError(String(err)));
  }, [tripId]);

  // Sync ?asset=ID → activeIdx on load.
  useEffect(() => {
    if (!assets) return;
    const aidRaw = search.get("asset");
    if (!aidRaw) return;
    const aid = Number(aidRaw);
    const i = assets.findIndex((a) => a.id === aid);
    if (i >= 0) setActiveIdx(i);
  }, [assets, search]);

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!trip || !assets) {
    return <p className="text-zinc-500">加载中…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Badge>{trip.slug}</Badge>
          <h1 className="mt-2 text-3xl font-semibold">{trip.title}</h1>
          {trip.location && (
            <p className="mt-1 text-sm text-zinc-500">📍 {trip.location}</p>
          )}
        </div>
        <Button variant="outline" onClick={() => navigate(`/admin/trips/${tripId}`)}>
          ← 返回管理
        </Button>
      </div>

      {assets.length === 0 ? (
        <Card className="p-8 text-center text-sm text-zinc-500">
          这个相册还没有内容
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {assets.map((a, i) => (
            <PreviewTile
              key={a.id}
              asset={a}
              onClick={() => {
                setActiveIdx(i);
                setSearch({ asset: String(a.id) });
              }}
            />
          ))}
        </ul>
      )}

      {activeIdx !== null && (
        <Lightbox
          mode="admin"
          assets={assets}
          index={activeIdx}
          onClose={() => {
            setActiveIdx(null);
            setSearch({});
          }}
          onIndexChange={(i) => {
            setActiveIdx(i);
            const aid = assets[i]?.id;
            if (aid != null) setSearch({ asset: String(aid) });
          }}
        />
      )}
    </div>
  );
}

function PreviewTile({ asset, onClick }: { asset: Asset; onClick: () => void }) {
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
    </li>
  );
}
