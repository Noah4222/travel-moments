import { useEffect, useState } from "react";
import { api, type UploadGrant, type UploadGrantCreated } from "@/lib/api";
import { Badge, Button, Card, Input, Label } from "./ui";

const TTL_OPTIONS = [
  { label: "24 小时", hours: 24 },
  { label: "3 天", hours: 24 * 3 },
  { label: "7 天", hours: 24 * 7 },
  { label: "30 天", hours: 24 * 30 },
];

export function UploadGrantsPanel({ tripId }: { tripId: number }) {
  const [list, setList] = useState<UploadGrant[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<UploadGrantCreated | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [hours, setHours] = useState(24);

  async function reload() {
    try {
      setList(await api.listUploadGrants(tripId));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  async function submit() {
    setBusy(true);
    try {
      const c = await api.createUploadGrant(tripId, {
        note: note || undefined,
        hours_ttl: hours,
      });
      setCreated(c);
      setNote("");
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">一次性上传链接</h2>
          <p className="text-xs text-zinc-500">
            把链接发给可信的朋友，第一次打开后链接消耗、密钥失效；页面停留期间仍可上传
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          {creating ? "取消" : "生成新链接"}
        </Button>
      </div>

      {creating && (
        <Card className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>备注（可选）</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：给小王" />
            </div>
            <div>
              <Label>有效期</Label>
              <select
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                {TTL_OPTIONS.map((o) => (
                  <option key={o.hours} value={o.hours}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <Button onClick={submit} disabled={busy}>
            {busy ? "生成中…" : "生成链接"}
          </Button>
        </Card>
      )}

      {created && <CreatedGrantCard created={created} onClose={() => setCreated(null)} />}

      {!list ? (
        <p className="text-sm text-zinc-500">加载链接…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-zinc-500">还没有上传链接</p>
      ) : (
        <ul className="space-y-2">
          {list.map((g) => {
            const status = grantStatus(g);
            return (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-zinc-500">{g.code}</p>
                  {g.note && <p className="text-sm">{g.note}</p>}
                  <p className="mt-1 text-xs text-zinc-500">
                    {statusLabel(status)} · 到期 {new Date(g.expires_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
                  {status === "ready" && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={revoking === g.id}
                      onClick={async () => {
                        if (!window.confirm("撤销该链接？")) return;
                        setRevoking(g.id);
                        try {
                          await api.revokeUploadGrant(g.id);
                          await reload();
                        } finally {
                          setRevoking(null);
                        }
                      }}
                    >
                      {revoking === g.id ? "…" : "撤销"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CreatedGrantCard({
  created,
  onClose,
}: {
  created: UploadGrantCreated;
  onClose: () => void;
}) {
  const url = `${window.location.origin}${created.url}#${encodeURIComponent(created.token)}`;
  return (
    <Card className="space-y-2 border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
      <p className="font-medium text-emerald-700 dark:text-emerald-300">
        ✓ 链接已生成（密钥在 # 后，只能用一次）
      </p>
      <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      <p className="text-xs text-zinc-500">
        到期：{new Date(created.expires_at).toLocaleString()}
      </p>
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(url)}
        >
          复制链接
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
      </div>
    </Card>
  );
}

function grantStatus(g: UploadGrant): string {
  if (g.revoked_at) return "revoked";
  if (g.consumed_at) return "consumed";
  if (new Date(g.expires_at).getTime() < Date.now()) return "expired";
  return "ready";
}

function statusLabel(s: string): string {
  switch (s) {
    case "ready":
      return "可用";
    case "consumed":
      return "已使用";
    case "expired":
      return "已过期";
    case "revoked":
      return "已撤销";
  }
  return s;
}

function statusTone(s: string): "success" | "neutral" | "danger" | "warning" {
  switch (s) {
    case "ready":
      return "success";
    case "consumed":
      return "neutral";
    case "expired":
      return "warning";
    case "revoked":
      return "danger";
  }
  return "neutral";
}
