// Detect AVIF / WebP support once per session and cache the result so we can
// choose exactly one variant per image (avoids the browser fetching both
// formats from <picture> sources and saves OSS traffic).

let avifPromise: Promise<boolean> | null = null;
let webpPromise: Promise<boolean> | null = null;

function probe(dataURL: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width > 0 && img.height > 0);
    img.onerror = () => resolve(false);
    img.src = dataURL;
  });
}

// 1x1 black AVIF (160B) and WebP (28B) test images.
const AVIF_DATA_URL =
  "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=";
const WEBP_DATA_URL =
  "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";

export function supportsAVIF(): Promise<boolean> {
  if (!avifPromise) {
    const cached = sessionStorage.getItem("tm.avif");
    if (cached != null) {
      avifPromise = Promise.resolve(cached === "1");
    } else {
      avifPromise = probe(AVIF_DATA_URL).then((ok) => {
        sessionStorage.setItem("tm.avif", ok ? "1" : "0");
        return ok;
      });
    }
  }
  return avifPromise;
}

export function supportsWebP(): Promise<boolean> {
  if (!webpPromise) {
    const cached = sessionStorage.getItem("tm.webp");
    if (cached != null) {
      webpPromise = Promise.resolve(cached === "1");
    } else {
      webpPromise = probe(WEBP_DATA_URL).then((ok) => {
        sessionStorage.setItem("tm.webp", ok ? "1" : "0");
        return ok;
      });
    }
  }
  return webpPromise;
}
