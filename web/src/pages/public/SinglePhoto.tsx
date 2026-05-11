import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type PublicAsset } from "@/lib/api";
import { Lightbox } from "@/components/Lightbox";

type Scope = {
  scope: string;
  trip_id: number;
  title: string;
  assets: PublicAsset[];
};

export function SinglePhotoPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Asset shares have no password; auth with empty body works.
        await api.authShare(code, "");
        if (cancelled) return;
        const s = await api.publicScope();
        if (cancelled) return;
        setScope(s as Scope);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return <div className="flex min-h-screen items-center justify-center text-rose-500">{error}</div>;
  }
  if (!scope) {
    return <div className="flex min-h-screen items-center justify-center text-zinc-500">加载中…</div>;
  }
  if (scope.assets.length === 0) {
    return <div className="flex min-h-screen items-center justify-center text-zinc-500">资源不存在或已撤销</div>;
  }

  return (
    <Lightbox
      assets={scope.assets}
      index={0}
      onClose={() => navigate("/", { replace: true })}
      singleMode
    />
  );
}
