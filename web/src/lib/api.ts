const TOKEN_KEY = "tm.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

export async function apiFetch<T = unknown>(
  path: string,
  opts: {
    method?: Method;
    body?: unknown;
    headers?: Record<string, string>;
    /** Override the bearer token (e.g. ephemeral upload JWT). */
    bearer?: string | null;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers ?? {}),
  };
  const token = opts.bearer !== undefined ? opts.bearer : getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : null) ?? res.statusText;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export type User = {
  id: number;
  username: string;
  role: "admin" | "editor";
  disabled: boolean;
  totp_enabled?: boolean;
  created_at: string;
};

export type Trip = {
  id: number;
  slug: string;
  title: string;
  description: string;
  location: string;
  started_at: string | null;
  ended_at: string | null;
  cover_asset_id: number | null;
  cover_url?: ImgURLs;
  show_view_counts?: boolean;
  created_by_id: number;
  created_at: string;
  updated_at: string;
  editor_user_ids?: number[];
};

export type AssetURLVariant =
  | "thumb"
  | "preview"
  | "full_webp"
  | "full_avif"
  | "original"
  | "video"
  | "download"
  | "motion";

export type PublicTripSummary = {
  id: number;
  title: string;
  location?: string;
  description?: string;
  cover_url?: ImgURLs;
  asset_count: number;
  started_at?: string;
  created_at: string;
};

export type LoginResp = {
  token?: string;
  expires_at?: string;
  user?: User;
  totp_required?: boolean;
  challenge_token?: string;
};

export type ImgURLs = { avif?: string; webp?: string };

export type AssetURLs = {
  thumb?: ImgURLs;
  preview?: ImgURLs;
  video_cover?: ImgURLs;
  video?: string;
  motion?: string;
  original?: string;
  download?: string;
};

export type Asset = {
  id: number;
  trip_id: number;
  kind: "photo" | "video";
  mime: string;
  size: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  taken_at?: string;
  hls_status: "none" | "pending" | "ready" | "failed";
  sort_order: number;
  uploaded_by_id: number;
  is_live_photo?: boolean;
  created_at: string;
  urls: AssetURLs;
};

export type AssetPage = {
  assets: Asset[];
  next_cursor: number | null;
  total?: number;
};

export type PublicAssetPage = {
  assets: PublicAsset[];
  next_cursor: number | null;
  total?: number;
};

export type UploadPolicy = {
  host: string;
  access_key_id: string;
  policy: string;
  signature: string;
  key: string;
  expires_at: string;
  max_size_bytes: number;
  success_action_status: string;
  cache_control?: string;
  oss_key: string;
};

