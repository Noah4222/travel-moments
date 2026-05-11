import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";
import { isPasskeySupported, loginWithPasskey } from "@/lib/passkey";

type Stage =
  | { kind: "password" }
  | { kind: "totp"; challenge: string };

export function LoginPage() {
  const { login, adoptSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [stage, setStage] = useState<Stage>({ kind: "password" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? "/admin";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(username, password);
      if (r.totp_required && r.challenge_token) {
        setStage({ kind: "totp", challenge: r.challenge_token });
        setCode("");
        return;
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onTOTPSubmit(e: FormEvent) {
    e.preventDefault();
    if (stage.kind !== "totp") return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.loginTOTP(stage.challenge, code.trim());
      adoptSession(r.token, r.user as never);
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

        {stage.kind === "password" && (
          <>
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
                  Passkey 登录不需要 2FA
                </p>
              </>
            )}
          </>
        )}

        {stage.kind === "totp" && (
          <form onSubmit={onTOTPSubmit} className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              请输入验证器中显示的 6 位代码：
            </p>
            <div>
              <Label htmlFor="otp">验证码</Label>
              <Input
                id="otp"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="text-center text-lg tracking-widest"
              />
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
              {busy ? "验证中…" : "验证"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStage({ kind: "password" });
                setCode("");
                setError(null);
              }}
            >
              ← 重新输入密码
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
