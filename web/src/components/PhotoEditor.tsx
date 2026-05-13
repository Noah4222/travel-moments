import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, apiFetch, type Asset } from "@/lib/api";
import { Button, Card } from "./ui";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

/**
 * Admin photo editor. Builds a chain of OSS image-process operations
 * (rotate / crop / bright / contrast / sharpen) and posts them to
 * /api/assets/:id/edit. CSS filters drive the live preview; the actual
 * pixel work happens server-side via OSS sys/saveas.
 */

type EditOp =
  | { kind: "rotate"; deg: number }
  | { kind: "crop"; x: number; y: number; w: number; h: number }
  | { kind: "bright"; v: number }
  | { kind: "contrast"; v: number }
  | { kind: "sharpen"; v: number };

type CropRect = { x: number; y: number; w: number; h: number }; // 0..1 fractions

const ASPECTS: { label: string; ratio: number | null }[] = [
  { label: "自由", ratio: null },
  { label: "1:1", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
];

export function PhotoEditor({
  asset,
  onClose,
  onSaved,
}: {
  asset: Asset;
  onClose: () => void;
  onSaved: (a: Asset) => void;
}) {
  const [rotation, setRotation] = useState(0); // 0 / 90 / 180 / 270
  const [bright, setBright] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [sharpen, setSharpen] = useState(0); // 0 (off) or 50..399
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const [previewURL, setPreviewURL] = useState<string | null>(null);

  // Use a fresh admin-signed preview URL so it's still valid even if the
  // grid was loaded long ago.
  useEffect(() => {
    let cancelled = false;
    api
      .adminAssetURL(asset.id, "preview")
      .then((r) => {
        if (!cancelled) setPreviewURL(r.url);
      })
      .catch(() => {
        if (!cancelled) setPreviewURL(asset.urls.preview?.webp ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.urls.preview?.webp]);

  function reset() {
    setRotation(0);
    setBright(0);
    setContrast(0);
    setSharpen(0);
    setCrop(null);
    setAspect(null);
  }

  // Effective rotated source size (after rotate, before crop). Used to map
  // the crop fractions to pixel coords for the backend.
  const rotatedDims = useMemo(() => {
    const w = asset.width ?? 0;
    const h = asset.height ?? 0;
    if (rotation === 90 || rotation === 270) return { w: h, h: w };
    return { w, h };
  }, [asset.width, asset.height, rotation]);

  function buildOps(): EditOp[] {
    const ops: EditOp[] = [];
    if (rotation) ops.push({ kind: "rotate", deg: rotation });
    if (crop && rotatedDims.w > 0 && rotatedDims.h > 0) {
      const px = Math.round(crop.x * rotatedDims.w);
      const py = Math.round(crop.y * rotatedDims.h);
      const pw = Math.round(crop.w * rotatedDims.w);
      const ph = Math.round(crop.h * rotatedDims.h);
      if (pw > 0 && ph > 0) ops.push({ kind: "crop", x: px, y: py, w: pw, h: ph });
    }
    if (bright !== 0) ops.push({ kind: "bright", v: bright });
    if (contrast !== 0) ops.push({ kind: "contrast", v: contrast });
    if (sharpen > 0) ops.push({ kind: "sharpen", v: sharpen });
    return ops;
  }

  async function save() {
    const ops = buildOps();
    if (ops.length === 0) {
      setError("没有任何修改");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await apiFetch<Asset>(`/assets/${asset.id}/edit`, {
        method: "POST",
        body: { ops, replace },
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // CSS preview filter — matches OSS bright/contrast semantics loosely
  // enough to give a useful preview. Sharpen has no native CSS equivalent.
  const filterStyle = useMemo(() => {
    const filters: string[] = [];
    if (bright !== 0) filters.push(`brightness(${1 + bright / 200})`);
    if (contrast !== 0) filters.push(`contrast(${1 + contrast / 200})`);
    return filters.join(" ");
  }, [bright, contrast]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-6"
    >
      <Card
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden p-0"
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-base font-semibold">图片编辑</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[1fr_280px]">
          {/* Stage */}
          <div className="relative flex min-h-[55vh] items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-900">
            {!previewURL ? (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Spinner className="h-5 w-5" /> 加载图片…
              </div>
            ) : (
              <CropStage
                src={previewURL}
                rotation={rotation}
                filter={filterStyle}
                aspect={aspect}
                crop={crop}
                onCropChange={setCrop}
              />
            )}
          </div>

          {/* Controls */}
          <aside className="flex flex-col gap-4 overflow-y-auto border-t border-zinc-200 px-4 py-4 text-sm md:border-l md:border-t-0 dark:border-zinc-800">
            <ControlGroup title="旋转">
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRotation((r) => (r + 270) % 360)}
                >
                  ⟲ 90°
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                >
                  ⟳ 90°
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRotation((r) => (r + 180) % 360)}
                >
                  180°
                </Button>
              </div>
              <p className="text-xs text-zinc-500">当前：{rotation}°</p>
            </ControlGroup>

            <ControlGroup title="裁剪比例">
              <div className="flex flex-wrap gap-1">
                {ASPECTS.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => {
                      setAspect(a.ratio);
                      // Reset existing crop so the new ratio takes effect cleanly.
                      setCrop(null);
                    }}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs transition",
                      aspect === a.ratio
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800",
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-500">
                {crop
                  ? `已选 ${Math.round(crop.w * 100)}% × ${Math.round(crop.h * 100)}%`
                  : "在图上拖选区域"}
              </p>
              {crop && (
                <Button size="sm" variant="ghost" onClick={() => setCrop(null)}>
                  清除裁剪
                </Button>
              )}
            </ControlGroup>

            <Slider
              label="亮度"
              value={bright}
              min={-100}
              max={100}
              onChange={setBright}
              suffix={bright > 0 ? `+${bright}` : `${bright}`}
            />
            <Slider
              label="对比度"
              value={contrast}
              min={-100}
              max={100}
              onChange={setContrast}
              suffix={contrast > 0 ? `+${contrast}` : `${contrast}`}
            />
            <Slider
              label="锐化"
              value={sharpen}
              min={0}
              max={399}
              step={1}
              snapToZero
              onChange={setSharpen}
              suffix={sharpen === 0 ? "关闭" : `${sharpen}`}
              hint="0 = 关闭；50–399"
            />

            <div className="rounded-md bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                />
                覆盖原图
              </label>
              <p className="mt-1 text-zinc-500">
                {replace
                  ? "原图会被删除，无法恢复"
                  : "保留原图，另存为新资源"}
              </p>
            </div>

            {error && <p className="text-xs text-rose-600">{error}</p>}
          </aside>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
            重置
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "保存中…" : "保存"}
            </Button>
          </div>
        </footer>
      </Card>
    </div>
  );
}

function ControlGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
  hint,
  snapToZero,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
  hint?: string;
  snapToZero?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className="font-mono text-xs text-zinc-500">{suffix}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(snapToZero ? 0 : 0)}
        className="w-full accent-emerald-500"
      />
      {hint && <p className="text-[10px] text-zinc-400">{hint}</p>}
    </div>
  );
}

function CropStage({
  src,
  rotation,
  filter,
  aspect,
  crop,
  onCropChange,
}: {
  src: string;
  rotation: number;
  filter: string;
  aspect: number | null;
  crop: CropRect | null;
  onCropChange: (c: CropRect | null) => void;
}) {
  // We let the rotated image fit into a fixed-aspect-ratio container so the
  // crop overlay maps cleanly to the rendered image. The container reports
  // its natural display rect via getBoundingClientRect() at the moment of
  // drag — no need to track resize.
  const imgRef = useRef<HTMLImageElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [intent, setIntent] = useState<
    | { kind: "new" }
    | { kind: "move"; startCrop: CropRect; startX: number; startY: number }
    | { kind: "resize"; handle: "nw" | "ne" | "sw" | "se"; startCrop: CropRect }
  >({ kind: "new" });

  const updateFromPointer = useCallback(
    (e: PointerEvent) => {
      const box = wrapperRef.current?.getBoundingClientRect();
      if (!box) return;
      const px = (e.clientX - box.left) / box.width;
      const py = (e.clientY - box.top) / box.height;
      const cx = Math.max(0, Math.min(1, px));
      const cy = Math.max(0, Math.min(1, py));
      if (intent.kind === "new" && dragStart) {
        let x = Math.min(dragStart.x, cx);
        let y = Math.min(dragStart.y, cy);
        let w = Math.abs(cx - dragStart.x);
        let h = Math.abs(cy - dragStart.y);
        if (aspect && w > 0 && h > 0) {
          const containerRatio = (box.width * w) / (box.height * h);
          if (containerRatio > aspect) {
            const newW = (box.height * h * aspect) / box.width;
            if (cx >= dragStart.x) x = dragStart.x;
            else x = dragStart.x - newW;
            w = newW;
          } else {
            const newH = (box.width * w) / aspect / box.height;
            if (cy >= dragStart.y) y = dragStart.y;
            else y = dragStart.y - newH;
            h = newH;
          }
        }
        onCropChange({ x, y, w, h });
      } else if (intent.kind === "move" && crop) {
        const dx = cx - intent.startX;
        const dy = cy - intent.startY;
        const nx = Math.max(0, Math.min(1 - crop.w, intent.startCrop.x + dx));
        const ny = Math.max(0, Math.min(1 - crop.h, intent.startCrop.y + dy));
        onCropChange({ ...crop, x: nx, y: ny });
      } else if (intent.kind === "resize" && crop) {
        const c = intent.startCrop;
        let x1 = c.x;
        let y1 = c.y;
        let x2 = c.x + c.w;
        let y2 = c.y + c.h;
        if (intent.handle.includes("w")) x1 = cx;
        if (intent.handle.includes("e")) x2 = cx;
        if (intent.handle.includes("n")) y1 = cy;
        if (intent.handle.includes("s")) y2 = cy;
        if (x2 < x1) [x1, x2] = [x2, x1];
        if (y2 < y1) [y1, y2] = [y2, y1];
        let w = x2 - x1;
        let h = y2 - y1;
        if (aspect && w > 0 && h > 0) {
          const containerRatio = (box.width * w) / (box.height * h);
          if (containerRatio > aspect) {
            const newW = (box.height * h * aspect) / box.width;
            if (intent.handle.includes("e")) x2 = x1 + newW;
            else x1 = x2 - newW;
            w = newW;
          } else {
            const newH = (box.width * w) / aspect / box.height;
            if (intent.handle.includes("s")) y2 = y1 + newH;
            else y1 = y2 - newH;
            h = newH;
          }
        }
        onCropChange({ x: x1, y: y1, w, h });
      }
    },
    [intent, dragStart, crop, aspect, onCropChange],
  );

  useEffect(() => {
    if (!dragStart) return;
    function onMove(e: PointerEvent) {
      updateFromPointer(e);
    }
    function onUp() {
      setDragStart(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragStart, updateFromPointer]);

  function pointerCoords(e: React.PointerEvent): { x: number; y: number } {
    const box = wrapperRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - box.left) / box.width,
      y: (e.clientY - box.top) / box.height,
    };
  }

  function onWrapperPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).dataset.role) return; // handle / move-area
    e.preventDefault();
    const { x, y } = pointerCoords(e);
    setIntent({ kind: "new" });
    setDragStart({ x, y });
    onCropChange({ x, y, w: 0, h: 0 });
  }

  return (
    <div
      ref={wrapperRef}
      onPointerDown={onWrapperPointerDown}
      className="relative h-full w-full touch-none select-none"
    >
      <img
        ref={imgRef}
        src={src}
        alt=""
        style={{ transform: `rotate(${rotation}deg)`, filter }}
        className="pointer-events-none absolute inset-0 m-auto max-h-full max-w-full object-contain transition-transform"
      />
      {crop && crop.w > 0 && crop.h > 0 && (
        <CropOverlay
          crop={crop}
          onMoveStart={(e) => {
            const { x, y } = pointerCoords(e);
            setIntent({
              kind: "move",
              startCrop: crop,
              startX: x,
              startY: y,
            });
            setDragStart({ x, y });
          }}
          onResizeStart={(e, handle) => {
            const { x, y } = pointerCoords(e);
            setIntent({ kind: "resize", handle, startCrop: crop });
            setDragStart({ x, y });
          }}
        />
      )}
    </div>
  );
}