export const api = {
  login: (username: string, password: string) =>
    apiFetch<LoginResp>("/auth/login", { method: "POST", body: { username, password } }),
  me: () => apiFetch<User>("/auth/me"),

  listUsers: () => apiFetch<User[]>("/users"),
  createUser: (body: { username: string; password: string; role: "admin" | "editor" }) =>
    apiFetch<User>("/users", { method: "POST", body }),
  updateUser: (id: number, body: { password?: string; role?: string; disabled?: boolean }) =>
    apiFetch<User>(`/users/${id}`, { method: "PATCH", body }),
  deleteUser: (id: number) => apiFetch<void>(`/users/${id}`, { method: "DELETE" }),

  listTrips: () => apiFetch<Trip[]>("/trips"),
  getTrip: (id: number) => apiFetch<Trip>(`/trips/${id}`),
  createTrip: (body: {
    slug: string;
    title: string;
    description?: string;
    location?: string;
    started_at?: string;
    ended_at?: string;
  }) => apiFetch<Trip>("/trips", { method: "POST", body }),
  updateTrip: (id: number, body: Partial<Trip> & { cover_asset_id?: number | null }) =>
    apiFetch<Trip>(`/trips/${id}`, { method: "PATCH", body }),
  deleteTrip: (id: number) => apiFetch<void>(`/trips/${id}`, { method: "DELETE" }),
  addEditor: (tripId: number, userId: number) =>
    apiFetch<void>(`/trips/${tripId}/editors`, {
      method: "POST",
      body: { user_id: userId },
    }),
  removeEditor: (tripId: number, userId: number) =>
    apiFetch<void>(`/trips/${tripId}/editors/${userId}`, { method: "DELETE" }),

  listAssets: (
    tripId: number,
    opts: { cursor?: number; limit?: number } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.cursor) qs.set("cursor", String(opts.cursor));
    if (opts.limit) qs.set("limit", String(opts.limit));
    const tail = qs.toString() ? `?${qs}` : "";
    return apiFetch<AssetPage>(`/trips/${tripId}/assets${tail}`);
  },
  listAssetIDs: (tripId: number) =>
    apiFetch<number[]>(`/trips/${tripId}/asset-ids`),
  uploadPolicy: (
    body: { trip_id: number; filename: string; mime: string; kind: string },
    bearer?: string,
  ) =>
    apiFetch<UploadPolicy>("/upload/policy", { method: "POST", body, bearer }),
  uploadComplete: (body: {
    trip_id: number;
    oss_key: string;
    kind: string;
    mime: string;
    size: number;
    width?: number;
    height?: number;
    duration_ms?: number;
    taken_at?: string;
    is_live_photo?: boolean;
    motion_oss_key?: string;
    motion_mime?: string;
  },
  bearer?: string,
  ) => apiFetch<Asset>("/upload/complete", { method: "POST", body, bearer }),
  deleteAsset: (id: number) => apiFetch<void>(`/assets/${id}`, { method: "DELETE" }),
  reorderAssets: (tripId: number, ordered: number[]) =>
    apiFetch<void>(`/trips/${tripId}/assets/reorder`, {
      method: "POST",
      body: { ordered_asset_ids: ordered },
    }),

  // ---- shares ----
  listShares: (tripId: number) => apiFetch<Share[]>(`/trips/${tripId}/shares`),
  createShare: (
    tripId: number,
    body: {
      note?: string;
      max_uses?: number;
      expires_at?: string;
      disable_forward?: boolean;
    },
  ) => apiFetch<ShareCreated>(`/trips/${tripId}/shares`, { method: "POST", body }),
  createMultiShare: (body: {
    trip_ids: number[];
    note?: string;
    max_uses?: number;
    expires_at?: string;
    disable_forward?: boolean;
  }) => apiFetch<ShareCreated>("/shares/multi", { method: "POST", body }),
  revokeShare: (id: number, cascade = false) =>
    apiFetch<{ revoked_ids: number[] }>(
      `/shares/${id}/revoke${cascade ? "?cascade=true" : ""}`,
      { method: "POST" },
    ),
  shareStats: (id: number) => apiFetch<ShareStats>(`/shares/${id}/stats`),
  shareTree: (id: number) => apiFetch<ShareTreeNode>(`/shares/${id}/tree`),

  // ---- public (no auth header; relies on share session cookie) ----
  authShare: (code: string, password: string) =>
    apiFetch<{
      share_id: number;
      trip_id: number;
      scope: string;
      expires_in_seconds: number;
    }>(`/public/shares/${code}/auth`, { method: "POST", body: { password } }),
  publicScope: () =>
    apiFetch<{
      scope: string;
      trip_id?: number;
      title?: string;
      subtitle?: string;
      share_note?: string;
      assets?: PublicAsset[];
      next_cursor?: number | null;
      total?: number;
      trips?: PublicTripSummary[];
    }>("/public/scope"),
  publicTripScope: (tripID: number) =>
    apiFetch<{
      scope: string;
      trip_id: number;
      title: string;
      subtitle?: string;
      share_note?: string;
      assets: PublicAsset[];
      next_cursor?: number | null;
      total?: number;
    }>(`/public/trips/${tripID}`),
  publicNextAssets: (opts: {
    cursor: number;
    limit?: number;
    tripID?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set("cursor", String(opts.cursor));
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.tripID) qs.set("trip_id", String(opts.tripID));
    return apiFetch<PublicAssetPage>(`/public/assets?${qs}`);
  },
  publicAssetURL: (id: number, variant: AssetURLVariant) =>
    apiFetch<{ url: string; variant: string; hls_status?: string }>(
      `/public/assets/${id}/url?variant=${variant}`,
    ),
  adminAssetURL: (id: number, variant: AssetURLVariant) =>
    apiFetch<{ url: string; variant: string; hls_status?: string }>(
      `/assets/${id}/url?variant=${variant}`,
    ),
  publicForward: (body: { note?: string; disable_forward?: boolean }) =>
    apiFetch<{ code: string; password: string; url: string }>("/public/forward", {
      method: "POST",
      body,
    }),
  publicLogout: () => apiFetch<void>("/public/logout", { method: "POST" }),

  // ---- collections ----
  listCollections: (tripId: number) =>
    apiFetch<Collection[]>(`/trips/${tripId}/collections`),
  createCollection: (
    tripId: number,
    body: { title: string; description?: string; asset_ids?: number[] },
  ) => apiFetch<Collection>(`/trips/${tripId}/collections`, { method: "POST", body }),
  getCollection: (id: number) => apiFetch<Collection>(`/collections/${id}`),
  updateCollection: (id: number, body: { title?: string; description?: string }) =>
    apiFetch<void>(`/collections/${id}`, { method: "PATCH", body }),
  deleteCollection: (id: number) =>
    apiFetch<void>(`/collections/${id}`, { method: "DELETE" }),
  setCollectionAssets: (id: number, asset_ids: number[]) =>
    apiFetch<void>(`/collections/${id}/assets`, { method: "POST", body: { asset_ids } }),
  listCollectionShares: (id: number) =>
    apiFetch<Share[]>(`/collections/${id}/shares`),
  createCollectionShare: (
    id: number,
    body: {
      note?: string;
      max_uses?: number;
      expires_at?: string;
      disable_forward?: boolean;
    },
  ) => apiFetch<ShareCreated>(`/collections/${id}/shares`, { method: "POST", body }),

  // ---- public comments / danmaku ----
  publicListComments: (target_type: "trip" | "asset", target_id: number) =>
    apiFetch<Comment[]>(
      `/public/comments?target_type=${target_type}&target_id=${target_id}`,
    ),
  publicPostComment: (body: {
    target_type: "trip" | "asset";
    target_id: number;
    display_name: string;
    content: string;
    color?: string;
    video_time_ms?: number;
  }) => apiFetch<Comment>("/public/comments", { method: "POST", body }),

  // ---- admin comments ----
  adminListComments: (trip_id?: number, include_hidden = false) =>
    apiFetch<Comment[]>(
      `/admin/comments?` +
        (trip_id ? `trip_id=${trip_id}&` : "") +
        (include_hidden ? "include_hidden=1" : ""),
    ),
  adminHideComment: (id: number) =>
    apiFetch<void>(`/admin/comments/${id}/hide`, { method: "POST" }),
  adminUnhideComment: (id: number) =>
    apiFetch<void>(`/admin/comments/${id}/unhide`, { method: "POST" }),
  adminEditComment: (id: number, body: { content?: string; display_name?: string }) =>
    apiFetch<void>(`/admin/comments/${id}`, { method: "PATCH", body }),

  // ---- single-asset share + share info ----
  shareInfo: (code: string) => apiFetch<ShareInfo>(`/public/shares/${code}/info`),
  createAssetShare: (
    assetID: number,
    body: { note?: string; expires_at?: string; disable_forward?: boolean },
  ) => apiFetch<ShareCreated>(`/assets/${assetID}/share`, { method: "POST", body }),

  // ---- exif ----
  publicAssetEXIF: (id: number) => apiFetch<Record<string, unknown>>(`/public/assets/${id}/exif`),
  assetExif: (id: number) => apiFetch<Record<string, unknown>>(`/assets/${id}/exif`),

  // ---- admin settings ----
  adminGetSettings: () => apiFetch<AppSettings>("/admin/settings"),
  adminUpdateSetting: (key: string, value: string) =>
    apiFetch<Record<string, string>>("/admin/settings", {
      method: "PATCH",
      body: { key, value },
    }),

  // ---- upload grants ----
  createUploadGrant: (
    tripId: number,
    body: { note?: string; hours_ttl?: number; expires_at?: string },
  ) => apiFetch<UploadGrantCreated>(`/trips/${tripId}/upload-grants`, { method: "POST", body }),
  listUploadGrants: (tripId: number) =>
    apiFetch<UploadGrant[]>(`/trips/${tripId}/upload-grants`),
  revokeUploadGrant: (id: number) =>
    apiFetch<void>(`/upload-grants/${id}`, { method: "DELETE" }),
  uploadGrantInfo: (code: string) =>
    apiFetch<{ trip_id: number; trip_title: string; status: string }>(
      `/upload-grants/${code}/info`,
      { bearer: null },
    ),
  consumeUploadGrant: (code: string, token: string) =>
    apiFetch<{
      upload_token: string;
      expires_at: string;
      trip_id: number;
      trip_title: string;
    }>(`/upload-grants/${code}/consume`, {
      method: "POST",
      body: { token },
      bearer: null,
    }),

  // ---- passkeys ----
  listMyPasskeys: () => apiFetch<Passkey[]>("/passkeys"),
  deletePasskey: (id: number) =>
    apiFetch<void>(`/passkeys/${id}`, { method: "DELETE" }),
  passkeyRegisterStart: (name?: string) =>
    apiFetch<PublicKeyCredentialCreationOptionsJSON>(
      "/passkeys/register/start",
      { method: "POST", body: { name } },
    ),
  passkeyRegisterFinish: (cred: unknown) =>
    apiFetch<void>("/passkeys/register/finish", { method: "POST", body: cred }),
  passkeyLoginStart: (username?: string) =>
    apiFetch<PublicKeyCredentialRequestOptionsJSON>(
      "/passkeys/login/start",
      { method: "POST", body: { username }, bearer: null },
    ),
  passkeyLoginFinish: (cred: unknown) =>
    apiFetch<{ token: string; expires_at: string; user: User }>(
      "/passkeys/login/finish",
      { method: "POST", body: cred, bearer: null },
    ),

  // ---- password / 2FA ----
  changePassword: (body: { current_password: string; new_password: string }) =>
    apiFetch<void>("/auth/password", { method: "POST", body }),
  loginTOTP: (challenge_token: string, code: string) =>
    apiFetch<{ token: string; expires_at: string; user: User }>(
      "/auth/login/totp",
      { method: "POST", body: { challenge_token, code }, bearer: null },
    ),
  totpSetup: () =>
    apiFetch<{ secret: string; otpauth_uri: string }>("/auth/totp/setup", {
      method: "POST",
    }),
  totpEnable: (code: string) =>
    apiFetch<void>("/auth/totp/enable", { method: "POST", body: { code } }),
  totpDisable: (password: string) =>
    apiFetch<void>("/auth/totp/disable", { method: "POST", body: { password } }),

  // ---- upload knobs (public read-only) ----
  uploadLimits: () =>
    apiFetch<{ concurrency: number }>("/upload-limits", { bearer: null }),
};

