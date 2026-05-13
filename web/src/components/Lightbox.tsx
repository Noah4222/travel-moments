import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AssetURLs } from "@/lib/api";
import { DanmakuOverlay } from "./DanmakuOverlay";
import { HlsPlayer } from "./HlsPlayer";
import { CommentBox } from "./CommentBox";
import { Spinner } from "./Spinner";
import { supportsAVIF } from "@/lib/imageFormat";
import { cn } from "@/lib/cn";

export type PhotoQuality = "preview" | "full_webp" | "original";

type LightboxAsset = {
  id: number;
  kind: "photo" | "video";
  hls_status?: string;
  is_live_photo?: boolean;
  width?: number;
  height?: number;
  urls?: AssetURLs;
};

// Aliyun OSS image-process AVIF transcoder caps: width <= 4096 and total
// pixels <= 9437184 (4096*2304). Larger images return an error body that
// Chrome treats as ORB, so we proactively skip AVIF on them.
const AVIF_MAX_WIDTH = 4096;
const AVIF_MAX_PIXELS = 9_437_184;

function canRenderAsAVIF(a: LightboxAsset): boolean {
  if (!a.width || !a.height) return true; // unknown → optimistically try
  if (a.width > AVIF_MAX_WIDTH || a.height > AVIF_MAX_WIDTH) return false;
  if (a.width * a.height > AVIF_MAX_PIXELS) return false;
  return true;
}

type Mode = "public" | "admin";

