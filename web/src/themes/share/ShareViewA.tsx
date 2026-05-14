import { Spinner } from "@/components/Spinner";
import { CommentBox } from "@/components/CommentBox";
import { PicturePreview } from "@/components/PicturePreview";
import { useState } from "react";
import { useThemeTokens } from "@/themes/ThemeProvider";
import { ThemedTile } from "./ThemedTile";
import type { ShareViewProps } from "./types";
import type { PublicTripSummary } from "@/lib/api";

// Theme A — Contact Sheet 接触印样
//   35mm 印样, 红色 darkroom 点缀, Instrument Serif + JetBrains Mono.
export function ShareViewA(props: ShareViewProps) {
  const t = useThemeTokens();
  const {
    scope,
    viewing,
    isMulti,
    tripLoading,
    loadingMore,
    sentinelRef,
    onOpenAsset,
    onOpenTrip,
    onBackToTrips,
    onForward,
    onLogout,
  } = props;

  const showingTripView = !isMulti || !!viewing;
  const total = viewing?.total ?? viewing?.assets?.length ?? 0;

  return (
    <div
      className="min-h-screen"
      style={{ background: t.bg, color: t.ink, fontFamily: t.sans }}
    >
      {/* Utility bar */}
      <div
        className="flex items-center justify-between border-b px-5 py-2.5 text-[11px] uppercase tracking-[.1em]"
        style={{ borderColor: t.rule2, fontFamily: t.mono }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: t.accent }}
            />
            Travel Moments
          </span>
          <span style={{ color: t.mute }}>·</span>
          <span style={{ color: t.mute }}>Contact Sheet</span>
        </div>
        <div className="flex gap-3 sm:gap-4" style={{ color: t.mute }}>
          <button onClick={onForward} className="hover:underline">
            Share
          </button>
          <button onClick={onLogout} className="hover:underline">
            Exit
          </button>
        </div>
      </div>

      {/* Hero / masthead */}
      {showingTripView && viewing ? (
        <header
          className="border-b px-5 py-8 sm:px-8 sm:py-10"
          style={{ borderColor: t.rule2 }}
        >
          {isMulti && (
            <button
              onClick={onBackToTrips}
              className="mb-4 text-[10px] uppercase tracking-[.15em] hover:underline"
              style={{ fontFamily: t.mono, color: t.mute }}
            >
              ← Back · Index
            </button>
          )}
          <div className="grid items-end gap-6 sm:grid-cols-[1fr_auto] sm:gap-10">
            <div className="min-w-0">
              <div
                className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] uppercase tracking-[.15em]"
                style={{ fontFamily: t.mono, color: t.mute }}
              >
                {viewing.subtitle && <span>{viewing.subtitle}</span>}
                {viewing.subtitle && <span>·</span>}
                <span style={{ color: t.accent }}>{total} EXP</span>
              </div>
              <h1
                className="m-0 italic"
                style={{
                  fontFamily: t.serif,
                  fontWeight: 400,
                  fontSize: "clamp(40px, 6vw, 72px)",
                  lineHeight: 0.95,
                  letterSpacing: -1,
                }}
              >
                {viewing.title || scope.share_note || "Roll"}
              </h1>
              {scope.share_note && !isMulti && (
                <p
                  className="mt-4 max-w-[560px]"
                  style={{
                    fontFamily: t.serif,
                    fontSize: 16,
                    lineHeight: 1.5,
                    color: "#2a2a2a",
                  }}
                >
                  {scope.share_note}
                </p>
              )}
            </div>
            <RegMark size={28} color={t.ink} />
          </div>
        </header>
      ) : (
        <header
          className="border-b px-5 py-8 sm:px-8"
          style={{ borderColor: t.rule2 }}
        >
          <div
            className="mb-2 text-[10px] uppercase tracking-[.15em]"
            style={{ fontFamily: t.mono, color: t.mute }}
          >
            {(scope.trips?.length ?? 0)} Rolls · Shared with you
          </div>
          <h1
            className="m-0 italic"
            style={{
              fontFamily: t.serif,
              fontWeight: 400,
              fontSize: "clamp(40px, 6vw, 64px)",
              lineHeight: 0.95,
              letterSpacing: -1,
            }}
          >
            Archive
          </h1>
          {scope.share_note && (
            <p
              className="mt-4 max-w-[560px]"
              style={{
                fontFamily: t.serif,
                fontSize: 16,
                lineHeight: 1.5,
                color: "#2a2a2a",
              }}
            >
              {scope.share_note}
            </p>
          )}
        </header>
      )}

      {/* Body */}
      <main className="px-2 py-4 sm:px-5">
        {isMulti && !viewing ? (
          <TripsGridA trips={scope.trips ?? []} onOpen={onOpenTrip} />
        ) : tripLoading ? (
          <LoadingRow />
        ) : viewing?.assets && viewing.assets.length > 0 ? (
          <>
            {/* Sort/filter strip */}
            <div
              className="mb-3 hidden items-center gap-1.5 border-b px-3 py-2 text-[10px] uppercase tracking-[.1em] sm:flex"
              style={{ borderColor: t.rule, fontFamily: t.mono }}
            >
              <span style={{ color: t.mute }}>Filter</span>
              <span
                className="px-2 py-1"
                style={{ background: t.ink, color: "#fff" }}
              >
                All · {total}
              </span>
              <span className="ml-auto" style={{ color: t.mute }}>
                Sort · Date ↓
              </span>
            </div>
            <ul className="grid grid-cols-3 gap-1 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
              {viewing.assets.map((a, i) => (
                <li key={a.id} className="aspect-square">
                  <ThemedTile
                    asset={a}
                    index={i}
                    total={total}
                    themeId="a"
                    tokens={t}
                    onClick={() => onOpenAsset(i)}
                  />
                </li>
              ))}
            </ul>
            <PaginationFooter
              hasMore={viewing.next_cursor != null}
              loadingMore={loadingMore}
              total={viewing.total ?? null}
              sentinelRef={sentinelRef}
            />
          </>
        ) : (
          <EmptyRow />
        )}

        {showingTripView && viewing?.trip_id != null && (
          <CommentSection tripID={viewing.trip_id} />
        )}
      </main>

      {/* Footer */}
      <div
        className="flex flex-wrap justify-between gap-2 border-t px-5 py-3 text-[10px] uppercase tracking-[.1em]"
        style={{ borderColor: t.rule2, fontFamily: t.mono, color: t.mute }}
      >
        <span>End of Roll</span>
        <span>Travel Moments · 私享</span>
      </div>
    </div>
  );
}