export type UploadGrant = {
  id: number;
  trip_id: number;
  trip_title?: string;
  code: string;
  url: string;
  note?: string;
  created_by_user_id: number;
  expires_at: string;
  consumed_at?: string;
  revoked_at?: string;
  created_at: string;
};
export type UploadGrantCreated = UploadGrant & { token: string };

export type Passkey = {
  id: number;
  name: string;
  created_at: string;
  last_used_at?: string;
};

// Browser WebAuthn shapes are large; reuse DOM types.
type PublicKeyCredentialCreationOptionsJSON = unknown;
type PublicKeyCredentialRequestOptionsJSON = unknown;

export type Share = {
  id: number;
  scope: string;
  trip_id: number;
  collection_id?: number;
  asset_id?: number;
  code: string;
  url: string;
  note?: string;
  parent_share_id?: number;
  created_by_user_id?: number;
  max_uses?: number;
  expires_at?: string;
  revoked_at?: string;
  disable_forward?: boolean;
  created_at: string;
};

export type ShareCreated = Share & { password: string };

export type ShareStats = {
  share_id: number;
  visits: number;
  unique_ips: number;
  asset_views: number;
  child_share_count: number;
  top_assets: { asset_id: number; views: number }[];
  recent_visits: {
    id: number;
    ip: string;
    ua: string;
    country?: string;
    referer?: string;
    visited_at: string;
  }[];
};

