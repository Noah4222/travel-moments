import { Link } from "react-router-dom";
import type { Trip } from "@/lib/api";
import { PicturePreview } from "@/components/PicturePreview";
import { Card } from "@/components/ui";
import { useTheme } from "@/themes/ThemeProvider";

// Trip from the admin list may also carry `asset_count` (backend extension);
// we treat it as optional so older fields don't fight TS.
type AdminTrip = Trip & { asset_count?: number };
type Props = { trips: Trip[] };

// Themed admin trip list. Each variant matches its design direction's
// "admin archive" screen — A: contact-strip rows, B: scrapbook cards,
// C: editorial table of contents.
export function AdminTripsThemed({ trips }: Props) {
  const { themeId } = useTheme();
  if (themeId === "b") return <AdminTripsB trips={trips} />;
  if (themeId === "c") return <AdminTripsC trips={trips} />;
  return <AdminTripsA trips={trips} />;
}

function groupByYear(trips: AdminTrip[]): { year: number; trips: AdminTrip[] }[] {
  const map = new Map<number, AdminTrip[]>();
  for (const t of trips) {
    const y = new Date(t.started_at ?? t.created_at).getFullYear();
    const arr = map.get(y) ?? [];
    arr.push(t);
    map.set(y, arr);
  }
  return Array.from(map.entries())
    .map(([year, trips]) => ({ year, trips }))
    .sort((a, b) => b.year - a.year);
}

