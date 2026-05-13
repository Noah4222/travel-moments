import { useEffect, useState } from "react";
import { api, type AuditEvent } from "@/lib/api";
import { Badge, Button, Card, Input, Label } from "@/components/ui";

export function EventsTab() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [beforeID, setBeforeID] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tripID, setTripID] = useState("");
  const [ip, setIP] = useState("");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  async function load(reset: boolean, cursor?: { before: string | null; beforeID: number | null }) {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.auditEvents({
        before: reset ? undefined : cursor?.before ?? undefined,
        beforeID: reset ? undefined : cursor?.beforeID ?? undefined,
        tripID: tripID ? Number(tripID) : undefined,
        ip: ip || undefined,
        limit: 50,
      });
      setEvents((prev) => (reset ? resp.events : [...prev, ...resp.events]));
      setBefore(resp.next_before);
      setBeforeID(resp.next_before_id);
      setDone(resp.next_before === null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setEvents([]);
    setBefore(null);
    setBeforeID(null);
    setDone(false);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripID, ip]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label>Trip ID</Label>
          <Input
            inputMode="numeric"
            value={tripID}
            onChange={(e) => setTripID(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="例如 12"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>IP</Label>
          <Input
            value={ip}
            onChange={(e) => setIP(e.target.value)}
            placeholder="精确匹配，例如 1.2.3.4"
          />
        </div>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2.5 font-medium">时间</th>
              <th className="px-4 py-2.5 font-medium">Trip</th>
              <th className="px-4 py-2.5 font-medium">Share</th>
              <th className="px-4 py-2.5 font-medium">IP</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">国家</th>
              <th className="px-4 py-2.5 font-medium text-right">浏览</th>
              <th className="px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-zinc-500"
                >
                  暂无访问
                </td>
              </tr>
            ) : (
              events.map((ev) => (
                <Row
                  key={ev.visit_id}
                  ev={ev}
                  onClick={() => setSelected(ev)}
                />
              ))
            )}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-center pt-1">
        {done ? (
          <span className="text-xs text-zinc-500">已到底</span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void load(false, { before, beforeID })}
          >
            {loading ? "加载中…" : "加载更多"}
          </Button>
        )}
      </div>

      {selected && (
        <Drawer ev={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function Row({ ev, onClick }: { ev: AuditEvent; onClick: () => void }) {
  return (
    <tr
      className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
      onClick={onClick}
    >
      <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
        {new Date(ev.visited_at).toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="truncate max-w-[200px]" title={ev.trip_title}>
            {ev.trip_title || "(未命名)"}
          </span>
          <span className="text-xs text-zinc-500">#{ev.trip_id}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">{ev.share_code}</span>
          <span className="text-xs text-zinc-500">#{ev.share_id}</span>
          {ev.is_share_creator && <Badge tone="warning">转发者</Badge>}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-xs">{ev.ip}</td>
      <td className="hidden px-4 py-3 text-zinc-500 md:table-cell">
        {ev.country || "—"}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {ev.asset_view_count}
      </td>
      <td className="px-4 py-3 text-right text-xs text-zinc-400">›</td>
    </tr>
  );
}

function Drawer({ ev, onClose }: { ev: AuditEvent; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="w-full max-w-md overflow-y-auto border-l border-zinc-200 bg-white p-5 shadow-2xl sm:max-w-lg dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">访问详情</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
        <dl className="space-y-3 text-sm">
          <Field label="时间">
            {new Date(ev.visited_at).toLocaleString()}
          </Field>
          <Field label="Trip">
            <span>{ev.trip_title || "(未命名)"}</span>
            <span className="ml-2 text-xs text-zinc-500">#{ev.trip_id}</span>
          </Field>
          <Field label="Share">
            <span className="font-mono text-xs">{ev.share_code}</span>
            <span className="ml-2 text-xs text-zinc-500">#{ev.share_id}</span>
          </Field>
          <Field label="IP">
            <span className="font-mono text-xs">{ev.ip}</span>
          </Field>
          <Field label="国家">{ev.country || "—"}</Field>
          <Field label="资源浏览数">
            <span className="tabular-nums">{ev.asset_view_count}</span>
          </Field>
          <Field label="转发?">
            {ev.is_share_creator ? (
              <Badge tone="warning">是（这次访问随后创建了转发分享）</Badge>
            ) : (
              <span className="text-zinc-500">否</span>
            )}
          </Field>
          <Field label="Referer">
            <span className="font-mono text-xs break-all">
              {ev.referer || "(直接访问)"}
            </span>
          </Field>
          <Field label="UA">
            <span className="font-mono text-xs break-all">{ev.ua || "—"}</span>
          </Field>
        </dl>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-3">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
  );
}
