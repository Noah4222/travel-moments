import { useEffect, useState } from "react";
import type { ImgURLs } from "@/lib/api";
import { supportsAVIF, markAVIFBroken } from "@/lib/imageFormat";
import { Spinner } from "./Spinner";
import { cn } from "@/lib/cn";

/**
 * Picks AVIF when supported, otherwise WebP. Only the chosen variant is
 * requested from OSS. Shows a shimmer + spinner until the image decodes.
 *
 * If the AVIF URL fails to load — most commonly because the bucket hasn't
 * enabled OSS 图片处理高级套餐 and returns a JSON error body that Chrome
 * blocks with ORB — we transparently fall back to the WebP URL. After two
 * such failures in a row we also mark AVIF as broken for the rest of the
 * page so further previews skip straight to WebP.
 */
export function PicturePreview({
  urls,
  alt = "",
  className,
  loading = "lazy",
}: {
  urls?: ImgURLs;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [triedFallback, setTriedFallback] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setErrored(false);
    setTriedFallback(false);
    if (!urls?.webp && !urls?.avif) {
      setSrc(null);
      return;
    }
    supportsAVIF().then((avif) => {
      if (cancelled) return;
      const chosen = avif && urls.avif ? urls.avif : urls.webp || urls.avif || null;
      setSrc(chosen);
    });
    return () => {
      cancelled = true;
    };
  }, [urls?.avif, urls?.webp]);

  function onError() {
    // If AVIF failed and we haven't tried yet, swap to WebP.
    if (!triedFallback && src && urls?.avif && src === urls.avif && urls.webp) {
      markAVIFBroken();
      setTriedFallback(true);
      setSrc(urls.webp);
      return;
    }
    setErrored(true);
  }

  if (!urls?.webp && !urls?.avif) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-xs text-zinc-400",
          className,
        )}
      >
        无预览
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {!loaded && !errored && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-200 dark:bg-zinc-800">
          <Spinner className="h-6 w-6 text-zinc-400 dark:text-zinc-500" />
        </div>
      )}
      {errored && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">
          加载失败
        </div>
      )}
      {src && (
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={onError}
          className={cn(
            "h-full w-full object-cover",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
