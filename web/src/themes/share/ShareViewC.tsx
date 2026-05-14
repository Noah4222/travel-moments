import { Spinner } from "@/components/Spinner";
import { CommentBox } from "@/components/CommentBox";
import { PicturePreview } from "@/components/PicturePreview";
import { useState } from "react";
import { useThemeTokens } from "@/themes/ThemeProvider";
import { ThemedTile } from "./ThemedTile";
import type { ShareViewProps } from "./types";
import type { PublicTripSummary } from "@/lib/api";

// Theme C — Modern Editorial 杂志志书
//   超大斜体 + 巨幅 folio + 引用页 + 电光蓝点缀.
export function ShareViewC(props: ShareViewProps) {
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
      {/* Masthead */}
      <header
        className="border-b"
        style={{ borderColor: t.rule2 }}
      >
        <div className="flex items-center justify-between px-6 py-5 sm:px-12">
          <span
            style={{ fontFamily: t.serif, fontSize: 26, letterSpacing: -0.5 }}
          >
            Travel <i>Moments</i>
          </span>
          <div
            className="flex items-center gap-4 text-[11px] uppercase tracking-[.15em] sm:gap-6"
            style={{ fontFamily: t.mono, color: t.mute }}
          >
            <span className="hidden sm:inline" style={{ color: t.ink }}>
              Issue · {new Date().getFullYear()}
            </span>
            <button
              onClick={onForward}
              className="px-3 py-1.5 text-white"
              style={{ background: t.accent }}
            >
              Share
            </button>
            <button onClick={onLogout} className="hover:underline">
              Exit
            </button>
          </div>
        </div>
      </header>

      {/* Cover: huge type + image */}
      {showingTripView && viewing ? (
        <section
          className="grid border-b sm:grid-cols-[5fr_7fr]"
          style={{ borderColor: t.rule2 }}
        >
          <div
            className="px-6 py-10 sm:px-12 sm:py-14 sm:border-r"
            style={{ borderColor: t.rule }}
          >
            {isMulti && (
              <button
                onClick={onBackToTrips}
                className="mb-6 text-[11px] uppercase tracking-[.15em] hover:underline"
                style={{ fontFamily: t.mono, color: t.mute }}
              >
                ← Back to issues
              </button>
            )}
            <div
              className="mb-3 text-[12px] uppercase tracking-[.2em]"
              style={{ fontFamily: t.mono, color: t.mute }}
            >
              A Photo Essay {viewing.subtitle ? `· ${viewing.subtitle}` : ""}
            </div>
            <h1
              className="m-0"
              style={{
                fontFamily: t.serif,
                fontWeight: 400,
                fontSize: "clamp(56px, 9vw, 116px)",
                lineHeight: 0.9,
                letterSpacing: -3,
              }}
            >
              {viewing.title?.split(/[·\s—-]/)[0] || viewing.title}
              <br />
              <i style={{ color: t.accent }}>
                {viewing.title?.split(/[·\s—-]/).slice(1).join(" ") || ""}
              </i>
            </h1>
            {scope.share_note && !isMulti && (
              <p
                className="mt-6 max-w-[440px]"
                style={{ fontFamily: t.serif, fontSize: 18, lineHeight: 1.45 }}
              >
                {scope.share_note}
              </p>
            )}
            <div
              className="mt-8 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[12px] uppercase tracking-[.15em]"
              style={{ fontFamily: t.mono, color: t.mute }}
            >
              {viewing.subtitle && (
                <>
                  <span>Where</span>
                  <span style={{ color: t.ink }}>{viewing.subtitle}</span>
                </>
              )}
              <span>Frames</span>
              <span style={{ color: t.ink }}>{total}</span>
            </div>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden sm:aspect-auto">
            {viewing.assets?.[0] && (
              <PicturePreview
                urls={viewing.assets[0].urls.thumb}
                className="block h-full w-full object-cover"
              />
            )}
            <div
              className="absolute bottom-4 left-4 text-[10px] uppercase tracking-[.2em] text-white"
              style={{ fontFamily: t.mono }}
            >
              ↘ 01 · {viewing.subtitle || viewing.title}
            </div>
          </div>
        </section>
      ) : (
        <section
          className="border-b px-6 py-10 sm:px-12 sm:py-14"
          style={{ borderColor: t.rule2 }}
        >
          <div
            className="mb-4 text-[12px] uppercase tracking-[.2em]"
            style={{ fontFamily: t.mono, color: t.mute }}
          >
            <span style={{ color: t.accent }}>{scope.trips?.length ?? 0} issues</span> · shared with you
          </div>
          <h1
            className="m-0"
            style={{
              fontFamily: t.serif,
              fontWeight: 400,
              fontSize: "clamp(56px, 9vw, 96px)",
              lineHeight: 0.9,
              letterSpacing: -2.5,
            }}
          >
            The <i>Archive.</i>
          </h1>
          {scope.share_note && (
            <p
              className="mt-6 max-w-[600px]"
              style={{ fontFamily: t.serif, fontSize: 18, lineHeight: 1.45 }}
            >
              {scope.share_note}
            </p>
          )}
        </section>
      )}

      {/* Folio header for body */}
      {showingTripView && viewing?.assets && viewing.assets.length > 0 && (
        <div
          className="flex flex-wrap items-baseline justify-between gap-3 border-b px-6 py-7 sm:px-12"
          style={{ borderColor: t.rule }}
        >
          <div className="flex items-baseline gap-4">
            <span
              className="text-[11px] uppercase tracking-[.2em]"
              style={{ fontFamily: t.mono, color: t.mute }}
            >
              Pp 01 — {String(total).padStart(2, "0")}
            </span>
            <h2
              className="m-0"
              style={{ fontFamily: t.serif, fontWeight: 400, fontSize: 36, letterSpacing: -0.5 }}
            >
              Plates & <i style={{ color: t.accent }}>frames</i>
            </h2>
          </div>
          <div
            className="text-[12px] uppercase tracking-[.12em]"
            style={{ fontFamily: t.mono, color: t.mute }}
          >
            <span style={{ color: t.ink, borderBottom: `2px solid ${t.accent}`, paddingBottom: 2 }}>
              All · {total}
            </span>
          </div>
        </div>
      )}

      <main className="px-3 pb-16 sm:px-12">
        {isMulti && !viewing ? (
          <TripsGridC trips={scope.trips ?? []} onOpen={onOpenTrip} />
        ) : tripLoading ? (
          <LoadingRowC />
        ) : viewing?.assets && viewing.assets.length > 0 ? (
          <>
            <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {viewing.assets.map((a, i) => (
                <li key={a.id} className="aspect-square">
                  <ThemedTile
                    asset={a}
                    index={i}
                    total={total}
                    themeId="c"
                    tokens={t}
                    onClick={() => onOpenAsset(i)}
                  />
                </li>
              ))}
            </ul>
            <PaginationFooterC
              hasMore={viewing.next_cursor != null}
              loadingMore={loadingMore}
              total={viewing.total ?? null}
              sentinelRef={sentinelRef}
            />
          </>
        ) : (
          <EmptyRowC />
        )}

        {showingTripView && viewing?.trip_id != null && (
          <CommentSectionC tripID={viewing.trip_id} />
        )}
      </main>

      <footer
        className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-5 text-[11px] uppercase tracking-[.15em] sm:px-12"
        style={{ borderColor: t.rule2, color: t.mute, fontFamily: t.mono }}
      >
        <span>
          Travel <i style={{ fontFamily: t.serif, color: t.ink, textTransform: "none" }}>Moments</i> · End
        </span>
        <span>仅本邀请可见</span>
      </footer>
    </div>
  );
}