type Props = {
  assets: LightboxAsset[];
  index: number;
  mode?: Mode; // default "public"
  onClose: () => void;
  onIndexChange?: (i: number) => void;
  /** Hide nav arrows (e.g. single-asset share page). */
  singleMode?: boolean;
  /** Pagination — when set, swiping past the end triggers the next page. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

const SLIDESHOW_MS = 4000;

export function Lightbox({
  assets,
  index: initialIndex,
  mode = "public",
  onClose,
  onIndexChange,
  singleMode,
  hasMore,
  loadingMore,
  onLoadMore,
}: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [autoPlay, setAutoPlay] = useState(false);
  const [slideProgress, setSlideProgress] = useState(0);
  const [quality, setQuality] = useState<PhotoQuality>("preview");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const asset = assets[index];

  // Lock background scroll while the lightbox is open. Without this, pinch /
  // scroll wheel events leak through to the underlying grid, which both feels
  // broken and can shift the viewport so the close button is offscreen.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouch;
    };
  }, []);

  // Sync local state with the browser's actual fullscreen status — pressing
  // Esc to exit fullscreen bypasses our toggle handler entirely.
  useEffect(() => {
    function onChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (containerRef.current?.requestFullscreen) {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      /* user gesture lost or unsupported — ignore */
    }
  }, []);

  // Switching to a new asset resets to the lightest variant so we don't
  // accidentally re-download an original-size file on every navigation.
  useEffect(() => {
    setQuality("preview");
  }, [asset?.id]);

  const go = useCallback(
    (delta: number) => {
      const next = (index + delta + assets.length) % assets.length;
      setIndex(next);
      onIndexChange?.(next);
    },
    [index, assets.length, onIndexChange],
  );

  // Prefetch the next page when the viewer is within 2 items of the loaded
  // tail, so left/right swiping never hits an empty wall.
  useEffect(() => {
    if (!hasMore || loadingMore || !onLoadMore) return;
    if (index >= assets.length - 3) onLoadMore();
  }, [index, assets.length, hasMore, loadingMore, onLoadMore]);

  // Image-level prefetch: warm the browser cache with the previous and next
  // photo's preview URL so left/right navigation feels instant. Videos are
  // skipped — touching their URL endpoint would lazily kick off transcoding
  // for content the visitor may never actually open.
  useEffect(() => {
    if (assets.length < 2) return;
    const neighbours = [assets[index - 1], assets[index + 1]].filter(
      (a): a is LightboxAsset => !!a && a.kind === "photo",
    );
    let cancelled = false;
    (async () => {
      const avif = await supportsAVIF();
      for (const a of neighbours) {
        if (cancelled) return;
        const useAvif = avif && canRenderAsAVIF(a);
        let url: string | undefined;
        if (mode === "admin") {
          url =
            (useAvif && a.urls?.preview?.avif) ||
            a.urls?.preview?.webp ||
            a.urls?.preview?.avif;
        } else {
          try {
            url = (await api.publicAssetURL(a.id, "preview")).url;
          } catch {
            url = undefined;
          }
        }
        if (cancelled || !url) continue;
        const img = new Image();
        img.decoding = "async";
        img.src = url;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [index, assets, mode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Esc inside fullscreen is consumed by the browser to exit fullscreen;
      // only treat it as "close" when we're not fullscreen.
      if (e.key === "Escape") {
        if (!document.fullscreenElement) onClose();
      } else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === " ") {
        e.preventDefault();
        setAutoPlay((v) => !v);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        void toggleFullscreen();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose, toggleFullscreen]);

  // Slideshow tick: drives both the auto-advance and the countdown display.
  // Re-keying on asset.id resets progress whenever we move to a new slide
  // (manual nav or auto-advance both bump the id).
  useEffect(() => {
    if (!autoPlay || singleMode || asset?.kind === "video") {
      setSlideProgress(0);
      return;
    }
    const startedAt = Date.now();
    setSlideProgress(0);
    const t = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= SLIDESHOW_MS) {
        go(1);
      } else {
        setSlideProgress(elapsed / SLIDESHOW_MS);
      }
    }, 80);
    return () => window.clearInterval(t);
  }, [autoPlay, go, singleMode, asset?.kind, asset?.id]);

  if (!asset) return null;

  // On mobile, taps that land on controls (buttons, links, inputs) must not
  // be tracked by the swipe handler — otherwise the synthesised click after
  // touchend gets eaten by the bubble path and the button feels unresponsive.
  function targetIsInteractive(e: { target: EventTarget | null }) {
    const el = e.target as HTMLElement | null;
    return !!el?.closest("button, a, input, textarea, select, [role=button]");
  }

  const secondsLeft = Math.max(
    1,
    Math.ceil((1 - slideProgress) * (SLIDESHOW_MS / 1000)),
  );

  return (
    <div
      ref={containerRef}
      onClick={(e) => {
        // Only close when the click is truly on the backdrop, not bubbling
        // up from a button / image / panel.
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={(e) => {
        if (singleMode || assets.length <= 1) return;
        if (targetIsInteractive(e)) return;
        const t = e.touches[0];
        touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
      }}
      onTouchEnd={(e) => {
        const start = touchRef.current;
        touchRef.current = null;
        if (!start) return;
        if (targetIsInteractive(e)) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        // Treat as horizontal swipe only when mostly horizontal.
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          go(dx < 0 ? 1 : -1);
        }
      }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden overscroll-contain bg-black/95 p-3 sm:p-4"
    >
      {autoPlay && !singleMode && asset.kind === "photo" && (
        <div
          className="pointer-events-none absolute left-0 top-0 z-20 h-0.5 w-full bg-white/10"
          aria-hidden
        >
          <div
            className="h-full bg-white/85"
            style={{ width: `${Math.min(100, slideProgress * 100)}%` }}
          />
        </div>
      )}
      <div className="absolute right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-2 sm:right-4 sm:top-4">
        {asset.kind === "photo" && (
          <QualitySwitch value={quality} onChange={setQuality} />
        )}
        <div className="flex items-center gap-1.5 rounded-full bg-black/45 p-1 backdrop-blur-md ring-1 ring-white/15">
          <DownloadButton asset={asset} mode={mode} />
          {!singleMode && assets.length > 1 && (
            <>
              {autoPlay && asset.kind === "photo" && (
                <span
                  className="select-none px-1.5 text-xs font-medium tabular-nums text-white/85"
                  aria-live="polite"
                  title={`${secondsLeft} 秒后切换`}
                >
                  {secondsLeft}s
                </span>
              )}
              <IconButton
                label={autoPlay ? "暂停轮播" : "开始轮播"}
                active={autoPlay}
                onClick={(e) => {
                  e.stopPropagation();
                  setAutoPlay((v) => !v);
                }}
              >
                {autoPlay ? <PauseIcon /> : <PlayIcon />}
              </IconButton>
            </>
          )}
          <IconButton
            label={isFullscreen ? "退出全屏" : "全屏预览"}
            active={isFullscreen}
            onClick={(e) => {
              e.stopPropagation();
              void toggleFullscreen();
            }}
          >
            {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </IconButton>
          <IconButton
            label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <CloseIcon />
          </IconButton>
        </div>
      </div>

      {!singleMode && assets.length > 1 && (
        <>
          <NavArrow side="left" onClick={() => go(-1)} />
          <NavArrow side="right" onClick={() => go(1)} />
        </>
      )}

      <Stage asset={asset} mode={mode} quality={quality} key={asset.id} />

      <div onClick={(e) => e.stopPropagation()} className="mt-3 text-xs text-zinc-400">
        {!singleMode && (
          <span>
            {index + 1} / {assets.length}
          </span>
        )}
      </div>

      <ExifAndCommentsPanel asset={asset} mode={mode} />
    </div>
  );
}

function QualitySwitch({
  value,
  onChange,
}: {
  value: PhotoQuality;
  onChange: (q: PhotoQuality) => void;
}) {
  const items: { v: PhotoQuality; label: string; title: string }[] = [
    { v: "preview", label: "预览", title: "压缩后的 1600px 预览（默认）" },
    { v: "full_webp", label: "原尺寸", title: "原图分辨率的 WebP 重编码" },
    { v: "original", label: "原图", title: "未处理的源文件，最大画质 / 最大流量" },
  ];
  return (
    <div className="flex overflow-hidden rounded-md border border-white/20 text-xs">
      {items.map((it) => (
        <button
          key={it.v}
          type="button"
          title={it.title}
          onClick={(e) => {
            e.stopPropagation();
            onChange(it.v);
          }}
          className={cn(
            "px-2.5 py-1 transition",
            value === it.v
              ? "bg-white text-zinc-900"
              : "bg-white/10 text-white hover:bg-white/20",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function DownloadButton({ asset, mode }: { asset: LightboxAsset; mode: Mode }) {
  const [busy, setBusy] = useState(false);
  return (
    <IconButton
      label="下载原图"
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          // Always fetch a fresh signed URL — admin's cached urls.download
          // may have ticked past the OSS expiry by the time the user clicks.
          const r =
            mode === "admin"
              ? await api.adminAssetURL(asset.id, "download")
              : await api.publicAssetURL(asset.id, "download");
          if (!r.url) return;
          // Use an anchor click rather than window.open: the latter gets
          // blocked by Safari / Chrome popup heuristics after an `await`
          // (since the click context has been lost).
          const a = document.createElement("a");
          a.href = r.url;
          a.rel = "noopener";
          // download="" hints the browser to save instead of navigate even
          // if Content-Disposition is missing; the URL already sets it too.
          a.download = "";
          document.body.appendChild(a);
          a.click();
          a.remove();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner className="h-4 w-4 text-white" /> : <DownloadIcon />}
    </IconButton>
  );
}

function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full text-white transition",
        active
          ? "bg-white text-zinc-900"
          : "bg-transparent hover:bg-white/15 active:bg-white/25",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      {children}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M6 4.75v14.5a.75.75 0 0 0 1.13.65l12-7.25a.75.75 0 0 0 0-1.3l-12-7.25A.75.75 0 0 0 6 4.75Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  );
}

function FullscreenExitIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function NavArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/25",
        side === "left" ? "left-4" : "right-4",
      )}
      aria-label={side === "left" ? "上一张" : "下一张"}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}

function Stage({
  asset,
  mode,
  quality,
}: {
  asset: LightboxAsset;
  mode: Mode;
  quality: PhotoQuality;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [triedAVIFFallback, setTriedAVIFFallback] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    setInfo(null);
    setSrc(null);
    setTriedAVIFFallback(false);
    // Videos ignore the quality switch entirely.
    if (asset.kind === "video") {
      if (mode === "admin") {
        setSrc(asset.urls?.video ?? null);
        if (asset.hls_status === "pending") setInfo("视频转码中，先看原画");
      } else {
        api
          .publicAssetURL(asset.id, "video")
          .then((r) => {
            if (cancelled) return;
            setSrc(r.url);
            if (r.hls_status === "pending") setInfo("视频转码中，先看原画");
          })
          .catch(() => setLoading(false));
      }
      return () => {
        cancelled = true;
      };
    }
    // Photos: pick the variant matching the quality knob.
    // - preview (default): pre-sized WebP / AVIF
    // - full_webp: original pixels, WebP re-encode (smaller than original)
    // - original: raw source bytes
    (async () => {
      let variant: "preview" | "full_webp" | "full_avif" | "original" = "preview";
      if (quality === "full_webp") {
        const avif = await supportsAVIF();
        // Aliyun OSS rejects AVIF for very large source images — fall back
        // to WebP automatically so 原尺寸 never errors out.
        variant = avif && canRenderAsAVIF(asset) ? "full_avif" : "full_webp";
      } else if (quality === "original") {
        variant = "original";
      } else if (mode === "admin") {
        // admin + preview can use the listing-shipped URLs and skip a roundtrip.
        const avif = await supportsAVIF();
        const url =
          (avif && asset.urls?.preview?.avif) ||
          asset.urls?.preview?.webp ||
          asset.urls?.preview?.avif ||
          null;
        if (!cancelled) setSrc(url);
        return;
      }
      const r =
        mode === "admin"
          ? await api.adminAssetURL(asset.id, variant)
          : await api.publicAssetURL(asset.id, variant);
      if (cancelled) return;
      setSrc(r.url);
    })().catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.kind, asset.hls_status, asset.urls, mode, quality]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="relative flex h-[70vh] w-[90vw] items-center justify-center"
    >
      {info && (
        <span className="absolute left-2 top-2 z-10 rounded bg-amber-500/80 px-2 py-0.5 text-xs text-white">
          {info}
        </span>
      )}
      {(loading || !src) && !errored && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-zinc-300">
          <Spinner className="h-8 w-8 text-white" />
          <span className="text-sm">加载中…</span>
        </div>
      )}
      {errored && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-rose-300">
          加载失败
        </div>
      )}
      {src &&
        (asset.kind === "video" ? (
          <div className="relative">
            <HlsPlayer
              src={src}
              videoRef={videoRef}
              className="max-h-[70vh] max-w-full bg-black"
            />
            <DanmakuOverlay assetID={asset.id} videoRef={videoRef} />
          </div>
        ) : (
          <img
            src={src}
            alt=""
            onLoad={() => setLoading(false)}
            onError={async () => {
              // OSS AVIF fails for >4096px / >9.4Mpix images. Retry with the
              // WebP equivalent once before giving up.
              if (quality === "full_webp" && !triedAVIFFallback) {
                setTriedAVIFFallback(true);
                try {
                  const r =
                    mode === "admin"
                      ? await api.adminAssetURL(asset.id, "full_webp")
                      : await api.publicAssetURL(asset.id, "full_webp");
                  setSrc(r.url);
                  return;
                } catch {
                  /* fall through to error state */
                }
              }
              setLoading(false);
              setErrored(true);
            }}
            className={cn(
              "max-h-[70vh] max-w-full transition-opacity duration-200",
              loading ? "opacity-0" : "opacity-100",
            )}
          />
        ))}
    </div>
  );
}

function ExifAndCommentsPanel({ asset, mode }: { asset: LightboxAsset; mode: Mode }) {
  const [exif, setExif] = useState<Record<string, unknown> | null>(null);
  // Collapsed by default on narrow screens; open on tablets and wider.
  const [exifOpen, setExifOpen] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= 640,
  );
  const [commentsOpen, setCommentsOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setExif(null);
    if (asset.kind !== "photo") return;
    const fetcher = mode === "admin" ? api.assetExif : api.publicAssetEXIF;
    fetcher(asset.id)
      .then((v) => setExif((v as Record<string, unknown> | null) ?? {}))
      .catch(() => setExif({}));
  }, [asset.id, asset.kind, mode]);

  const showComments = mode === "public";

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "mt-3 grid w-full max-w-3xl gap-2",
        showComments && asset.kind === "photo" ? "sm:grid-cols-2" : "",
      )}
    >
      {asset.kind === "photo" && (
        <CollapseCard
          title="📷 EXIF"
          open={exifOpen}
          onToggle={() => setExifOpen((v) => !v)}
        >
          {exif === null ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Spinner className="h-4 w-4" />
              <span>加载中…</span>
            </div>
          ) : (
            <ExifList exif={exif} />
          )}
        </CollapseCard>
      )}
      {showComments && (
        <CollapseCard
          title={asset.kind === "video" ? "💬 弹幕 / 评论" : "💬 评论"}
          open={commentsOpen}
          onToggle={() => setCommentsOpen((v) => !v)}
        >
          <CommentBox
            targetType="asset"
            targetID={asset.id}
            videoTimeMs={
              asset.kind === "video"
                ? () =>
                    videoRef.current?.currentTime != null
                      ? videoRef.current.currentTime * 1000
                      : undefined
                : undefined
            }
          />
        </CollapseCard>
      )}
    </div>
  );
}

