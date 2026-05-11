import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type Trip } from "@/lib/api";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { PicturePreview } from "@/components/PicturePreview";
import { MultiShareDialog } from "@/components/MultiShareDialog";

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
        <div className="space-y-5">
          {trips.map((t) => (
            <Link key={t.id} to={`/admin/trips/${t.id}`} className="block">
              <Card className="overflow-hidden transition hover:shadow-lg">
                <div className="relative aspect-[16/9] bg-zinc-100 sm:aspect-[21/9] dark:bg-zinc-900">
                  <PicturePreview
                    urls={t.cover_url}
                    className="h-full w-full object-cover"
                    loading="eager"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4 text-white sm:p-5">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-black/40 px-2 py-0.5">{t.slug}</span>
                      {t.location && <span>📍 {t.location}</span>}
                      <span className="text-white/70">
                        {new Date(t.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <h2 className="text-xl font-semibold drop-shadow-md sm:text-2xl">
                      {t.title}
                    </h2>
                    {t.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-white/85 sm:text-sm">
                        {t.description}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {showMulti && (
        <MultiShareDialog trips={trips} onClose={() => setShowMulti(false)} />
      )}
    </div>
  );
}

function CreateTripForm({ onCreated }: { onCreated: () => void }) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createTrip({ slug, title, description, location });
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
        <div className="sm:col-span-2">
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
