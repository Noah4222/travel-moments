import { useEffect, useMemo, useState } from "react";
import { Button, Input, Label } from "./ui";

/** Parsed representation of an OSS image-process string. */
type Spec = {
  width?: number;
  height?: number;
  quality?: number;
  mode: ScaleMode;
  format: "webp" | "avif" | "jpg" | "png";
};

type ScaleMode = "lfit" | "mfit" | "fill" | "pad" | "fixed";

const MODES: { value: ScaleMode; label: string; desc: string }[] = [
  { value: "lfit", label: "长边适应", desc: "等比缩放，长边不超过设定值（推荐）" },
  { value: "mfit", label: "短边适应", desc: "等比缩放，短边不小于设定值" },
  { value: "fill", label: "裁剪填充", desc: "等比缩放后居中裁剪到指定尺寸" },
  { value: "pad", label: "留白填充", desc: "等比缩放后空白填充到指定尺寸" },
  { value: "fixed", label: "固定尺寸", desc: "强制拉伸到指定宽高（可能变形）" },
];

function parseSpec(s: string, defaultFormat: Spec["format"]): Spec {
  const out: Spec = { mode: "lfit", format: defaultFormat };
  if (!s) return out;
  for (const seg of s.split("/")) {
    if (seg === "" || seg === "image") continue;
    const parts = seg.split(",");
    const action = parts[0];
    for (const p of parts.slice(1)) {
      const dash = p.indexOf("_");
      if (dash === -1) {
        if (action === "format") {
          out.format = p as Spec["format"];
        }
        continue;
      }
      const k = p.slice(0, dash);
      const v = p.slice(dash + 1);
      const n = Number(v);
      switch (k) {
        case "w":
          out.width = n;
          break;
        case "h":
          out.height = n;
          break;
        case "q":
          out.quality = n;
          break;
        case "m":
          out.mode = (v as ScaleMode) || "lfit";
          break;
      }
    }
  }
  return out;
}

function buildSpec(s: Spec): string {
  const resize = ["resize", `m_${s.mode}`];
  if (s.width) resize.push(`w_${s.width}`);
  if (s.height) resize.push(`h_${s.height}`);
  const parts = ["image", resize.join(",")];
  if (s.quality) parts.push(`quality,q_${s.quality}`);
  parts.push(`format,${s.format}`);
  return parts.join("/");
}

export function ImageProcessEditor({
  label,
  desc,
  effective,
  draft,
  defaultFormat,
  onSave,
  saving,
}: {
  label: string;
  desc: string;
  effective: string;
  draft: string;
  defaultFormat: "webp" | "avif";
  onSave: (next: string) => void | Promise<void>;
  saving?: boolean;
}) {
  // Use current effective string as the source of truth so admins always see
  // exactly what the server is applying.
  const initial = useMemo(
    () => parseSpec(draft || effective, defaultFormat),
    [draft, effective, defaultFormat],
  );
  const [spec, setSpec] = useState<Spec>(initial);

  // Re-sync state if the effective changes externally (after save).
  useEffect(() => {
    setSpec(parseSpec(draft || effective, defaultFormat));
  }, [draft, effective, defaultFormat]);

  const built = buildSpec(spec);
  const dirty = built !== effective;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <Label>
        {label}{" "}
        <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {defaultFormat}
        </span>
      </Label>
      <p className="mb-3 text-xs text-zinc-500">{desc}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label>宽度（像素）</Label>
          <Input
            type="number"
            min={1}
            value={spec.width ?? ""}
            placeholder="不限"
            onChange={(e) =>
              setSpec((s) => ({
                ...s,
                width: e.target.value ? Number(e.target.value) : undefined,
              }))
            }
          />
        </div>
        <div>
          <Label>质量（1-100）</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={spec.quality ?? ""}
            placeholder="默认"
            onChange={(e) =>
              setSpec((s) => ({
                ...s,
                quality: e.target.value ? Number(e.target.value) : undefined,
              }))
            }
          />
        </div>
        <div>
          <Label>缩放模式</Label>
          <select
            value={spec.mode}
            onChange={(e) =>
              setSpec((s) => ({ ...s, mode: e.target.value as ScaleMode }))
            }
            className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {MODES.find((m) => m.value === spec.mode)?.desc}
      </p>

      <div className="mt-3 break-all rounded bg-zinc-50 p-2 font-mono text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        {built}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          disabled={saving || !dirty}
          onClick={() => onSave(built)}
        >
          {saving ? "保存中…" : dirty ? "保存" : "无改动"}
        </Button>
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSpec(parseSpec(effective, defaultFormat))}
          >
            还原
          </Button>
        )}
      </div>
    </div>
  );
}