function CollapseCard({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-3 dark:bg-zinc-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-xs uppercase tracking-wide text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <span>{title}</span>
        <span>{open ? "收起 ▴" : "展开 ▾"}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

// ---- EXIF helpers ----

function exifVal(exif: Record<string, unknown>, key: string): string | undefined {
  const v = exif?.[key];
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return String((v as { value: unknown }).value);
  }
  if (typeof v === "string" || typeof v === "number") return String(v);
  return undefined;
}

function ExifList({ exif }: { exif: Record<string, unknown> }) {
  const items: Array<[string, string]> = [];
  const push = (label: string, raw?: string) => {
    if (raw && raw !== "0" && raw.trim() !== "") items.push([label, raw]);
  };
  push("拍摄时间", exifVal(exif, "DateTimeOriginal") || exifVal(exif, "DateTime"));
  push("相机", joinSpace(exifVal(exif, "Make"), exifVal(exif, "Model")));
  push("镜头", exifVal(exif, "LensModel"));
  push("ISO", exifVal(exif, "ISOSpeedRatings") || exifVal(exif, "PhotographicSensitivity"));
  push("光圈", exifVal(exif, "FNumber"));
  push("快门", exifVal(exif, "ExposureTime"));
  push("焦距", exifVal(exif, "FocalLength"));
  push("尺寸", joinSpace(exifVal(exif, "ImageWidth"), "×", exifVal(exif, "ImageHeight")));
  push("大小", formatFileSize(exifVal(exif, "FileSize")));
  const lat = exifVal(exif, "GPSLatitude");
  const lon = exifVal(exif, "GPSLongitude");
  if (lat && lon) push("GPS", `${lat}, ${lon}`);

  if (items.length === 0) {
    return <p className="text-xs text-zinc-500">没有 EXIF 数据</p>;
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {items.map(([k, v]) => (
        <FragmentDL key={k} k={k} v={v} />
      ))}
    </dl>
  );
}

function FragmentDL({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-zinc-500">{k}</dt>
      <dd className="font-mono text-zinc-800 dark:text-zinc-200">{v}</dd>
    </>
  );
}

function joinSpace(...parts: Array<string | undefined>): string | undefined {
  const xs = parts.filter(Boolean) as string[];
  if (xs.length === 0) return undefined;
  return xs.join(" ");
}

function formatFileSize(raw?: string) {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return raw;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
