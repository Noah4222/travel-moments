import { useEffect, useState } from "react";
import { api, type Share, type ShareCreated } from "@/lib/api";
import { Badge, Button, Card, Input, Label } from "./ui";
import { useAuth } from "@/lib/auth";
import { copyText, composeTripShareCopy } from "@/lib/clipboard";
import { StatsModal } from "@/components/share/StatsModal";
import { ShareTreePanel } from "@/components/share/ShareTreePanel";

export function SharesPanel({
  tripId,
  tripTitle,
}: {
  tripId: number;
  tripTitle?: string;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [shares, setShares] = useState<Share[] | null>(null);
  const [created, setCreated] = useState<ShareCreated | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [statsFor, setStatsFor] = useState<number | null>(null);
  const [treeFor, setTreeFor] = useState<number | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  async function reload() {
    setShares(await api.listShares(tripId));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  if (!shares) return <p className="text-sm text-zinc-500">加载分享…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">分享</h2>
          <p className="text-xs text-zinc-500">每个分享生成独立密码，可单独撤销</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "取消" : "新建分享"}
        </Button>
      </div>

      {showCreate && (
        <CreateShareForm
          tripId={tripId}
          onCreated={(c) => {
            setCreated(c);
            setShowCreate(false);
            reload();
          }}
        />
      )}

      {created && (
        <CreatedShareCard
          created={created}
          onClose={() => setCreated(null)}
          composeMessage={
            tripTitle
              ? (link) => composeTripShareCopy(tripTitle, link)
              : undefined
          }
        />
      )}

      {shares.length === 0 ? (
        <Card className="p-6 text-center text-sm text-zinc-500">还没有分享</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">备注</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">创建时间</th>
                <th className="px-3 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                >
                  <td className="px-3 py-2 font-mono">{s.code}</td>
                  <td className="px-3 py-2 text-zinc-500">{s.note || "—"}</td>
                  <td className="px-3 py-2">
                    {s.revoked_at ? (
                      <Badge tone="danger">已撤销</Badge>
                    ) : s.parent_share_id ? (
                      <Badge tone="warning">转发</Badge>
                    ) : (
                      <Badge tone="success">活跃</Badge>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-xs text-zinc-500 sm:table-cell">
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      {isAdmin && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setStatsFor(s.id)}>
                            统计
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setTreeFor(s.id)}>
                            传播树
                          </Button>
                        </>
                      )}
                      {!s.revoked_at && (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={revoking === s.id}
                          onClick={async () => {
                            if (!window.confirm("撤销这个分享？")) return;
                            const cascade = window.confirm(
                              "同时撤销所有由它派生的子分享？\n点确定 = 是；点取消 = 仅撤销此分享",
                            );
                            setRevoking(s.id);
                            try {
                              await api.revokeShare(s.id, cascade);
                              await reload();
                            } finally {
                              setRevoking(null);
                            }
                          }}
                        >
                          {revoking === s.id ? "撤销中…" : "撤销"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {statsFor && <StatsModal id={statsFor} onClose={() => setStatsFor(null)} />}
      {treeFor && <ShareTreePanel id={treeFor} onClose={() => setTreeFor(null)} />}
    </div>
  );
}

export function CreatedShareCard({
  created,
  onClose,
  composeMessage,
}: {
  created: ShareCreated;
  onClose?: () => void;
  /** Build the actual clipboard payload from the full link. Default: link only. */
  composeMessage?: (link: string) => string;
}) {
  const url = `${window.location.origin}${created.url}`;
  const fullURL = created.password
    ? `${url}#${encodeURIComponent(created.password)}`
    : url;
  const clipboard = composeMessage ? composeMessage(fullURL) : fullURL;
  return (
    <Card className="border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
      <p className="mb-2 font-medium text-emerald-700 dark:text-emerald-300">
        ✓ 分享已创建{created.password && "（密码只显示一次）"}
      </p>
      <div className="space-y-2 text-zinc-700 dark:text-zinc-300">
        <div>
          <p className="text-xs text-zinc-500">完整链接（密码隐藏在 # 后）</p>
          <p className="break-all rounded bg-white p-1.5 font-mono text-xs dark:bg-zinc-900">
            {fullURL}
          </p>
        </div>
        {created.password && (
          <p className="text-xs text-zinc-500">
            密码：
            <code className="rounded bg-white px-1 dark:bg-zinc-900">
              {created.password}
            </code>
          </p>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => copyText(clipboard)}>
          复制{composeMessage ? "分享文案" : "完整链接"}
        </Button>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        )}
      </div>
    </Card>
  );
}

const EXPIRY_OPTIONS = [
  { label: "永不过期", hours: 0 },
  { label: "1 小时", hours: 1 },
  { label: "24 小时", hours: 24 },
  { label: "7 天", hours: 24 * 7 },
  { label: "30 天", hours: 24 * 30 },
];

function CreateShareForm({
  tripId,
  onCreated,
}: {
  tripId: number;
  onCreated: (c: ShareCreated) => void;
}) {
  const [note, setNote] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiryHours, setExpiryHours] = useState(0);
  const [disableForward, setDisableForward] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="p-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>备注</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="给谁的" />
        </div>
        <div>
          <Label>最多使用次数（可选）</Label>
          <Input
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="不填 = 不限"
          />
        </div>
        <div>
          <Label>有效时长</Label>
          <select
            value={expiryHours}
            onChange={(e) => setExpiryHours(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={disableForward}
              onChange={(e) => setDisableForward(e.target.checked)}
            />
            禁止访客继续转发
          </label>
        </div>
      </div>
      <div>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const expires_at = expiryHours > 0
                ? new Date(Date.now() + expiryHours * 3600 * 1000).toISOString()
                : undefined;
              const c = await api.createShare(tripId, {
                note: note || undefined,
                max_uses: maxUses ? Number(maxUses) : undefined,
                expires_at,
                disable_forward: disableForward,
              });
              onCreated(c);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "创建中…" : "创建"}
        </Button>
      </div>
    </Card>
  );
}
