import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Asset, type Trip, type User } from "@/lib/api";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { UploadDropzone } from "@/components/UploadDropzone";
import { AssetGrid } from "@/components/AssetGrid";
import { SharesPanel } from "@/components/SharesPanel";
import { CollectionsPanel } from "@/components/CollectionsPanel";
import { CommentsPanel } from "@/components/CommentsPanel";
import { UploadGrantsPanel } from "@/components/UploadGrantsPanel";

type NavigateFn = (to: string) => void;

type EditableTextProps = {
  /** Current persisted value. */
  value: string;
  /** Whether the pencil icon is rendered (and clicking enters edit mode). */
  editable: boolean;
  /** Save handler — should resolve when the value is persisted server-side. */
  onSave: (v: string) => Promise<void>;
  /** Label shown when the persisted value is empty (e.g. "未设置"). */
  placeholder?: string;
  /** Visible-mode wrapper className. Display widget renders inside. */
  wrapperClassName?: string;
  /** Display-mode text className. */
  textClassName?: string;
  /** Aria/title for the pencil button. */
  ariaLabel?: string;
  /** Single-line uses <Input>; multiline uses <Textarea>. */
  multiline?: boolean;
  /** If true, an empty value rejects save (used for required fields like title). */
  required?: boolean;
  /** Max characters. */
  maxLength?: number;
  /** Renders the display-mode text — useful for prefixes like "📍 ". */
  renderDisplay?: (value: string) => React.ReactNode;
};

