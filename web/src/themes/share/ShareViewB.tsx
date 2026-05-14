import { Spinner } from "@/components/Spinner";
import { CommentBox } from "@/components/CommentBox";
import { PicturePreview } from "@/components/PicturePreview";
import { useState } from "react";
import { useThemeTokens } from "@/themes/ThemeProvider";
import { ThemedTile } from "./ThemedTile";
import type { ShareViewProps } from "./types";
import type { PublicTripSummary } from "@/lib/api";

// Theme B — Album Pages 影集胶页
//   黑色照片角 + 手写注脚 + 美纹胶带 + 黄色点缀.
export function ShareViewB(props: ShareViewProps) {
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
  const started =
    viewing?.trip_id != null && viewing
      ? null /* per-trip date isn't on scope */
      : null;
  void started;

  return (
    <div
      className="relative min-h-screen"
      style={{ background: t.bg, color: t.ink, fontFamily: t.sans }}
    >
      {/* Plate / nav */}
      <div
        className="flex items-center justify-between border-b px-5 py-4 sm:px-8"
        style={{ borderColor: t.rule2 }}
      >
        <div className="flex items-baseline gap-3">
          <span
            className="font-semibold tracking-tight"
            style={{ fontFamily: t.serif, fontSize: 17 }}
          >
            Travel{" "}
            <i style={{ fontWeight: 400 }}>Moments</i>
          </span>
          <span
            className="inline-block -rotate-1"
            style={{ fontFamily: t.hand, fontSize: 20, color: t.mute }}
          >
            私享相册
          </span>
        </div>
        <div
          className="flex gap-4 text-[13px]"
          style={{ color: t.mute }}
        >
          <button
            onClick={onForward}
            className="hover:underline"
          >
            转发
          </button>
          <button onClick={onLogout} className="hover:underline">
            退出
          </button>
        </div>
      </div>

      {/* Hero spread */}
      {showingTripView && viewing ? (
        <section className="relative px-5 py-10 sm:px-10">
          <MaskingTape top={28} left="20%" rotate={-3} accent tokens={t}>
            VOLUME · ⑦
          </MaskingTape>
          {isMulti && (
            <button
              onClick={onBackToTrips}
              className="mb-2 inline-block -rotate-1 text-sm hover:underline"
              style={{ fontFamily: t.hand, color: t.mute }}
            >
              ← 回到书架
            </button>
          )}
          <div className="grid items-center gap-10 sm:grid-cols-2 sm:gap-14">
            <div>
              <h1
                className="m-0"
                style={{
                  fontFamily: t.serif,
                  fontWeight: 400,
                  fontSize: "clamp(48px, 7vw, 88px)",
                  lineHeight: 0.92,
                  letterSpacing: -2,
                }}
              >
                {viewing.title}
              </h1>
              {scope.share_note && !isMulti && (
                <p
                  className="mt-4 max-w-[480px]"
                  style={{ fontFamily: t.serif, fontSize: 17, lineHeight: 1.55 }}
                >
                  {scope.share_note}
                </p>
              )}
              <div
                className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] uppercase tracking-[.1em]"
                style={{ color: t.mute }}
              >
                {viewing.subtitle && <span>{viewing.subtitle}</span>}
                <span style={{ color: t.ink }}>{total} 张内容</span>
              </div>
            </div>
            {/* cover photo with corners & tape */}
            {viewing.assets?.[0] && (
              <div className="relative px-4 py-2">
                <div
                  className="relative shadow-[0_12px_36px_rgba(0,0,0,.18)]"
                  style={{ transform: "rotate(1.2deg)" }}
                >
                  <PicturePreview
                    urls={viewing.assets[0].urls.thumb}
                    className="block aspect-[4/3] w-full object-cover"
                  />
                  <PhotoCornersAbs size={18} />
                </div>
                <MaskingTape top={-6} right={28} rotate={6} tokens={t}>
                  {new Date(scope.assets?.[0]?.urls ? Date.now() : Date.now()).getFullYear()}
                </MaskingTape>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="relative px-5 py-10 sm:px-10">
          <MaskingTape top={28} left="20%" rotate={-3} accent tokens={t}>
            SHELF
          </MaskingTape>
          <div
            className="mb-1 inline-block -rotate-2"
            style={{ fontFamily: t.hand, fontSize: 26, color: t.accent }}
          >
            书架上有 {(scope.trips?.length ?? 0)} 本
          </div>
          <h1
            className="m-0"
            style={{
              fontFamily: t.serif,
              fontWeight: 400,
              fontSize: "clamp(48px, 7vw, 72px)",
              lineHeight: 0.95,
              letterSpacing: -1.5,
            }}
          >
            相册 · <i>archive</i>
          </h1>
          {scope.share_note && (
            <p
              className="mt-4 max-w-[480px]"
              style={{ fontFamily: t.serif, fontSize: 17, lineHeight: 1.55 }}
            >
              {scope.share_note}
            </p>
          )}
        </section>
      )}

      <main className="px-4 pb-16 sm:px-8">
        {isMulti && !viewing ? (
          <TripsGridB trips={scope.trips ?? []} onOpen={onOpenTrip} />
        ) : tripLoading ? (
          <LoadingRowB />
        ) : viewing?.assets && viewing.assets.length > 0 ? (
          <>
            {/* Chapter divider */}
            <div
              className="mb-4 flex items-baseline gap-5 border-t border-dashed pt-6"
              style={{ borderColor: t.rule }}
            >
              <span
                className="italic"
                style={{
                  fontFamily: t.serif,
                  fontSize: 84,
                  lineHeight: 0.7,
                  color: t.accent,
                  marginTop: -12,
                }}
              >
                一
              </span>
              <div>
                <div
                  style={{
                    fontFamily: t.serif,
                    fontSize: 26,
                  }}
                >
                  整本相册
                </div>
                <div style={{ fontFamily: t.hand, fontSize: 18, color: t.mute }}>
                  慢慢翻
                </div>
              </div>
              <span
                className="ml-auto text-[11px] uppercase tracking-[.12em]"
                style={{ color: t.mute }}
              >
                {total} 张
              </span>
            </div>

            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {viewing.assets.map((a, i) => (
                <li
                  key={a.id}
                  style={{
                    transform: `rotate(${[-0.6, 0.5, -0.3, 0.4, 0.7, -0.5, -0.4, 0.3][i % 8]}deg)`,
                  }}
                >
                  <ThemedTile
                    asset={a}
                    index={i}
                    total={total}
                    themeId="b"
                    tokens={t}
                    onClick={() => onOpenAsset(i)}
                  />
                </li>
              ))}
            </ul>
            <PaginationFooterB
              hasMore={viewing.next_cursor != null}
              loadingMore={loadingMore}
              total={viewing.total ?? null}
              sentinelRef={sentinelRef}
            />
          </>
        ) : (
          <EmptyRowB />
        )}

        {showingTripView && viewing?.trip_id != null && (
          <CommentSectionB tripID={viewing.trip_id} />
        )}
      </main>
    </div>
  );
}

function MaskingTape({
  children,
  top,
  left,
  right,
  rotate = -2,
  accent = false,
  tokens,
}: {
  children: React.ReactNode;
  top?: number | string;
  left?: number | string;
  right?: number | string;
  rotate?: number;
  accent?: boolean;
  tokens: ReturnType<typeof useThemeTokens>;
}) {
  return (
    <div
      className="absolute z-10 hidden px-5 py-1.5 shadow-[0_1px_3px_rgba(0,0,0,.1)] sm:block"
      style={{
        top,
        left,
        right,
        transform: `rotate(${rotate}deg)`,
        background: accent ? tokens.accent : "rgba(245,243,235,.95)",
        fontFamily: tokens.hand,
        fontSize: 17,
        color: "#0a0a0a",
        borderTop: "1px dashed rgba(0,0,0,.08)",
        borderBottom: "1px dashed rgba(0,0,0,.08)",
      }}
    >
      {children}
    </div>
  );
}

function PhotoCornersAbs({ size = 18, color = "#0a0a0a" }: { size?: number; color?: string }) {
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

function LoadingRowB() {
  const t = useThemeTokens();
  return (
    <div
      className="flex items-center justify-center gap-2 py-12"
      style={{ fontFamily: t.hand, fontSize: 22, color: t.mute }}
    >
      <Spinner /> 在翻页…
    </div>
  );
}

function EmptyRowB() {
  const t = useThemeTokens();
  return (
    <div
      className="m-4 px-5 py-10 text-center"
      style={{ background: "#fff", fontFamily: t.hand, fontSize: 24, color: t.mute }}
    >
      空空如也
    </div>
  );
}

function PaginationFooterB({
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
        className="flex items-center justify-center gap-2 py-8"
        style={{ fontFamily: t.hand, fontSize: 20, color: t.mute }}
      >
        {loadingMore ? (
          <>
            <Spinner className="h-4 w-4" /> 翻页中…
          </>
        ) : (
          <span>↓ 再往下翻</span>
        )}
      </div>
    );
  }
  if (total != null && total > 0) {
    return (
      <p
        className="py-8 text-center"
        style={{ fontFamily: t.hand, fontSize: 22, color: t.mute }}
      >
        — 全 {total} 张，到底啦 —
      </p>
    );
  }
  return null;
}

function TripsGridB({
  trips,
  onOpen,
}: {
  trips: PublicTripSummary[];
  onOpen: (id: number) => void;
}) {
  const t = useThemeTokens();
  if (trips.length === 0) return <EmptyRowB />;
  return (
    <div className="grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((trip, idx) => (
        <button
          key={trip.id}
          onClick={() => onOpen(trip.id)}
          className="group relative bg-white px-4 pb-5 pt-3 text-left shadow-[0_4px_20px_rgba(0,0,0,.08)] transition hover:-translate-y-0.5"
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
            <span
              style={{ fontFamily: t.hand, fontSize: 18, color: t.mute }}
            >
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
              {trip.asset_count} 张
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function CommentSectionB({ tripID }: { tripID: number }) {
  const [open, setOpen] = useState(false);
  const t = useThemeTokens();
  return (
    <section
      className="mt-10 border-t border-dashed px-2 py-6 sm:px-4"
      style={{ borderColor: t.rule }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span
          className="inline-block -rotate-2"
          style={{ fontFamily: t.hand, fontSize: 32, color: t.accent }}
        >
          留言板
        </span>
        <span
          className="text-[11px] uppercase tracking-[.15em]"
          style={{ color: t.mute }}
        >
          {open ? "收起" : "展开"}
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
