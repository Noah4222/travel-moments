import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type Level = { index: number; height: number; bitrate: number };

/**
 * HLS-aware video player. Plays m3u8 via hls.js where supported, falls back to
 * native HLS (Safari) or plain mp4. Adds a quality-selection menu that maps to
 * hls.js levels.
 */
export function HlsPlayer({
  src,
  videoRef,
  className,
  autoPlay = true,
}: {
  src: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  className?: string;
  autoPlay?: boolean;
}) {
  const hlsRef = useRef<Hls | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [current, setCurrent] = useState<number>(-1); // -1 = auto

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Plain mp4 fallback
    const isHLS = /\.m3u8(\?|$)/i.test(src);
    if (!isHLS) {
      video.src = src;
      setLevels([]);
      return;
    }

    // Native Safari HLS support — no fancy quality menu.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }

    if (!Hls.isSupported()) {
      video.src = src;
      return;
    }

    const hls = new Hls({ enableWorker: true });
    hlsRef.current = hls;
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setLevels(
        hls.levels.map((l, i) => ({
          index: i,
          height: l.height || 0,
          bitrate: l.bitrate || 0,
        })),
      );
      setCurrent(-1);
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
      setCurrent(hls.autoLevelEnabled ? -1 : data.level);
    });

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [src, videoRef]);

  function setLevel(idx: number) {
    const hls = hlsRef.current;
    if (!hls) return;
    if (idx === -1) {
      hls.currentLevel = -1; // auto
    } else {
      hls.currentLevel = idx;
    }
    setCurrent(idx);
  }

  return (
    <div className="relative">
      <video
        ref={videoRef}
        controls
        autoPlay={autoPlay}
        className={className}
        playsInline
      />
      {levels.length > 1 && (
        <div className="absolute bottom-12 right-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
          <select
            value={current}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="bg-transparent text-white outline-none"
          >
            <option value={-1}>自动</option>
            {[...levels]
              .sort((a, b) => b.height - a.height)
              .map((l) => (
                <option key={l.index} value={l.index}>
                  {l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)}kbps`}
                </option>
              ))}
          </select>
        </div>
      )}
    </div>
  );
}