function RegMark({ size = 16, color = "#0a0a0a" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="block">
      <circle cx="8" cy="8" r="3" fill="none" stroke={color} strokeWidth="1" />
      <path d="M8 0v6M8 10v6M0 8h6M10 8h6" stroke={color} strokeWidth="1" />
    </svg>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-zinc-500">
      <Spinner /> 加载中…
    </div>
  );
}

function EmptyRow() {
  const t = useThemeTokens();
  return (
    <div
      className="m-4 border px-5 py-8 text-center text-sm"
      style={{ borderColor: t.rule, color: t.mute, fontFamily: t.mono }}
    >
      还没有内容
    </div>
  );
}

function PaginationFooter({
  hasMore,
  loadingMore,
  total,
  sentinelRef,
}: {
  hasMore: boolean;
  loadingMore: boolean;
  total: number | null;
  sentinelRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const t = useThemeTokens();
  if (hasMore) {
    return (
      <div
        ref={sentinelRef}
        className="flex items-center justify-center gap-2 py-6 text-xs uppercase tracking-[.1em]"
        style={{ fontFamily: t.mono, color: t.mute }}
      >
        {loadingMore ? (
          <>
            <Spinner className="h-4 w-4" /> Loading…
          </>
        ) : (
          <span>↓ Scroll for more</span>
        )}
      </div>
    );
  }
  if (total != null && total > 0) {
    return (
      <p
        className="py-6 text-center text-[10px] uppercase tracking-[.15em]"
        style={{ fontFamily: t.mono, color: t.mute }}
      >
        — {total} frames · End of roll —
      </p>
    );
  }
  return null;
}

function TripsGridA({
  trips,
  onOpen,
}: {
  trips: PublicTripSummary[];
  onOpen: (id: number) => void;
}) {
  const t = useThemeTokens();
  if (trips.length === 0) return <EmptyRow />;
  return (
    <ul className="grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((trip, idx) => (
        <li
          key={trip.id}
          className="border-b border-r"
          style={{ borderColor: t.rule }}
        >
          <button
            onClick={() => onOpen(trip.id)}
            className="block w-full p-4 text-left transition hover:bg-zinc-50"
          >
            <div
              className="mb-2 text-[10px] uppercase tracking-[.15em]"
              style={{ fontFamily: t.mono, color: t.mute }}
            >
              № {String(idx + 1).padStart(3, "0")} ·{" "}
              <span style={{ color: t.accent }}>{trip.asset_count} EXP</span>
            </div>
            <div
              className="relative mb-3 aspect-[3/2] overflow-hidden"
              style={{ background: t.rule }}
            >
              <PicturePreview
                urls={trip.cover_url}
                className="h-full w-full object-cover"
              />
            </div>
            <h3
              className="m-0 italic"
              style={{
                fontFamily: t.serif,
                fontSize: 22,
                fontWeight: 400,
                lineHeight: 1.1,
              }}
            >
              {trip.title}
            </h3>
            <div
              className="mt-1 text-[10px] uppercase tracking-[.12em]"
              style={{ fontFamily: t.mono, color: t.mute }}
            >
              {trip.location && <span>{trip.location} · </span>}
              {new Date(trip.started_at ?? trip.created_at)
                .toISOString()
                .slice(0, 10)}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CommentSection({ tripID }: { tripID: number }) {
  const [open, setOpen] = useState(false);
  const t = useThemeTokens();
  return (
    <section
      className="mt-6 border-t"
      style={{ borderColor: t.rule2 }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left text-[11px] uppercase tracking-[.15em]"
        style={{ fontFamily: t.mono, color: t.ink }}
      >
        <span>
          <span style={{ color: t.accent }}>●</span> Comments
        </span>
        <span style={{ color: t.mute }}>{open ? "− Hide" : "+ Open"}</span>
      </button>
      {open && (
        <div className="px-5 pb-8">
          <CommentBox targetType="trip" targetID={tripID} />
        </div>
      )}
    </section>
  );
}