function LoadingRowC() {
  const t = useThemeTokens();
  return (
    <div
      className="flex items-center justify-center gap-2 py-16 text-[11px] uppercase tracking-[.2em]"
      style={{ fontFamily: t.mono, color: t.mute }}
    >
      <Spinner /> Loading
    </div>
  );
}

function EmptyRowC() {
  const t = useThemeTokens();
  return (
    <div
      className="m-4 border px-5 py-16 text-center text-[12px] uppercase tracking-[.2em]"
      style={{ borderColor: t.rule, color: t.mute, fontFamily: t.mono }}
    >
      Empty page
    </div>
  );
}

function PaginationFooterC({
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
        className="flex items-center justify-center gap-2 py-10 text-[11px] uppercase tracking-[.2em]"
        style={{ fontFamily: t.mono, color: t.mute }}
      >
        {loadingMore ? (
          <>
            <Spinner className="h-4 w-4" /> Loading…
          </>
        ) : (
          <span>↓ Continue reading</span>
        )}
      </div>
    );
  }
  if (total != null && total > 0) {
    return (
      <p
        className="py-10 text-center text-[11px] uppercase tracking-[.2em]"
        style={{ fontFamily: t.mono, color: t.mute }}
      >
        — Fin · {total} plates —
      </p>
    );
  }
  return null;
}

function TripsGridC({
  trips,
  onOpen,
}: {
  trips: PublicTripSummary[];
  onOpen: (id: number) => void;
}) {
  const t = useThemeTokens();
  if (trips.length === 0) return <EmptyRowC />;
  return (
    <div className="mt-6">
      <div
        className="grid grid-cols-[40px_1fr_140px] gap-3 border-b py-2 text-[10px] uppercase tracking-[.2em] sm:grid-cols-[48px_1fr_220px_120px]"
        style={{ borderColor: t.rule2, fontFamily: t.mono, color: t.mute }}
      >
        <span>№</span>
        <span>Title</span>
        <span className="hidden sm:block">Where · When</span>
        <span className="text-right">Frames</span>
      </div>
      {trips.map((trip, idx) => (
        <button
          key={trip.id}
          onClick={() => onOpen(trip.id)}
          className="grid w-full grid-cols-[40px_1fr_140px] items-center gap-3 border-b py-5 text-left transition hover:bg-white/50 sm:grid-cols-[48px_1fr_220px_120px]"
          style={{ borderColor: t.rule }}
        >
          <span
            className="text-[14px]"
            style={{ fontFamily: t.mono, color: t.mute }}
          >
            {String(idx + 1).padStart(2, "0")}
          </span>
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative h-12 w-16 flex-shrink-0 overflow-hidden">
              <PicturePreview
                urls={trip.cover_url}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <h3
                className="m-0 truncate"
                style={{ fontFamily: t.serif, fontSize: 22, letterSpacing: -0.3, lineHeight: 1.1 }}
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
            {trip.asset_count}
          </div>
        </button>
      ))}
    </div>
  );
}

function CommentSectionC({ tripID }: { tripID: number }) {
  const [open, setOpen] = useState(false);
  const t = useThemeTokens();
  return (
    <section
      className="mt-10 border-t pt-6"
      style={{ borderColor: t.rule }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between"
      >
        <h3
          className="m-0"
          style={{ fontFamily: t.serif, fontSize: 28, fontWeight: 400, letterSpacing: -0.5 }}
        >
          Notes <i style={{ color: t.accent }}>&amp; talk</i>
        </h3>
        <span
          className="text-[11px] uppercase tracking-[.2em]"
          style={{ fontFamily: t.mono, color: t.mute }}
        >
          {open ? "Close" : "Open"}
        </span>
      </button>
      {open && (
        <div className="mt-4">
          <CommentBox targetType="trip" targetID={tripID} />
        </div>
      )}
    </section>
  );
}
