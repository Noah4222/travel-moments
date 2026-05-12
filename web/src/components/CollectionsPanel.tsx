import { useEffect, useState } from "react";
import {
  api,
  type Asset,
  type Collection,
  type ShareCreated,
} from "@/lib/api";
import { Badge, Button, Card, Input, Label } from "./ui";
import { PicturePreview } from "./PicturePreview";
import { CreatedShareCard } from "./SharesPanel";
import { cn } from "@/lib/cn";
import { composeCollectionShareCopy } from "@/lib/clipboard";

export function CollectionsPanel({
  tripId,
  assets,
}: {
  tripId: number;
  assets: Asset[];
}) {
  const [list, setList] = useState<Collection[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Collection | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [shareInfo, setShareInfo] = useState<{ created: ShareCreated; title: string } | null>(null);
  const [sharingID, setSharingID] = useState<number | null>(null);
  const [deletingID, setDeletingID] = useState<number | null>(null);

  async function reload() {
    setList(await api.listCollections(tripId));
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  async function startEdit(c: Collection) {
    setEditLoading(true);
    try {
      const full = await api.getCollection(c.id);
      setEditing(full);
      setCreating(false);
    } finally {
      setEditLoading(false);
    }
  }

  if (!list) return <p className="text-sm text-zinc-500">加载圈选…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">圈选相册</h2>
          <p className="text-xs text-zinc-500">
            从相册里挑出一组照片单独分享，统计 / 撤销与 trip 分享一致
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setCreating((v) => !v);
            setEditing(null);
          }}
        >
          {creating ? "取消" : "新建圈选"}
        </Button>
      </div>

      {creating && (
        <CollectionForm
          tripId={tripId}
          assets={assets}
          onDone={() => {
            setCreating(false);
            reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {editing && (
        <CollectionForm
          tripId={tripId}
          assets={assets}
          initial={editing}
          onDone={() => {
            setEditing(null);
            reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {shareInfo && (
        <CreatedShareCard
          created={shareInfo.created}
          composeMessage={(link) => composeCollectionShareCopy(shareInfo.title, link)}
          onClose={() => setShareInfo(null)}
        />
      )}

      {list.length === 0 ? (
        <p className="text-sm text-zinc-500">还没有圈选</p>
      ) : (
        <ul className="space-y-2">
          {list.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.title} <Badge>{c.asset_count} 张</Badge>
                </p>
                {c.description && <p className="text-xs text-zinc-500">{c.description}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={editLoading && editing?.id === c.id}
                  onClick={() => startEdit(c)}
                >
                  {editLoading && editing?.id === c.id ? "…" : "编辑"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={sharingID === c.id}
                  onClick={async () => {
                    setSharingID(c.id);
                    try {
                      const info = await api.createCollectionShare(c.id, {});
                      setShareInfo({ created: info, title: c.title });
                    } finally {
                      setSharingID(null);
                    }
                  }}
                >
                  {sharingID === c.id ? "生成中…" : "生成分享"}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={deletingID === c.id}
                  onClick={async () => {
                    if (!window.confirm(`删除圈选「${c.title}」？`)) return;
                    setDeletingID(c.id);
                    try {
                      await api.deleteCollection(c.id);
                      await reload();
                    } finally {
                      setDeletingID(null);
                    }
                  }}
                >
                  {deletingID === c.id ? "…" : "删除"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CollectionForm({
  tripId,
  assets,
  initial,
  onDone,
  onCancel,
}: {
  tripId: number;
  assets: Asset[];
  initial?: Collection;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initial?.asset_ids ?? []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initial;

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
      if (isEdit && initial) {
        await api.updateCollection(initial.id, { title, description });
        await api.setCollectionAssets(initial.id, Array.from(selected));
      } else {
        await api.createCollection(tripId, {
          title,
          description,
          asset_ids: Array.from(selected),
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>标题</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="精选" />
        </div>
        <div>
          <Label>描述</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="（可选）"
          />
        </div>
      </div>
      <div>
        <Label>
          选择资源（点击切换） · 已选 {selected.size} 张
        </Label>
        <ul className="grid max-h-64 grid-cols-4 gap-1.5 overflow-auto rounded-md border border-zinc-200 p-1.5 sm:grid-cols-6 md:grid-cols-8 dark:border-zinc-800">
          {assets.map((a) => (
            <li
              key={a.id}
              onClick={() => toggle(a.id)}
              className={cn(
                "relative aspect-square cursor-pointer overflow-hidden rounded",
                selected.has(a.id)
                  ? "ring-2 ring-emerald-500"
                  : "ring-1 ring-zinc-200 dark:ring-zinc-800",
              )}
            >
              <PicturePreview
                urls={a.kind === "video" ? a.urls.video_cover : a.urls.thumb}
                className="h-full w-full object-cover"
              />
              {selected.has(a.id) && (
                <span className="absolute right-1 top-1 rounded-full bg-emerald-500 px-1.5 text-xs text-white">
                  ✓
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !title || selected.size === 0}
          onClick={submit}
        >
          {busy ? (isEdit ? "保存中…" : "创建中…") : isEdit ? `保存（${selected.size} 张）` : `创建（${selected.size} 张）`}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          取消
        </Button>
      </div>
    </Card>
  );
}
