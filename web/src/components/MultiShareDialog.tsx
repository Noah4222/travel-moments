import { useState } from "react";
import { api, type Trip, type ShareCreated } from "@/lib/api";
import { Button, Card, Input, Label } from "./ui";
import { PicturePreview } from "./PicturePreview";
import { CreatedShareCard } from "./SharesPanel";
import { cn } from "@/lib/cn";
import { composeMultiShareCopy } from "@/lib/clipboard";

const EXPIRY_OPTIONS = [
  { label: "永不过期", hours: 0 },
  { label: "1 小时", hours: 1 },
  { label: "24 小时", hours: 24 },
  { label: "7 天", hours: 24 * 7 },
  { label: "30 天", hours: 24 * 30 },
];

export function MultiShareDialog({
  trips,
  onClose,
}: {
  trips: Trip[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [expiryHours, setExpiryHours] = useState(0);
  const [disableForward, setDisableForward] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ShareCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const expires_at =
        expiryHours > 0
          ? new Date(Date.now() + expiryHours * 3600 * 1000).toISOString()
          : undefined;
      const r = await api.createMultiShare({
        trip_ids: Array.from(selected),
        note: note || undefined,
        expires_at,
        disable_forward: disableForward,
      });
      setCreated(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <Card
        className="w-full max-w-2xl space-y-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">分享多个相册</h2>
            <p className="text-xs text-zinc-500">
              访客拿到链接后会看到选中的相册列表
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>

        {created ? (
          <CreatedShareCard
            created={created}
            composeMessage={composeMultiShareCopy}
            onClose={onClose}
          />
        ) : (
          <>
            <div>
              <Label>选择相册（{selected.size} 个已选）</Label>
              <ul className="grid max-h-72 grid-cols-2 gap-2 overflow-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800 sm:grid-cols-3">
                {trips.map((t) => (
                  <li
                    key={t.id}
                    onClick={() => toggle(t.id)}
                    className={cn(
                      "relative cursor-pointer overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800",
                      selected.has(t.id) && "ring-2 ring-emerald-500",
                    )}
                  >
                    <div className="aspect-square">
                      <PicturePreview
                        urls={t.cover_url}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="bg-white p-2 dark:bg-zinc-900">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      {t.location && (
                        <p className="truncate text-xs text-zinc-500">
                          📍 {t.location}
                        </p>
                      )}
                    </div>
                    {selected.has(t.id) && (
                      <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 text-xs text-white">
                        ✓
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>备注</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="给谁的"
                />
              </div>
              <div>
                <Label>有效时长</Label>
                <select
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(Number(e.target.value))}
                  className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  {EXPIRY_OPTIONS.map((o) => (
                    <option key={o.hours} value={o.hours}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={disableForward}
                onChange={(e) => setDisableForward(e.target.checked)}
              />
              禁止访客继续转发
            </label>

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                取消
              </Button>
              <Button
                disabled={busy || selected.size === 0}
                onClick={submit}
              >
                {busy ? "生成中…" : `生成分享（${selected.size}）`}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
