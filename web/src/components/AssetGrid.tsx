import { useEffect, useRef, useState } from "react";
import { api, type Asset } from "@/lib/api";
import { Badge, Button, Card, Input } from "./ui";
import { PicturePreview } from "./PicturePreview";
import { cn } from "@/lib/cn";
import { copyText, composeAssetShareCopy } from "@/lib/clipboard";
import { Spinner } from "./Spinner";
import { PhotoEditor } from "./PhotoEditor";

export function AssetGrid({
  assets,
  isAdmin,
  coverAssetID,
  onDelete,
  onBulkDelete,
  onClick,
  onCoverChange,
  onAssetChanged,
  hasMore,
  loadingMore,
  onLoadMore,
  /** Total count across all pages (for the "全选 / 共 N 张" UI). */
  total,
  /** Fetch every asset id in the trip — used to "全选" across unloaded pages. */
  fetchAllIDs,
}: {
  assets: Asset[];
  isAdmin: boolean;
  coverAssetID?: number | null;
  onDelete?: (a: Asset) => void | Promise<void>;
  /** Bulk-delete; defaults to calling onDelete sequentially. */
  onBulkDelete?: (ids: number[]) => Promise<void>;
  onClick?: (a: Asset) => void;
  onCoverChange?: () => void | Promise<void>;
  /** Replace a single asset in-place (e.g. after admin photo edit). */
  onAssetChanged?: (a: Asset) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  total?: number | null;
  fetchAllIDs?: () => Promise<number[]>;
}) {
  const [shareInfo, setShareInfo] = useState<{ url: string } | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<{ done: number; total: number } | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver-driven infinite scroll: when the bottom sentinel is
  // near the viewport and there's another page, trigger onLoadMore.
  useEffect(() => {
    if (!onLoadMore || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            onLoadMore();
            break;
          }
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onLoadMore, hasMore, loadingMore]);

  const totalKnown = total ?? assets.length;
  const allSelected = selected.size >= totalKnown && totalKnown > 0;

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
              <p className="text-xs text-zinc-500">
                {total != null && total !== assets.length
                  ? `${assets.length} / ${total} 个资源`
                  : `${assets.length} 个资源`}
              </p>
              <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}>
                批量选择
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm">
                已选 <b>{selected.size}</b> / {totalKnown}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={selectingAll}
                  onClick={async () => {
                    if (allSelected) {
                      setSelected(new Set());
                      return;
                    }
                    // Cross-page select-all: pull every asset id when paginated.
                    if (fetchAllIDs && total != null && total > assets.length) {
                      setSelectingAll(true);
                      try {
                        const ids = await fetchAllIDs();
                        setSelected(new Set(ids));
                      } finally {
                        setSelectingAll(false);
                      }
                    } else {
                      setSelected(new Set(assets.map((a) => a.id)));
                    }
                  }}
                >
                  {selectingAll ? "…" : allSelected ? "全不选" : "全选"}
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

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8">
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
            onEdit={() => setEditingAsset(a)}
          />
        ))}
      </ul>
      {(hasMore || loadingMore) && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-500"
        >
          {loadingMore ? (
            <>
              <Spinner className="h-4 w-4" /> 加载更多…
            </>
          ) : (
            <span>下滑加载更多</span>
          )}
        </div>
      )}
      {!hasMore && total != null && total > 0 && assets.length >= total && (
        <p className="py-6 text-center text-xs text-zinc-400">
          — 共 {total} 个资源，到底啦 —
        </p>
      )}
      {shareInfo && (
        <SingleShareDialog url={shareInfo.url} onClose={() => setShareInfo(null)} />
      )}
      {editingAsset && (
        <PhotoEditor
          asset={editingAsset}
          onClose={() => setEditingAsset(null)}
          onSaved={(saved) => {
            setEditingAsset(null);
            onAssetChanged?.(saved);
          }}
        />
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
  onEdit,
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
  onEdit?: () => void;
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
        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-black/55 p-0.5 text-white opacity-0 ring-1 ring-white/15 backdrop-blur-md transition group-hover:opacity-100">
          {asset.kind === "photo" && !isCover && (
            <TileActionButton
              label="设为封面"
              busy={coverBusy}
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
            >
              <StarIcon />
            </TileActionButton>
          )}
          <TileActionButton
            label="分享"
            busy={sharing}
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
          >
            <ShareIcon />
          </TileActionButton>
          {asset.kind === "photo" && onEdit && (
            <TileActionButton
              label="编辑"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <PencilIcon />
            </TileActionButton>
          )}
          {onDelete && (
            <TileActionButton
              label="删除"
              busy={deleting}
              tone="danger"
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
            >
              <TrashIcon />
            </TileActionButton>
          )}
        </div>
      )}
    </li>
  );
}

function TileActionButton({
  label,
  busy,
  tone,
  onClick,
  children,
}: {
  label: string;
  busy?: boolean;
  tone?: "danger";
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full transition",
        tone === "danger"
          ? "hover:bg-rose-500/80 active:bg-rose-500"
          : "hover:bg-white/20 active:bg-white/30",
        busy && "cursor-not-allowed opacity-60",
      )}
    >
      {busy ? <Spinner className="h-3.5 w-3.5 text-white" /> : children}
    </button>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.4l6.1-.9L12 3Z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4" />
      <path d="m15.4 6.5-6.8 4" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4l10-10-4-4L4 16v4Z" />
      <path d="m14 6 4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7h12l-1 13H7L6 7Z" />
      <path d="M9 7V4h6v3" />
    </svg>
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
