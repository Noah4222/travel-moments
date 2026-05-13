import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type AuditTripDetail as TripDetail } from "@/lib/api";
import { Sparkline } from "./Sparkline";

export function TripAuditDetail() {
  const { id } = useParams();
  const [data, setData] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setError(null);
    api
      .auditTripDetail(Number(id))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) return <div className="p-4 text-sm text-rose-600">{error}</div>;
  if (!data) return <div className="p-4 text-sm text-zinc-500">加载中…</div>;

  const totalVisits = data.daily.reduce((s, d) => s + d.visits, 0);
  const peak = data.daily.reduce(
    (m, d) => (d.visits > m.visits ? d : m),
    { date: "", visits: 0, unique_ips: 0 },
  );
  const latestVisit = data.shares
    .map((s) => s.last_visit_at)
    .filter((s): s is string => !!s)
    .sort()
    .pop();
  const latestVisitText = latestVisit
    ? new Date(latestVisit).toISOString().slice(0, 10)
    : "—";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-medium truncate">
          <span className="truncate">{data.trip.title || "(未命名)"}</span>
          <span className="text-zinc-500"> · 访问趋势</span>
        </h1>
        <Link
          to="/admin/audit?tab=trips"
          className="shrink-0 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← 返回
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="90 天访问" value={String(totalVisits)} />
        <StatCard label="分享数" value={String(data.shares.length)} />
        <StatCard
          label="高峰日访问"
          value={String(peak.visits)}
          sub={peak.date || undefined}
        />
        <StatCard label="最近访问" value={latestVisitText} />
      </div>

      <section className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-2 text-sm font-medium text-zinc-500">最近 90 天</h2>
        <Sparkline
          points={data.daily.map((d) => ({ date: d.date, value: d.visits }))}
        />
      </section>

      {data.top_assets.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-500">热门照片</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
            {data.top_assets.map((a) => {
              const src = a.thumb_url?.webp || a.thumb_url?.avif || "";
              return (
                <div key={a.asset_id} className="space-y-1">
                  <div className="aspect-square overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
                    {src ? (
                      <picture>
                        {a.thumb_url?.avif && (
                          <source srcSet={a.thumb_url.avif} type="image/avif" />
                        )}
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </picture>
                    ) : null}
                  </div>
                  <div className="text-center text-xs text-zinc-500 tabular-nums">
                    {a.views} 次
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(data.referers.length > 0 || data.countries.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.referers.length > 0 && (
            <BarList
              title="来源"
              rows={data.referers.map((r) => ({ label: r.host || "(直接)", count: r.count }))}
            />
          )}
          {data.countries.length > 0 && (
            <BarList
              title="地区"
              rows={data.countries.map((c) => ({ label: c.code || "—", count: c.count }))}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500 tabular-nums">{sub}</div>}
    </div>
  );
}

function BarList({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; count: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="mb-3 text-sm font-medium text-zinc-500">{title}</h2>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 tabular-nums text-zinc-500">{r.count}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
              <div
                className="h-full bg-zinc-700 dark:bg-zinc-300"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
