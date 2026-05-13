import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AuditTripRow } from "@/lib/api";
import { Card } from "@/components/ui";

export function TripsTab() {
  const nav = useNavigate();
  const [rows, setRows] = useState<AuditTripRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .auditTrips()
      .then((r) => {
        if (!cancelled) setRows(r.trips);
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
  }, []);

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2.5 font-medium">相册</th>
              <th className="px-4 py-2.5 font-medium text-right">分享数</th>
              <th className="px-4 py-2.5 font-medium text-right">总访问</th>
              <th className="px-4 py-2.5 font-medium text-right">独立访客</th>
              <th className="px-4 py-2.5 font-medium">最近访问</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-12 text-center text-sm text-zinc-500"
                >
                  {loading ? "加载中…" : "暂无相册"}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.trip_id}
                  className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
                  onClick={() => nav(`/admin/audit/trip/${r.trip_id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="max-w-[260px] truncate"
                        title={r.title}
                      >
                        {r.title || "(未命名)"}
                      </span>
                      <span className="text-xs text-zinc-500">#{r.trip_id}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.share_count}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.total_visits}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.unique_visitors}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                    {r.last_visit_at
                      ? new Date(r.last_visit_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
