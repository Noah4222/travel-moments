import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";
import { Spinner } from "@/components/Spinner";

const PW_KEY_PREFIX = "tm.share.pwd.";

function rememberedPassword(code: string): string | null {
  return localStorage.getItem(PW_KEY_PREFIX + code);
}
function rememberPassword(code: string, password: string) {
  localStorage.setItem(PW_KEY_PREFIX + code, password);
}

export function SharePasswordPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoBusy, setAutoBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const triedRef = useRef(false);

  // Try auto-auth via #hash or remembered password.
  useEffect(() => {
    if (triedRef.current) return;
    triedRef.current = true;
    (async () => {
      try {
        let candidate = "";
        if (window.location.hash.length > 1) {
          const raw = window.location.hash.slice(1);
          try {
            candidate = decodeURIComponent(raw);
          } catch {
            candidate = raw;
          }
          // Strip the hash from the address bar without reloading.
          history.replaceState(null, "", window.location.pathname + window.location.search);
        }
        if (!candidate) candidate = rememberedPassword(code) ?? "";
        if (!candidate) return;
        await api.authShare(code, candidate);
        rememberPassword(code, candidate);
        navigate(`/s/${code}/view`, { replace: true });
      } catch (err) {
        // Auto attempt failed — clear stale memory and let the user type.
        localStorage.removeItem(PW_KEY_PREFIX + code);
        if (err instanceof ApiError && err.status !== 401) {
          setError(err.message);
        }
      } finally {
        setAutoBusy(false);
      }
    })();
  }, [code, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.authShare(code, password.trim());
      rememberPassword(code, password.trim());
      navigate(`/s/${code}/view`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (autoBusy) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-zinc-500">
        <Spinner /> 正在校验密码…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-200 p-4 dark:from-zinc-950 dark:to-zinc-900">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-xl font-semibold">Travel Moments</h1>
        <p className="mb-6 text-sm text-zinc-500">请输入访问密码 ({code})</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="pw">密码</Label>
            <Input
              id="pw"
              autoFocus
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value.toUpperCase())}
              placeholder="6-12 位字符"
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "验证中…" : "进入相册"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
