import { useRef } from "react";
import { PicturePreview } from "@/components/PicturePreview";
import type { PublicAsset } from "@/lib/api";
import type { ThemeId, ThemeTokens } from "@/themes/tokens";

type Props = {
  asset: PublicAsset;
  index: number;
  total: number;
  themeId: ThemeId;
  tokens: ThemeTokens;
  onClick: () => void;
  /** Inline width/height override (for justified rows). When undefined the tile
   *  is a CSS-grid cell and goes square via aspect-ratio. */
  fixedWidth?: number;
  fixedHeight?: number;
  rotateDeg?: number;
};

export function ThemedTile({
  asset,
  index,
  themeId,
  tokens,
  onClick,
  fixedWidth,
  fixedHeight,
  rotateDeg = 0,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const live = asset.is_live_photo && !!asset.urls.motion;
  const isVideo = asset.kind === "video";

  const inner = (
    <button
      type="button"
      onClick={onClick}
      className="group relative block h-full w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900"
      style={{
        // B theme tiles get a thin paper mat
        padding: themeId === "b" ? 4 : 0,
        background: themeId === "b" ? "#fff" : undefined,
        boxShadow: themeId === "b" ? "0 2px 6px rgba(0,0,0,.08)" : undefined,
      }}
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
      <div className="relative h-full w-full">
        <PicturePreview
          urls={isVideo ? asset.urls.video_cover : asset.urls.thumb}
          className="block h-full w-full object-cover"
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

        {/* Theme A — frame number bar */}
        {themeId === "a" && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-1.5 py-1 text-[9px] tracking-[.05em] text-white"
            style={{
              background: "linear-gradient(to top, rgba(0,0,0,.55), rgba(0,0,0,0))",
              fontFamily: tokens.mono,
            }}
          >
            <span>{String(index + 1).padStart(3, "0")}</span>
            {isVideo && <span style={{ color: tokens.accent }}>● REC</span>}
            {live && !isVideo && <span>LIVE</span>}
          </div>
        )}

        {/* Theme B — black photo corners */}
        {themeId === "b" && <PhotoCorners size={10} />}

        {/* Theme C — minimal kind badge */}
        {themeId === "c" && (isVideo || live) && (
          <div
            className="pointer-events-none absolute left-2 top-2 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-black"
            style={{ fontFamily: tokens.sans }}
          >
            {isVideo ? "▶ Video" : "Live"}
          </div>
        )}

        {/* Theme A/B fallback kind badge */}
        {themeId !== "c" && (isVideo || live) && (
          <div
            className="pointer-events-none absolute right-2 top-2 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
            style={{
              background: live ? tokens.accent : "#0a0a0a",
              color: live ? "#0a0a0a" : "#fff",
              fontFamily: tokens.sans,
            }}
          >
            {isVideo ? "▶ Video" : "Live"}
          </div>
        )}
      </div>
    </button>
  );

  if (fixedWidth != null && fixedHeight != null) {
    return (
      <div
        style={{
          width: fixedWidth,
          height: fixedHeight,
          flexShrink: 0,
          transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
        }}
      >
        {inner}
      </div>
    );
  }
  return (
    <div
      className="aspect-square w-full"
      style={{ transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined }}
    >
      {inner}
    </div>
  );
}

function PhotoCorners({ size = 10, color = "#0a0a0a" }: { size?: number; color?: string }) {
  const styles: Array<{ pos: React.CSSProperties; clip: string }> = [
    { pos: { top: 0, left: 0 }, clip: "polygon(0 0, 100% 0, 0 100%)" },
    { pos: { top: 0, right: 0 }, clip: "polygon(100% 0, 100% 100%, 0 0)" },
    { pos: { bottom: 0, left: 0 }, clip: "polygon(0 0, 0 100%, 100% 100%)" },
    { pos: { bottom: 0, right: 0 }, clip: "polygon(100% 0, 100% 100%, 0 100%)" },
  ];
  return (
    <>
      {styles.map((s, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            width: size,
            height: size,
            background: color,
            clipPath: s.clip,
            ...s.pos,
          }}
        />
      ))}
    </>
  );
}
