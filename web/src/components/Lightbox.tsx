import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AssetURLs } from "@/lib/api";
import { Button } from "./ui";
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
  urls?: AssetURLs;
};

type Mode = "public" | "admin";

type Props = {
  assets: LightboxAsset[];
  index: number;
  mode?: Mode; // default "public"
  onClose: () => void;
  onIndexChange?: (i: number) => void;
  /** Hide nav arrows (e.g. single-asset share page). */
  singleMode?: boolean;
};

export function Lightbox({
  assets,
  index: initialIndex,
  mode = "public",
  onClose,
  onIndexChange,
  singleMode,
}: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [autoPlay, setAutoPlay] = useState(false);
  const [quality, setQuality] = useState<PhotoQuality>("preview");
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const asset = assets[index];

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === " ") {
        e.preventDefault();
        setAutoPlay((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  useEffect(() => {
    if (!autoPlay || singleMode || asset?.kind === "video") return;
    const t = window.setInterval(() => go(1), 4000);
    return () => window.clearInterval(t);
  }, [autoPlay, go, singleMode, asset?.kind]);

  if (!asset) return null;

  // On mobile, taps that land on controls (buttons, links, inputs) must not
  // be tracked by the swipe handler — otherwise the synthesised click after
  // touchend gets eaten by the bubble path and the button feels unresponsive.
  function targetIsInteractive(e: { target: EventTarget | null }) {
    const el = e.target as HTMLElement | null;
    return !!el?.closest("button, a, input, textarea, select, [role=button]");
  }

  return (
    <div
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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-3 sm:p-4"
    >
      <div className="absolute right-3 top-3 z-10 flex flex-wrap justify-end gap-2 sm:right-4 sm:top-4">
        {asset.kind === "photo" && (
          <QualitySwitch value={quality} onChange={setQuality} />
        )}
        <DownloadButton asset={asset} mode={mode} />
        {!singleMode && assets.length > 1 && (
          <Button
            size="sm"
            variant={autoPlay ? "primary" : "outline"}
            onClick={(e) => {
              e.stopPropagation();
              setAutoPlay((v) => !v);
            }}
          >
            {autoPlay ? "⏸ 暂停" : "▶ 轮播"}
          </Button>
        )}
        <button
          className="rounded-md bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          关闭
        </button>
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
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          let url: string | undefined;
          if (mode === "admin") {
            url = asset.urls?.download;
          } else {
            url = (await api.publicAssetURL(asset.id, "download")).url;
          }
          if (url) window.open(url, "_blank");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : "⬇ 下载原图"}
    </Button>
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
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    setInfo(null);
    setSrc(null);
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
        variant = avif ? "full_avif" : "full_webp";
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
            onError={() => {
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
