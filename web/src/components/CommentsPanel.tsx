import { useEffect, useState } from "react";
import { api, type Comment } from "@/lib/api";
import { Badge, Button, Card } from "./ui";

export function CommentsPanel({ tripId }: { tripId: number }) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [includeHidden, setIncludeHidden] = useState(true);
  const [busyID, setBusyID] = useState<number | null>(null);

  async function reload() {
    setList(await api.adminListComments(tripId, includeHidden));
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, includeHidden]);

  if (!list) return <p className="text-sm text-zinc-500">加载评论…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">评论 / 弹幕</h2>
          <p className="text-xs text-zinc-500">访客留言；隐藏后访客看不见，admin 仍可恢复</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={includeHidden}
            onChange={(e) => setIncludeHidden(e.target.checked)}
          />
          含已隐藏
        </label>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-zinc-500">暂无评论</p>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {list.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.display_name}</span>
                    <Badge tone={c.target_type === "trip" ? "neutral" : "warning"}>
                      {c.target_type === "trip" ? "Trip" : `Asset #${c.target_id}`}
                    </Badge>
                    {c.video_time_ms != null && (
                      <Badge tone="neutral">⏱ {(c.video_time_ms / 1000).toFixed(1)}s</Badge>
                    )}
                    {c.hidden_at && <Badge tone="danger">已隐藏</Badge>}
                  </div>
                  <p className="mt-1 break-words">{c.content}</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {new Date(c.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-1.5 pt-1">
                  {c.hidden_at ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyID === c.id}
                      onClick={async () => {
                        setBusyID(c.id);
                        try {
                          await api.adminUnhideComment(c.id);
                          await reload();
                        } finally {
                          setBusyID(null);
                        }
                      }}
                    >
                      {busyID === c.id ? "…" : "恢复"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyID === c.id}
                        onClick={async () => {
                          const next = window.prompt("修改内容", c.content);
                          if (next == null) return;
                          setBusyID(c.id);
                          try {
                            await api.adminEditComment(c.id, { content: next });
                            await reload();
                          } finally {
                            setBusyID(null);
                          }
                        }}
                      >
                        {busyID === c.id ? "…" : "改"}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busyID === c.id}
                        onClick={async () => {
                          if (!window.confirm("隐藏这条评论？")) return;
                          setBusyID(c.id);
                          try {
                            await api.adminHideComment(c.id);
                            await reload();
                          } finally {
                            setBusyID(null);
                          }
                        }}
                      >
                        {busyID === c.id ? "…" : "隐藏"}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
