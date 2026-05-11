import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";
import { isPasskeySupported, loginWithPasskey } from "@/lib/passkey";

export function LoginPage() {
  const { login, adoptSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? "/admin";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPasskeyLogin() {
    setPasskeyBusy(true);
    setError(null);
    try {
      const r = await loginWithPasskey(username || undefined);
      adoptSession(r.token, r.user as never);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-xl font-semibold">登录</h1>
        <p className="mb-6 text-sm text-zinc-500">Travel Moments 后台</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="u">用户名</Label>
            <Input
              id="u"
              autoFocus
              autoComplete="username webauthn"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="p">密码</Label>
            <Input
              id="p"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "登录中…" : "登录"}
          </Button>
        </form>
        {isPasskeySupported() && (
          <>
            <div className="my-4 flex items-center gap-2 text-xs text-zinc-400">
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              或
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={passkeyBusy}
              onClick={onPasskeyLogin}
            >
              {passkeyBusy ? "调用 Passkey…" : "🔑 用 Passkey 登录"}
            </Button>
            <p className="mt-2 text-center text-xs text-zinc-400">
              不需要输入用户名也可（启用了发现凭证）
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
