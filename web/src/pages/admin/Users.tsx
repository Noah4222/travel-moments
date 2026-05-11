import { useEffect, useState, type FormEvent } from "react";
import { api, type User } from "@/lib/api";

import { Badge, Button, Card, Input, Label } from "@/components/ui";

export function UsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function reload() {
    try {
      setUsers(await api.listUsers());
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!users) return <p className="text-zinc-500">加载中…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">用户</h1>
          <p className="text-sm text-zinc-500">管理 admin 与 editor 账号</p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "取消" : "新建用户"}
        </Button>
      </div>

      {showCreate && (
        <CreateUserForm
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2.5 font-medium">用户名</th>
              <th className="px-4 py-2.5 font-medium">角色</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">创建时间</th>
              <th className="px-4 py-2.5 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                <td className="px-4 py-3 font-medium">{u.username}</td>
                <td className="px-4 py-3">
                  <Badge tone={u.role === "admin" ? "warning" : "neutral"}>{u.role}</Badge>
                </td>
                <td className="px-4 py-3">
                  {u.disabled ? (
                    <Badge tone="danger">已停用</Badge>
                  ) : (
                    <Badge tone="success">活跃</Badge>
                  )}
                </td>
                <td className="hidden px-4 py-3 text-zinc-500 sm:table-cell">
                  {new Date(u.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <UserActions user={u} onChanged={reload} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function UserActions({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex justify-end gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null}
        onClick={() =>
          run("pw", async () => {
            const np = window.prompt(`为 ${user.username} 设置新密码`);
            if (!np) return;
            await api.updateUser(user.id, { password: np });
            alert("密码已更新");
          })
        }
      >
        {busy === "pw" ? "…" : "改密码"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null}
        onClick={() =>
          run("toggle", async () => {
            await api.updateUser(user.id, { disabled: !user.disabled });
            onChanged();
          })
        }
      >
        {busy === "toggle" ? "…" : user.disabled ? "启用" : "停用"}
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={busy !== null}
        onClick={() =>
          run("del", async () => {
            if (!window.confirm(`确认删除用户 ${user.username}？`)) return;
            await api.deleteUser(user.id);
            onChanged();
          })
        }
      >
        {busy === "del" ? "…" : "删除"}
      </Button>
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "editor">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createUser({ username, password, role });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label>用户名</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div>
          <Label>初始密码</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>角色</Label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "editor")}
            className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="editor">editor</option>
            <option value="admin">admin</option>
          </select>
        </div>
        {error && <p className="sm:col-span-3 text-sm text-rose-600">{error}</p>}
        <div className="sm:col-span-3">
          <Button type="submit" disabled={busy}>
            {busy ? "创建中…" : "创建"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
