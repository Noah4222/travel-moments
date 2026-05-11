import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Comment } from "@/lib/api";
import { Button, Input } from "./ui";

const NAME_KEY = "tm.display_name";

function randomGuestName() {
  const n = Math.floor(Math.random() * 9000) + 1000;
  return `游客${n}`;
}

function getOrInitName() {
  let s = localStorage.getItem(NAME_KEY) || "";
  if (!s) {
    s = randomGuestName();
    localStorage.setItem(NAME_KEY, s);
  }
  return s;
}

export function CommentBox({
  targetType,
  targetID,
  videoTimeMs,
}: {
  targetType: "trip" | "asset";
  targetID: number;
  videoTimeMs?: () => number | undefined;
}) {
  const [items, setItems] = useState<Comment[]>([]);
  const [name, setName] = useState(getOrInitName);
  const [editingName, setEditingName] = useState(false);
  const [pendingName, setPendingName] = useState(name);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [items],
  );

  async function reload() {
    try {
      setItems(await api.publicListComments(targetType, targetID));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, targetID]);

  function saveName() {
    const v = pendingName.trim() || randomGuestName();
    localStorage.setItem(NAME_KEY, v);
    setName(v);
    setEditingName(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = text.trim();
      if (!trimmed) return;
      const t = videoTimeMs?.();
      const created = await api.publicPostComment({
        target_type: targetType,
        target_id: targetID,
        display_name: name,
        content: trimmed,
        video_time_ms: t != null ? Math.round(t) : undefined,
      });
      setItems((cur) => [...cur, created]);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {sorted.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {sorted.map((c) => (
            <li key={c.id} className="rounded bg-zinc-100 px-3 py-1.5 dark:bg-zinc-900">
              <span className="font-medium">{c.display_name}</span>
              {c.video_time_ms != null && (
                <span className="ml-2 text-xs text-zinc-500">
                  ⏱ {(c.video_time_ms / 1000).toFixed(1)}s
                </span>
              )}
              <span className="ml-2 text-zinc-700 dark:text-zinc-300">{c.content}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between text-xs text-zinc-500">
        {editingName ? (
          <span className="flex items-center gap-2">
            <Input
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              maxLength={40}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              className="h-7 w-32 text-sm"
            />
            <Button size="sm" onClick={saveName}>保存</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPendingName(name);
                setEditingName(false);
              }}
            >
              取消
            </Button>
          </span>
        ) : (
          <span>
            以 <b className="text-zinc-700 dark:text-zinc-300">{name}</b> 的身份发送
            <button
              className="ml-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              onClick={() => {
                setPendingName(name);
                setEditingName(true);
              }}
            >
              改名
            </button>
          </span>
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={videoTimeMs ? "发送弹幕…" : "留言…"}
          maxLength={200}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {busy ? "…" : "发送"}
        </Button>
      </form>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
