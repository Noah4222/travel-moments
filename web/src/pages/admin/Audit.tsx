import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/cn";
import { EventsTab } from "./audit/EventsTab";
import { SharesTab } from "./audit/SharesTab";
import { TripsTab } from "./audit/TripsTab";

const TABS = [
  { id: "events", label: "事件流" },
  { id: "shares", label: "分享总览" },
  { id: "trips", label: "相册维度" },
] as const;

type TabID = (typeof TABS)[number]["id"];

export function AuditPage() {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("tab") ?? "events";
  const tab: TabID = (TABS.some((t) => t.id === raw) ? raw : "events") as TabID;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">访问追溯</h1>
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSp({ tab: t.id })}
            className={cn(
              "px-3 py-2 text-sm font-medium",
              tab === t.id
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "events" && <EventsTab />}
      {tab === "shares" && <SharesTab />}
      {tab === "trips" && <TripsTab />}
    </div>
  );
}
