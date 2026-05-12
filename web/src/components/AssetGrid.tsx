import { useRef, useState } from "react";
import { api, type Asset } from "@/lib/api";
import { Badge, Button, Card, Input } from "./ui";
import { PicturePreview } from "./PicturePreview";
import { cn } from "@/lib/cn";
import { copyText, composeAssetShareCopy } from "@/lib/clipboard";

export function AssetGrid({
  assets,
  isAdmin,
  coverAssetID,
  onDelete,
  onBulkDelete,
  onClick,
  onCoverChange,
}: {
  assets: Asset[];
  isAdmin: boolean;
  coverAssetID?: number | null;
  onDelete?: (a: Asset) => void | Promise<void>;
  /** Bulk-delete; defaults to calling onDelete sequentially. */
  onBulkDelete?: (ids: number[]) => Promise<void>;
  onClick?: (a: Asset) => void;
  onCoverChange?: () => void | Promise<void>;
}) {
  const [shareInfo, setShareInfo] = useState<{ url: string } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<{ done: number; total: number } | null>(null);

  function toggle(id: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function runBulkDelete() {
    if (selected.size === 0) return;
    if (!window.confirm(`删除选中的 ${selected.size} 个资源？此操作不可撤销`)) return;
    const ids = Array.from(selected);
    setBulkBusy({ done: 0, total: ids.length });
    try {
      if (onBulkDelete) {
        await onBulkDelete(ids);
      } else if (onDelete) {
        // Default: small concurrency pool over per-asset delete.
        const limit = 4;
        let next = 0;
        let done = 0;
        const workers = Array.from({ length: Math.min(limit, ids.length) }, async () => {
          while (true) {
            const i = next++;
            if (i >= ids.length) return;
            const id = ids[i];
            const a = assets.find((x) => x.id === id);
            if (a) {
              try {
                await onDelete(a);
              } catch {
                /* surface aggregate later if needed */
              }
            }
            done++;
            setBulkBusy({ done, total: ids.length });
          }
        });
        await Promise.all(workers);
      }
    } finally {
      setBulkBusy(null);
      exitSelect();
    }
  }

  if (assets.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        还没有内容，先上传一些照片或视频吧
      </p>
    );
  }

  return (
    <>
      {isAdmin && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {!selectMode ? (
            <>
              <p className="text-xs text-zinc-500">{assets.length} 个资源</p>
              <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}>
                批量选择
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm">
                已选 <b>{selected.size}</b> / {assets.length}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelected(
                      selected.size === assets.length
                        ? new Set()
                        : new Set(assets.map((a) => a.id)),
                    )
                  }
                >
                  {selected.size === assets.length ? "全不选" : "全选"}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={selected.size === 0 || !!bulkBusy}
                  onClick={runBulkDelete}
                >
                  {bulkBusy
                    ? `删除中 ${bulkBusy.done}/${bulkBusy.total}…`
                    : `删除${selected.size > 0 ? ` (${selected.size})` : ""}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={exitSelect} disabled={!!bulkBusy}>
                  退出
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {assets.map((a) => (
          <AssetTile
            key={a.id}
            asset={a}
            isAdmin={isAdmin}
            isCover={coverAssetID === a.id}
            selectMode={selectMode}
            selected={selected.has(a.id)}
            onToggleSelect={() => toggle(a.id)}
            onClick={onClick}
            onDelete={onDelete}
            onShared={(url) => setShareInfo({ url })}
            onCoverChange={onCoverChange}
          />
        ))}
      </ul>
      {shareInfo && (
        <SingleShareDialog url={shareInfo.url} onClose={() => setShareInfo(null)} />
      )}
    </>
  );
}

function AssetTile({
  asset,
  isAdmin,
  isCover,
  selectMode,
  selected,
  onToggleSelect,
  onClick,
  onDelete,
  onShared,
  onCoverChange,
}: {
  asset: Asset;
  isAdmin: boolean;
  isCover?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onClick?: (a: Asset) => void;
  onDelete?: (a: Asset) => void | Promise<void>;
  onShared?: (url: string) => void;
  onCoverChange?: () => void | Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const live = asset.is_live_photo && asset.urls.motion;
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);

  function play() {
    if (!live || selectMode) return;
    const v = videoRef.current;
    if (v) {
      v.currentTime = 0;
      void v.play();
    }
  }
  function stop() {
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
  }

  return (
    <li
      className={cn(
        "group relative aspect-square overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900",
        "[content-visibility:auto] [contain-intrinsic-size:200px]",
        selectMode && selected && "ring-2 ring-emerald-500",
      )}
      onMouseEnter={play}
      onMouseLeave={stop}
    >
      <button
        type="button"
        onClick={() => {
          if (selectMode) onToggleSelect?.();
          else onClick?.(asset);
        }}
        className="block h-full w-full"
      >
        <PicturePreview
          urls={asset.kind === "video" ? asset.urls.video_cover : asset.urls.thumb}
          className="h-full w-full object-cover"
        />
        {live && (
          <video
            ref={videoRef}
            src={asset.urls.motion}
            muted
            playsInline
            preload="none"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 group-hover:opacity-100"
          />
        )}
      </button>

      {selectMode && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-2">
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-bold transition",
              selected
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-white/80 bg-black/30 text-transparent",
            )}
          >
            ✓
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute left-2 top-2 flex gap-1">
        {asset.kind === "video" && (
          <Badge tone="warning">
            {asset.hls_status === "ready" ? "▶ 视频" : "⏳ 转码中"}
          </Badge>
        )}
        {live && <Badge tone="neutral">⚡ Live</Badge>}
        {isCover && <Badge tone="success">★ 封面</Badge>}
      </div>
      {isAdmin && !selectMode && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          {asset.kind === "photo" && !isCover && (
            <button
              type="button"
              disabled={coverBusy}
              onClick={async (e) => {
                e.stopPropagation();
                setCoverBusy(true);
                try {
                  await api.updateTrip(asset.trip_id, {
                    cover_asset_id: asset.id,
                  } as Partial<Asset>);
                  await onCoverChange?.();
                } finally {
                  setCoverBusy(false);
                }
              }}
              className="rounded-md bg-black/60 px-2 py-0.5 text-xs text-white hover:bg-black/80 disabled:opacity-60"
            >
              {coverBusy ? "…" : "设为封面"}
            </button>
          )}
          <button
            type="button"
            disabled={sharing}
            onClick={async (e) => {
              e.stopPropagation();
              setSharing(true);
              try {
                const r = await api.createAssetShare(asset.id, {});
                const absURL = `${window.location.origin}${r.url}`;
                await copyText(composeAssetShareCopy(absURL));
                onShared?.(absURL);
              } catch (err) {
                alert("生成单图分享失败：" + (err as Error).message);
              } finally {
                setSharing(false);
              }
            }}
            className="rounded-md bg-black/60 px-2 py-0.5 text-xs text-white hover:bg-black/80 disabled:opacity-60"
          >
            {sharing ? "…" : "分享"}
          </button>
          {onDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={async (e) => {
                e.stopPropagation();
                if (!window.confirm("删除该资源？")) return;
                setDeleting(true);
                try {
                  await Promise.resolve(onDelete(asset));
                } finally {
                  setDeleting(false);
                }
              }}
              className="rounded-md bg-rose-600/80 px-2 py-0.5 text-xs text-white hover:bg-rose-600 disabled:opacity-60"
            >
              {deleting ? "…" : "删除"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function SingleShareDialog({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <Card className="w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 text-sm font-semibold">单图分享链接已生成</h3>
        <p className="mb-3 text-xs text-zinc-500">
          已复制到剪贴板。任何人打开此链接即可看图，无需密码。
        </p>
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <div className="mt-3 flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyText(composeAssetShareCopy(url))}
          >
            复制
          </Button>
          <Button size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </Card>
    </div>
  );
}