function CropOverlay({
  crop,
  onMoveStart,
  onResizeStart,
}: {
  crop: CropRect;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (
    e: React.PointerEvent,
    handle: "nw" | "ne" | "sw" | "se",
  ) => void;
}) {
  return (
    <div
      data-role="crop-area"
      onPointerDown={(e) => {
        e.stopPropagation();
        onMoveStart(e);
      }}
      style={{
        left: `${crop.x * 100}%`,
        top: `${crop.y * 100}%`,
        width: `${crop.w * 100}%`,
        height: `${crop.h * 100}%`,
      }}
      className="absolute cursor-move ring-2 ring-emerald-400 ring-inset"
    >
      <div className="absolute inset-0 ring-1 ring-white/40" />
      {(["nw", "ne", "sw", "se"] as const).map((h) => (
        <span
          key={h}
          data-role="handle"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeStart(e, h);
          }}
          className={cn(
            "absolute h-3.5 w-3.5 rounded-full bg-white shadow-md ring-2 ring-emerald-500",
            h === "nw" && "-left-2 -top-2 cursor-nw-resize",
            h === "ne" && "-right-2 -top-2 cursor-ne-resize",
            h === "sw" && "-bottom-2 -left-2 cursor-sw-resize",
            h === "se" && "-bottom-2 -right-2 cursor-se-resize",
          )}
        />
      ))}
    </div>
  );
}
