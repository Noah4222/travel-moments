import type { PublicAsset, PublicTripSummary } from "@/lib/api";

export type ShareScope = {
  scope: string;
  theme?: string;
  trip_id?: number;
  title?: string;
  subtitle?: string;
  share_note?: string;
  assets?: PublicAsset[];
  next_cursor?: number | null;
  total?: number;
  trips?: PublicTripSummary[];
};

export type ShareViewProps = {
  scope: ShareScope;
  /** active scope — either the share itself (single) or the picked sub-trip from multi */
  viewing: ShareScope | null;
  isMulti: boolean;
  tripLoading: boolean;
  loadingMore: boolean;
  sentinelRef: React.MutableRefObject<HTMLDivElement | null>;
  onOpenAsset: (i: number) => void;
  onOpenTrip: (id: number) => void;
  onBackToTrips: () => void;
  onForward: () => void;
  onLogout: () => void;
};