// ── A · Contact Sheet
function AdminTripsA({ trips }: { trips: AdminTrip[] }) {
  const { tokens: t } = useTheme();
  const groups = groupByYear(trips);
  return (
    <div className="-mx-3 sm:-mx-4">
      {groups.map((g) => (
        <div key={g.year}>
          <div
            className="flex items-baseline justify-between border-t px-4 py-2 text-[11px] uppercase tracking-[.15em]"
            style={{ borderColor: t.rule2, fontFamily: t.mono }}
          >
            <span
              className="italic"
              style={{ fontFamily: t.serif, fontSize: 28, letterSpacing: -0.5 }}
            >
              {g.year}
            </span>
            <span style={{ color: t.mute }}>
              {g.trips.length} ROLL · {g.trips.reduce((s, x) => s + (x.asset_count ?? 0), 0)} FRAMES
            </span>
          </div>
          {g.trips.map((trip, idx) => (
            <Link
              key={trip.id}
              to={`/admin/trips/${trip.id}`}
              className="grid grid-cols-[80px_1fr] gap-4 border-t px-4 py-5 transition hover:bg-zinc-50 sm:grid-cols-[120px_1fr_320px] sm:gap-6"
              style={{ borderColor: t.rule }}
            >
              <div>
                <div
                  className="text-[10px] uppercase tracking-[.15em]"
                  style={{ fontFamily: t.mono, color: t.mute }}
                >
                  № {String(idx + 1).padStart(3, "0")}
                </div>
                <div
                  className="mt-1 italic"
                  style={{ fontFamily: t.serif, fontSize: 32, lineHeight: 1 }}
                >
                  {new Date(trip.started_at ?? trip.created_at).getMonth() + 1}/
                  {new Date(trip.started_at ?? trip.created_at).getDate()}
                </div>
              </div>
              <div>
                <h3
                  className="m-0 italic"
                  style={{ fontFamily: t.serif, fontWeight: 400, fontSize: 24, lineHeight: 1.1 }}
                >
                  {trip.title}
                </h3>
                <div
                  className="mt-1.5 text-[10px] uppercase tracking-[.12em]"
                  style={{ fontFamily: t.mono, color: t.mute }}
                >
                  {trip.location && <span>{trip.location} · </span>}
                  <span style={{ color: t.accent }}>{trip.asset_count ?? 0} FRAMES</span>
                </div>
                {trip.description && (
                  <p
                    className="mt-2 max-w-[520px] text-sm leading-relaxed"
                    style={{ color: "#3a3a3a" }}
                  >
                    {trip.description}
                  </p>
                )}
              </div>
              <div className="hidden items-end justify-end sm:flex">
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-100">
                  <PicturePreview
                    urls={trip.cover_url}
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── B · Album Pages — scrapbook tilted cards
function AdminTripsB({ trips }: { trips: AdminTrip[] }) {
  const { tokens: t } = useTheme();
  return (
    <div className="grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((trip, idx) => (
        <Link
          key={trip.id}
          to={`/admin/trips/${trip.id}`}
          className="relative bg-white px-4 pb-5 pt-3 shadow-[0_4px_20px_rgba(0,0,0,.08)] transition hover:-translate-y-0.5"
          style={{
            transform: `rotate(${[-1.2, 0.5, -0.6, 1, -0.4, 0.7][idx % 6]}deg)`,
          }}
        >
          <div className="relative aspect-[4/3]">
            <PicturePreview
              urls={trip.cover_url}
              className="block h-full w-full object-cover"
            />
            <PhotoCornersAbs size={12} />
          </div>
          <div
            className="absolute z-10 inline-block px-4 py-1 shadow-sm"
            style={{
              top: -8,
              left: "20%",
              background: "rgba(245,243,235,.95)",
              transform: "rotate(-4deg)",
              fontFamily: t.hand,
              fontSize: 16,
              borderTop: "1px dashed rgba(0,0,0,.08)",
              borderBottom: "1px dashed rgba(0,0,0,.08)",
            }}
          >
            {new Date(trip.started_at ?? trip.created_at).getFullYear()}
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <h3
              className="m-0"
              style={{ fontFamily: t.serif, fontSize: 22, letterSpacing: -0.3 }}
            >
              {trip.title}
            </h3>
            <span style={{ fontFamily: t.hand, fontSize: 18, color: t.mute }}>
              {new Date(trip.started_at ?? trip.created_at).getMonth() + 1}/
              {new Date(trip.started_at ?? trip.created_at).getDate()}
            </span>
          </div>
          <div
            className="mt-1 text-[11px] uppercase tracking-[.1em]"
            style={{ color: t.mute }}
          >
            {trip.location && <span>{trip.location} · </span>}
            <span style={{ color: t.accent, fontWeight: 700 }}>
              {trip.asset_count ?? 0} 张
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── C · Modern Editorial — table of contents
function AdminTripsC({ trips }: { trips: AdminTrip[] }) {
  const { tokens: t } = useTheme();
  return (
    <Card className="p-0">
      <div
        className="grid grid-cols-[40px_1fr_120px] gap-3 border-b px-5 py-3 text-[10px] uppercase tracking-[.2em] sm:grid-cols-[48px_1fr_200px_120px] sm:px-7"
        style={{ borderColor: t.rule2, fontFamily: t.mono, color: t.mute }}
      >
        <span>№</span>
        <span>Title</span>
        <span className="hidden sm:block">Where · When</span>
        <span className="text-right">Frames</span>
      </div>
      {trips.map((trip, idx) => (
        <Link
          key={trip.id}
          to={`/admin/trips/${trip.id}`}
          className="grid grid-cols-[40px_1fr_120px] items-center gap-3 border-b px-5 py-4 transition hover:bg-zinc-50 sm:grid-cols-[48px_1fr_200px_120px] sm:px-7"
          style={{ borderColor: t.rule }}
        >
          <span
            className="text-sm"
            style={{ fontFamily: t.mono, color: t.mute }}
          >
            {String(idx + 1).padStart(2, "0")}
          </span>
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative h-12 w-16 flex-shrink-0 overflow-hidden">
              <PicturePreview
                urls={trip.cover_url}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <h3
                className="m-0 truncate"
                style={{
                  fontFamily: t.serif,
                  fontSize: 22,
                  letterSpacing: -0.3,
                  lineHeight: 1.1,
                }}
              >
                {trip.title}
              </h3>
              {trip.description && (
                <p
                  className="m-0 line-clamp-1 text-xs"
                  style={{ color: t.mute }}
                >
                  {trip.description}
                </p>
              )}
            </div>
          </div>
          <div
            className="hidden text-[11px] uppercase tracking-[.1em] sm:block"
            style={{ fontFamily: t.mono }}
          >
            <div style={{ color: t.ink }}>{trip.location}</div>
            <div style={{ color: t.mute, marginTop: 2 }}>
              {new Date(trip.started_at ?? trip.created_at).toISOString().slice(0, 10)}
            </div>
          </div>
          <div
            className="text-right"
            style={{ fontFamily: t.serif, fontSize: 22, letterSpacing: -0.3 }}
          >
            {trip.asset_count ?? 0}
          </div>
        </Link>
      ))}
    </Card>
  );
}

function PhotoCornersAbs({ size = 12, color = "#0a0a0a" }: { size?: number; color?: string }) {
  const corners = [
    { pos: { top: 0, left: 0 }, clip: "polygon(0 0, 100% 0, 0 100%)" },
    { pos: { top: 0, right: 0 }, clip: "polygon(100% 0, 100% 100%, 0 0)" },
    { pos: { bottom: 0, left: 0 }, clip: "polygon(0 0, 0 100%, 100% 100%)" },
    { pos: { bottom: 0, right: 0 }, clip: "polygon(100% 0, 100% 100%, 0 100%)" },
  ];
  return (
    <>
      {corners.map((c, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            width: size,
            height: size,
            background: color,
            clipPath: c.clip,
            ...c.pos,
          }}
        />
      ))}
    </>
  );
}
