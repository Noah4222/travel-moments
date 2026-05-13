import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AuditShareRow } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";
import { StatsModal } from "@/components/share/StatsModal";
import { ShareTreePanel } from "@/components/share/ShareTreePanel";

type Status = "active" | "expired" | "revoked" | "all";
type Order = "recent_visit" | "visits" | "created";

export function SharesTab() {
  const nav = useNavigate();
  const [rows, setRows] = useState<AuditShareRow[]>([]);
  const [status, setStatus] = useState<Status>("active");
  const [order, setOrder] = useState<Order>("recent_visit");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statsFor, setStatsFor] = useState<number | null>(null);
  const [treeFor, setTreeFor] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .auditShares({ status, order, q: debouncedQ || undefined })
      .then((r) => {
        if (!cancelled) setRows(r.shares);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, order, debouncedQ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label>状态</Label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="active">活跃</option>
            <option value="expired">已过期</option>
            <option value="revoked">已撤销</option>
            <option value="all">全部</option>
          </select>
        </div>
        <div>
          <Label>排序</Label>
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value as Order)}
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="recent_visit">最近访问</option>
            <option value="visits">访问次数</option>
            <option value="created">创建时间</option>
          </select>
        </div>
        <div>
          <Label>搜索</Label>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按 code 或备注搜索"
          />
        </div>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 font-medium">Trip</th>
              <th className="px-4 py-2.5 font-medium text-right">访问</th>
              <th className="px-4 py-2.5 font-medium text-right">独立 IP</th>
              <th className="px-4 py-2.5 font-medium text-right">子分享</th>
              <th className="px-4 py-2.5 font-medium">最近访问</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-zinc-500"
                >
                  {loading ? "加载中…" : "暂无分享"}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs">{r.code}</span>
                      {r.note && (
                        <span
                          className="max-w-[200px] truncate text-xs text-zinc-500"
                          title={r.note}
                        >
                          {r.note}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="max-w-[200px] truncate"
                        title={r.trip_title}
                      >
                        {r.trip_title || "(未命名)"}
                      </span>
                      <span className="text-xs text-zinc-500">#{r.trip_id}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.visits}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.unique_ips}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.child_count}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                    {r.last_visit_at
                      ? new Date(r.last_visit_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill row={r} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatsFor(r.id)}
                      >
                        统计
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setTreeFor(r.id)}
                      >
                        转发树
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => nav(`/admin/trips/${r.trip_id}`)}
                      >
                        Trip
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {statsFor !== null && (
        <StatsModal id={statsFor} onClose={() => setStatsFor(null)} />
      )}
      {treeFor !== null && (
        <ShareTreePanel id={treeFor} onClose={() => setTreeFor(null)} />
      )}
    </div>
  );
}

function StatusPill({ row }: { row: AuditShareRow }) {
  const now = Date.now();
  let label = "活跃";
  let cls =
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (row.revoked_at) {
    label = "撤销";
    cls = "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
  } else if (row.expires_at && new Date(row.expires_at).getTime() < now) {
    label = "过期";
    cls = "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
