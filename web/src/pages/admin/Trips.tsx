import { useEffect, useState, type FormEvent } from "react";
import { api, type Trip } from "@/lib/api";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { MultiShareDialog } from "@/components/MultiShareDialog";
import { AdminTripsThemed } from "@/themes/admin/AdminTripsThemed";

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
        <AdminTripsThemed trips={trips} />
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
