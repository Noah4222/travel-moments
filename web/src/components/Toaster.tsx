import { useEffect, useState } from "react";
import { subscribeToasts, type Toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

export function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    return subscribeToasts((t) => {
      setList((l) => [...l, t]);
      window.setTimeout(
        () => setList((l) => l.filter((x) => x.id !== t.id)),
        2400,
      );
    });
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto rounded-full px-4 py-2 text-sm font-medium shadow-lg backdrop-blur-md",
            t.tone === "error"
              ? "bg-rose-600/95 text-white"
              : "bg-emerald-600/95 text-white",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
