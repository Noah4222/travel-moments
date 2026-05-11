import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Card } from "@/components/ui";
import { Spinner } from "@/components/Spinner";
import { UploadDropzone } from "@/components/UploadDropzone";

const STORAGE_PREFIX = "tm.upload.session.";

type Session = {
  uploadToken: string;
  expiresAt: string;
  tripId: number;
  tripTitle: string;
};

function loadSession(code: string): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + code);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      sessionStorage.removeItem(STORAGE_PREFIX + code);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(code: string, s: Session) {
  sessionStorage.setItem(STORAGE_PREFIX + code, JSON.stringify(s));
}

export function UploadPage() {
  const { code = "" } = useParams();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<
    "loading" | "consuming" | "ready" | "ended" | "error"
  >("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        // 1) If we already have a session for this code, use it.
        const existing = loadSession(code);
        if (existing) {
          setSession(existing);
          setStatus("ready");
          return;
        }

        // 2) Need a token. Hash carries it on first visit.
        let token = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : "";
        if (token) {
          // Decode (we URL-encoded it on copy)
          try {
            token = decodeURIComponent(token);
          } catch {
            /* keep as-is */
          }
          // Clean the URL so the token doesn't linger in browser history.
          window.history.replaceState(null, "", window.location.pathname);
        }

        if (!token) {
          // No token, no session — this is a re-visit after the one-shot
          // password got consumed.
          setStatus("ended");
          return;
        }

        setStatus("consuming");
        const r = await api.consumeUploadGrant(code, token);
        if (cancelled) return;
        const s: Session = {
          uploadToken: r.upload_token,
          expiresAt: r.expires_at,
          tripId: r.trip_id,
          tripTitle: r.trip_title,
        };
        saveSession(code, s);
        setSession(s);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <h1 className="text-2xl font-semibold">上传到「{session?.tripTitle ?? "..."}」</h1>

      {status === "loading" && (
        <p className="flex items-center gap-2 text-zinc-500">
          <Spinner className="h-4 w-4" /> 加载中…
        </p>
      )}
      {status === "consuming" && (
        <p className="flex items-center gap-2 text-zinc-500">
          <Spinner className="h-4 w-4" /> 正在验证一次性密钥…
        </p>
      )}
      {status === "error" && (
        <Card className="p-6">
          <p className="text-rose-600">{error}</p>
        </Card>
      )}
      {status === "ended" && (
        <Card className="space-y-2 p-6">
          <p className="text-zinc-800 dark:text-zinc-200">
            这个上传链接已被使用或失效。
          </p>
          <p className="text-sm text-zinc-500">
            上传链接是一次性的：第一次打开就消耗了密钥，关闭页面后无法再用同一个链接。
            如需继续上传，请向相册管理员索取新的链接。
          </p>
        </Card>
      )}
      {status === "ready" && session && (
        <>
          <Card className="p-6">
            <UploadDropzone
              tripId={session.tripId}
              bearer={session.uploadToken}
              onUploaded={() => {
                /* keep grant session — visitor may upload more files */
              }}
            />
            <p className="mt-4 text-xs text-zinc-500">
              当前会话有效至：{new Date(session.expiresAt).toLocaleString()}。
              关闭或刷新页面后该会话会失效。
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
