// Aliyun OSS image-process basic tier rejects sources >= 20 MiB / pixel-count
// > 250M / either dimension > 30000. We pre-shrink offending uploads here so
// that thumbs/previews keep working. Browser HEIC decode isn't widely
// supported so HEIC files pass through untouched (they're rarely > 20 MB).

const HARD_MAX_BYTES = 20 * 1024 * 1024; // OSS limit
const TARGET_BYTES = 18 * 1024 * 1024;   // shrink target — give some slack
const MAX_EDGE = 6000;                    // bounding box for re-encode

const SHRINKABLE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export type ShrinkResult = {
  file: File;
  shrunk: boolean;
  /** What we reduced from -> to, useful for showing the user. */
  originalSize?: number;
  newSize?: number;
};

/**
 * If `file` is an image larger than OSS's image-process limit, re-encode it
 * via Canvas into a sub-20MB JPEG, preserving the basename + a ".compressed"
 * suffix in the new filename so it's still recognisable. Anything we can't
 * decode (HEIC, video, etc.) is returned unchanged.
 */
export async function shrinkForOSS(file: File): Promise<ShrinkResult> {
  if (file.size < HARD_MAX_BYTES) return { file, shrunk: false };
  if (!SHRINKABLE_TYPES.has(file.type.toLowerCase())) {
    // Can't safely decode in browser; let it through and surface the error
    // upstream if OSS rejects it.
    return { file, shrunk: false };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file, shrunk: false };
  }

  // Bounding-box resize so the longer edge ≤ MAX_EDGE.
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  // Try descending qualities until we fit under TARGET_BYTES.
  for (const quality of [0.92, 0.88, 0.82, 0.75]) {
    const blob = await encode(bitmap, w, h, quality);
    if (blob && blob.size <= TARGET_BYTES) {
      bitmap.close?.();
      const renamed = renameCompressed(file.name);
      return {
        file: new File([blob], renamed, { type: "image/jpeg", lastModified: file.lastModified }),
        shrunk: true,
        originalSize: file.size,
        newSize: blob.size,
      };
    }
  }
  bitmap.close?.();
  return { file, shrunk: false };
}

async function encode(
  bitmap: ImageBitmap,
  w: number,
  h: number,
  quality: number,
): Promise<Blob | null> {
  // Prefer OffscreenCanvas where available (off-main-thread encode).
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    try {
      return await c.convertToBlob({ type: "image/jpeg", quality });
    } catch {
      /* fall through */
    }
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return await new Promise<Blob | null>((resolve) =>
    c.toBlob((b) => resolve(b), "image/jpeg", quality),
  );
}

function renameCompressed(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name + ".jpg";
  const base = name.slice(0, dot);
  return base + ".jpg";
}
