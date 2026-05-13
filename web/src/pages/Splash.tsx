import { useMemo } from "react";

/**
 * Public landing page at "/". Tiles a random subset of curated Unsplash
 * travel photos full-bleed behind a centred CTA card.
 *
 * The IDs are stable Unsplash photo identifiers served from
 * images.unsplash.com (no API key required, public CDN).
 */

const PHOTO_IDS = [
  "1506905925346-21bda4d32df4", // mountain lake
  "1500530855697-b586d89ba3ee", // alpine
  "1501785888041-af3ef285b470", // beach
  "1504280390367-361c6d9f38f4", // canyon
  "1502082553048-f009c37129b9", // forest road
  "1519681393784-d120267933ba", // milky way mountain
  "1500382017468-9049fed747ef", // valley
  "1473625247510-8ceb1760943f", // dolomites
  "1464822759023-fed622ff2c3b", // norway fjord
  "1507525428034-b723cf961d3e", // beach palm
  "1470770841072-f978cf4d019e", // mountain trail
  "1494500764479-0c8f2919a3d8", // green hills
  "1455587734955-081b22074882", // valley clouds
  "1493558103817-58b2924bce98", // sunset clouds
  "1469854523086-cc02fe5d8800", // tropical
  "1496950866446-3253e1470e8e", // northern lights
];

function shuffled<T>(arr: T[], n: number): T[] {
  const cp = arr.slice();
  for (let i = cp.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cp[i], cp[j]] = [cp[j], cp[i]];
  }
  return cp.slice(0, n);
}

function unsplashURL(id: string, w: number) {
  return `https://images.unsplash.com/photo-${id}?w=${w}&q=70&auto=format&fit=crop`;
}

export function SplashPage() {
  const photos = useMemo(() => shuffled(PHOTO_IDS, 12), []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <div className="absolute inset-0 grid grid-cols-3 sm:grid-cols-4 grid-rows-4 sm:grid-rows-3">
        {photos.map((id, i) => (
          <div
            key={id + i}
            className="relative overflow-hidden [content-visibility:auto] [contain-intrinsic-size:200px]"
          >
            <img
              src={unsplashURL(id, 800)}
              alt=""
              loading={i < 4 ? "eager" : "lazy"}
              decoding="async"
              className="h-full w-full object-cover opacity-80"
            />
          </div>
        ))}
      </div>

      {/* Centre card with soft scrim */}
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/30 via-black/45 to-black/65 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white/85 p-6 text-center shadow-2xl backdrop-blur-md sm:p-8 dark:bg-zinc-900/85">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Travel Moments
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            把每一段旅行的照片和视频留下来，跟好朋友们一起重温。
          </p>
          <p className="mt-6 text-[11px] text-zinc-400">
            背景图来自 Unsplash
          </p>
        </div>
      </div>
    </div>
  );
}
