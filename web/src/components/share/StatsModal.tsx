import { useEffect, useState } from "react";
import { api, type ShareStats } from "@/lib/api";
import { Button, Card } from "@/components/ui";

export function StatsModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [stats, setStats] = useState<ShareStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .shareStats(id)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);
  // Defensive: older / pre-fix backends could return null for these arrays.
  const visits = stats?.recent_visits ?? [];
  const top = stats?.top_assets ?? [];
  return (
    <Modal onClose={onClose} title="分享统计">
      {error ? (
        <p className="text-rose-600 text-sm">加载失败：{error}</p>
      ) : !stats ? (
        <p className="text-zinc-500">加载中…</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-4 gap-3 text-center">
            <Stat label="访问次数" value={stats.visits ?? 0} />
            <Stat label="独立 IP" value={stats.unique_ips ?? 0} />
            <Stat label="资源访问" value={stats.asset_views ?? 0} />
            <Stat label="子分享数" value={stats.child_share_count ?? 0} />
          </div>
          <div>
            <h3 className="mb-2 font-medium">最近访问</h3>
            <ul className="max-h-60 space-y-1 overflow-auto rounded border border-zinc-200 p-2 text-xs dark:border-zinc-800">
              {visits.map((v) => (
                <li key={v.id} className="font-mono">
                  {new Date(v.visited_at).toLocaleString()} · {v.ip || "?"} ·{" "}
                  <span className="text-zinc-500">{(v.ua || "").slice(0, 60)}</span>
                </li>
              ))}
              {visits.length === 0 && (
                <li className="text-zinc-500">暂无访问</li>
              )}
            </ul>
          </div>
          {top.length > 0 && (
            <div>
              <h3 className="mb-2 font-medium">热门资源</h3>
              <ul className="text-xs">
                {top.map((t) => (
                  <li key={t.asset_id}>
                    资源 #{t.asset_id} — {t.views} 次
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <Card
        className="w-full max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
        {children}
      </Card>
    </div>
  );
}