function EditableText({
  value,
  editable,
  onSave,
  placeholder = "未设置",
  wrapperClassName,
  textClassName,
  ariaLabel = "编辑",
  multiline,
  required,
  maxLength,
  renderDisplay,
}: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function start() {
    setDraft(value);
    setEditing(true);
    setTimeout(() => {
      const el = multiline ? taRef.current : inputRef.current;
      el?.focus();
      el?.select?.();
    }, 0);
  }

  async function commit() {
    const next = draft.trim();
    if (next === value) {
      setEditing(false);
      return;
    }
    if (required && !next) return;
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      alert("保存失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && multiline && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  }

  if (editing) {
    return (
      <div className={cn("flex flex-wrap items-start gap-2", wrapperClassName)}>
        {multiline ? (
          <Textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            maxLength={maxLength}
            rows={3}
            className={cn("min-w-0 flex-1", textClassName)}
          />
        ) : (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            maxLength={maxLength}
            className={cn("min-w-0 flex-1 !h-auto", textClassName)}
          />
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={commit}
            disabled={busy || (required && !draft.trim())}
          >
            {busy ? "保存中…" : "保存"}
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>
            取消
          </Button>
        </div>
      </div>
    );
  }

  const isEmpty = !value;
  return (
    <div className={cn("flex flex-wrap items-start gap-2", wrapperClassName)}>
      <span
        className={cn(
          "min-w-0 break-words",
          textClassName,
          isEmpty && "italic text-zinc-400",
        )}
      >
        {isEmpty ? placeholder : renderDisplay ? renderDisplay(value) : value}
      </span>
      {editable && (
        <button
          type="button"
          onClick={start}
          className="mt-1 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label={ariaLabel}
          title={ariaLabel}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
    </div>
  );
}

function AdminTripActions({
  trip,
  tripId,
  onChanged,
  navigate,
}: {
  trip: Trip;
  tripId: number;
  onChanged: () => void;
  navigate: NavigateFn;
}) {
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="flex flex-col items-end gap-2">
      <label className="flex items-center gap-2 text-xs text-zinc-500">
        <input
          type="checkbox"
          disabled={toggling}
          checked={!!trip.show_view_counts}
          onChange={async (e) => {
            setToggling(true);
            try {
              await api.updateTrip(tripId, {
                show_view_counts: e.target.checked,
              } as Partial<Trip>);
              await onChanged();
            } finally {
              setToggling(false);
            }
          }}
        />
        访客可见访问次数 {toggling && "…"}
      </label>
      <Button
        variant="danger"
        disabled={deleting}
        onClick={async () => {
          if (!window.confirm(`删除 ${trip.title}？此操作不可恢复`)) return;
          setDeleting(true);
          try {
            await api.deleteTrip(tripId);
            navigate("/admin");
          } finally {
            setDeleting(false);
          }
        }}
      >
        {deleting ? "删除中…" : "删除旅程"}
      </Button>
    </div>
  );
}

export function TripDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const tripId = Number(id);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [t, as] = await Promise.all([
        api.getTrip(tripId),
        api.listAssets(tripId),
      ]);
      setTrip(t);
      setAssets(as);
      if (user?.role === "admin") {
        setUsers(await api.listUsers());
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function reloadAssets() {
    try {
      setAssets(await api.listAssets(tripId));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!trip) return <p className="text-zinc-500">加载中…</p>;

  const editorIds = new Set(trip.editor_user_ids ?? []);
  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Badge>{trip.slug}</Badge>
          <EditableText
            value={trip.title}
            editable={isAdmin}
            required
            maxLength={200}
            ariaLabel="编辑标题"
            wrapperClassName="mt-2"
            textClassName="text-2xl font-semibold sm:text-3xl"
            onSave={async (v) => {
              await api.updateTrip(tripId, { title: v });
              await reload();
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-500">
            <span className="flex items-center gap-1.5">
              📅
              {isAdmin ? (
                <input
                  type="date"
                  defaultValue={trip.started_at ? trip.started_at.slice(0, 10) : ""}
                  onBlur={async (e) => {
                    const v = e.target.value;
                    await api.updateTrip(tripId, {
                      started_at: v ? new Date(v + "T00:00:00").toISOString() : undefined,
                    });
                    await reload();
                  }}
                  className="rounded border border-zinc-300 bg-transparent px-2 py-0.5 text-sm dark:border-zinc-700"
                />
              ) : (
                <span>
                  {trip.started_at
                    ? new Date(trip.started_at).toLocaleDateString()
                    : "未设置"}
                </span>
              )}
            </span>
            <EditableText
              value={trip.location ?? ""}
              editable={isAdmin}
              maxLength={200}
              placeholder="未填地点"
              ariaLabel="编辑地点"
              textClassName="text-sm"
              renderDisplay={(v) => <>📍 {v}</>}
              onSave={async (v) => {
                await api.updateTrip(tripId, { location: v });
                await reload();
              }}
            />
          </div>
          <div className="mt-3 max-w-2xl">
            <EditableText
              value={trip.description ?? ""}
              editable={isAdmin}
              multiline
              maxLength={2000}
              placeholder="还没有描述。点 ✎ 写一段。"
              ariaLabel="编辑描述"
              textClassName="text-sm text-zinc-600 sm:text-base dark:text-zinc-400"
              onSave={async (v) => {
                await api.updateTrip(tripId, { description: v });
                await reload();
              }}
            />
          </div>
        </div>
        <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/admin/trips/${tripId}/preview`)}
          >
            浏览相册 →
          </Button>
          {isAdmin && (
            <AdminTripActions
              trip={trip}
              tripId={tripId}
              onChanged={reload}
              navigate={navigate}
            />
          )}
        </div>
      </div>

      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            照片 / 视频
            <span className="ml-2 text-sm font-normal text-zinc-500">
              （{assets.length}）
            </span>
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAssetsOpen((v) => !v)}
          >
            {assetsOpen ? "折叠" : "展开"}
          </Button>
        </div>
        {assetsOpen && (
          <>
            <div className="mb-6">
              <UploadDropzone tripId={tripId} onUploaded={reloadAssets} />
            </div>
            <AssetGrid
              assets={assets}
              isAdmin={isAdmin}
              coverAssetID={trip.cover_asset_id ?? undefined}
              onClick={(a) => navigate(`/admin/trips/${tripId}/preview?asset=${a.id}`)}
              onDelete={async (a) => {
                await api.deleteAsset(a.id);
                await reloadAssets();
              }}
              onCoverChange={reload}
            />
          </>
        )}
      </Card>

      <Card className="p-6">
        <CollectionsPanel tripId={tripId} assets={assets} />
      </Card>

      <Card className="p-6">
        <SharesPanel tripId={tripId} tripTitle={trip.title} />
      </Card>

      {isAdmin && (
        <Card className="p-6">
          <UploadGrantsPanel tripId={tripId} tripTitle={trip.title} />
        </Card>
      )}

      {isAdmin && (
        <Card className="p-6">
          <CommentsPanel tripId={tripId} />
        </Card>
      )}

      {isAdmin && users && (
        <Card className="p-6">
          <h2 className="mb-3 text-lg font-semibold">Editor 授权</h2>
          <p className="mb-4 text-sm text-zinc-500">
            勾选可上传到本旅程的 editor。admin 默认拥有所有权限。
          </p>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {users
              .filter((u) => u.role === "editor")
              .map((u) => {
                const has = editorIds.has(u.id);
                return (
                  <li key={u.id} className="flex items-center justify-between py-2">
                    <span className="text-sm">{u.username}</span>
                    <Button
                      size="sm"
                      variant={has ? "outline" : "primary"}
                      onClick={async () => {
                        if (has) await api.removeEditor(tripId, u.id);
                        else await api.addEditor(tripId, u.id);
                        reload();
                      }}
                    >
                      {has ? "取消授权" : "授权"}
                    </Button>
                  </li>
                );
              })}
            {users.filter((u) => u.role === "editor").length === 0 && (
              <p className="text-sm text-zinc-500">没有 editor 账号，先到「用户」页面创建。</p>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}
