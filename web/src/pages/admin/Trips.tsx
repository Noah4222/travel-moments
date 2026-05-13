import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type Trip } from "@/lib/api";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { PicturePreview } from "@/components/PicturePreview";
import { MultiShareDialog } from "@/components/MultiShareDialog";

type Group = { key: string; year: number; month: number; trips: Trip[] };

function groupByMonth(trips: Trip[]): Group[] {
  const buckets = new Map<string, Group>();
  for (const t of trips) {
    const d = new Date(t.started_at ?? t.created_at);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    let g = buckets.get(key);
    if (!g) {
      g = { key, year, month, trips: [] };
      buckets.set(key, g);
    }
    g.trips.push(t);
  }
  // Backend already orders newest first; sort group keys descending too.
  return Array.from(buckets.values()).sort((a, b) => b.key.localeCompare(a.key));
}

export function TripsPage() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMulti, setShowMulti] = useState(false);

  async function reload() {
    try {
      setTrips(await api.listTrips());
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!trips) return <p className="text-zinc-500">加载中…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">旅程</h1>
          <p className="text-sm text-zinc-500">
            {user?.role === "admin" ? "管理所有旅程" : "你被分配的旅程"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {trips.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowMulti(true)}>
              分享多个相册
            </Button>
          )}
          {user?.role === "admin" && (
            <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? "取消" : "新建旅程"}
            </Button>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateTripForm
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}

      {trips.length === 0 ? (
        <Card className="p-8 text-center text-sm text-zinc-500">还没有旅程</Card>
      ) : (
        <TripsTimeline trips={trips} />
      )}

      {showMulti && (
        <MultiShareDialog trips={trips} onClose={() => setShowMulti(false)} />
      )}
    </div>
  );
}

function TripsTimeline({ trips }: { trips: Trip[] }) {
  const groups = useMemo(() => groupByMonth(trips), [trips]);
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.key} className="space-y-3">
          <div className="sticky top-14 z-10 -mx-3 flex items-baseline gap-3 border-b border-zinc-200 bg-zinc-50/85 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4 dark:border-zinc-800 dark:bg-zinc-950/85">
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
              {g.year} 年 {g.month} 月
            </h2>
            <span className="text-xs text-zinc-500">{g.trips.length} 个相册</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.trips.map((t) => (
              <Link
                key={t.id}
                to={`/admin/trips/${t.id}`}
                className="block"
              >
                <Card className="overflow-hidden [content-visibility:auto] [contain-intrinsic-size:280px] hover:shadow-lg">
                  <div className="relative aspect-[16/9] bg-zinc-100 dark:bg-zinc-900">
                    <PicturePreview
                      urls={t.cover_url}
                      className="h-full w-full object-cover"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-3 text-white sm:p-4">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded bg-black/40 px-2 py-0.5">{t.slug}</span>
                        {t.location && <span>📍 {t.location}</span>}
                        <span className="text-white/85">
                          📅 {new Date(t.started_at ?? t.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold drop-shadow-md sm:text-xl">
                        {t.title}
                      </h3>
                      {t.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-white/85">
                          {t.description}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CreateTripForm({ onCreated }: { onCreated: () => void }) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(""); // YYYY-MM-DD
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createTrip({
        slug,
        title,
        description,
        location,
        started_at: date ? new Date(date + "T00:00:00").toISOString() : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>Slug（URL 标识）</Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="japan-2026"
            required
          />
        </div>
        <div>
          <Label>标题</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="日本 2026 春"
            required
          />
        </div>
        <div>
          <Label>日期</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <Label>地点</Label>
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="东京"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>描述</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="简单描述一下这次旅程"
          />
        </div>
        {error && <p className="sm:col-span-2 text-sm text-rose-600">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "创建中…" : "创建"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