export type ShareTreeNode = {
  id: number;
  code: string;
  parent_share_id?: number;
  created_by_user_id?: number;
  creator_visit_id?: number;
  note?: string;
  revoked_at?: string;
  created_at: string;
  children?: ShareTreeNode[];
};

export type PublicAsset = {
  id: number;
  kind: "photo" | "video";
  width?: number;
  height?: number;
  duration_ms?: number;
  hls_status?: string;
  is_live_photo?: boolean;
  view_count?: number;
  urls: AssetURLs;
};

export type ShareInfo = {
  scope: "trip" | "collection" | "asset";
  trip_id: number;
  asset_id?: number;
  requires_password: boolean;
  note?: string;
};

export type AppSettings = {
  effective: Record<string, string>;
  raw: Record<string, string>;
  defaults: Record<string, string>;
};

export type Collection = {
  id: number;
  trip_id: number;
  title: string;
  description: string;
  asset_count: number;
  asset_ids?: number[];
  created_by_id: number;
  created_at: string;
};

export type Comment = {
  id: number;
  target_type: "trip" | "asset";
  target_id: number;
  display_name: string;
  content: string;
  color?: string;
  video_time_ms?: number;
  user_id?: number;
  is_admin: boolean;
  hidden_at?: string;
  edited_at?: string;
  created_at: string;
};
