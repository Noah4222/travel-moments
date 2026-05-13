import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { api, type UploadPolicy } from "@/lib/api";
import { shrinkForOSS } from "@/lib/imageCompress";
import { Button } from "./ui";
import { cn } from "@/lib/cn";

/**
 * Run `fn` over `items` with at most `n` running at a time. Errors thrown
 * by `fn` are NOT rethrown — the caller is expected to record the failure
 * on the task and continue with the rest.
 */
async function withConcurrency<T>(
  items: T[],
  n: number,
  fn: (item: T, index: number) => Promise<void>,
) {
  const limit = Math.max(1, Math.min(n, items.length));
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await fn(items[i], i);
      } catch {
        /* swallowed — fn is expected to surface errors via updateTask */
      }
    }
  });
  await Promise.all(workers);
}

type Group = {
  photo?: File;
  motion?: File; // paired short MOV → live photo
  video?: File;  // standalone video
};

type Task = {
  id: string;
  label: string;
  progress: number;
  status: "pending" | "uploading" | "registering" | "done" | "error";
  error?: string;
  livePhoto: boolean;
  isVideo: boolean;
  group: Group;             // original file refs, kept for retry
};

function basename(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

// crypto.randomUUID is only available in secure contexts (https/localhost).
// Fall back to a UUID-shaped hex when running over plain http (e.g. LAN).
function uuid() {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function groupFiles(files: File[]): Group[] {
  const map = new Map<string, { photo?: File; motion?: File }>();
  const extras: File[] = [];
  for (const f of files) {
    const base = basename(f.name);
    const isImage = f.type.startsWith("image/") || /\.heic$/i.test(f.name);
    const isVideo = f.type.startsWith("video/");
    if (!isImage && !isVideo) continue;
    const cur = map.get(base) || {};
    if (isImage && !cur.photo) cur.photo = f;
    else if (isVideo && !cur.motion) cur.motion = f;
    else extras.push(f);
    map.set(base, cur);
  }
  const groups: Group[] = [];
  for (const cur of map.values()) {
    if (cur.photo && cur.motion) groups.push({ photo: cur.photo, motion: cur.motion });
    else if (cur.photo) groups.push({ photo: cur.photo });
    else if (cur.motion) groups.push({ video: cur.motion });
  }
  for (const f of extras) {
    if (f.type.startsWith("video/")) groups.push({ video: f });
    else groups.push({ photo: f });
  }
  return groups;
}

function makeTask(g: Group): Task {
  const isVideo = !!g.video;
  const label = (g.photo?.name ?? g.video?.name ?? "") +
    (g.motion ? " ⚡ (Live Photo)" : "");
  return {
    id: uuid(),
    label,
    progress: 0,
    status: "pending",
    livePhoto: !!(g.photo && g.motion),
    isVideo,
    group: g,
  };
}

export function UploadDropzone({
  tripId,
  onUploaded,
  bearer,
}: {
  tripId: number;
  onUploaded: () => void;
  /** Override auth token (e.g. one-shot upload-grant JWT). */
  bearer?: string;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;

  const [dragOver, setDragOver] = useState(false);
  const [concurrency, setConcurrency] = useState(5);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.uploadLimits().then((r) => {
      if (r.concurrency > 0) setConcurrency(r.concurrency);
    }).catch(() => {
      /* fall back to default 5 */
    });
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const runTask = useCallback(
    async (t: Task) => {
      try {
        await uploadGroup(tripId, t.group, t.id, updateTask, bearer);
        onUploaded();
      } catch (err) {
        updateTask(t.id, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [tripId, updateTask, onUploaded, bearer],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const groups = groupFiles(Array.from(files));
      const newTasks = groups.map(makeTask);
      setTasks((cur) => [...cur, ...newTasks]);
      await withConcurrency(newTasks, concurrency, runTask);
    },
    [concurrency, runTask],
  );

  const retryOne = useCallback(
    (id: string) => {
      const t = tasksRef.current.find((x) => x.id === id);
      if (!t) return;
      updateTask(id, { status: "pending", progress: 0, error: undefined });
      void runTask({ ...t, status: "pending", progress: 0, error: undefined });
    },
    [runTask, updateTask],
  );

  const retryAllFailed = useCallback(() => {
    const failed = tasksRef.current.filter((t) => t.status === "error");
    if (failed.length === 0) return;
    failed.forEach((t) =>
      updateTask(t.id, { status: "pending", progress: 0, error: undefined }),
    );
    void withConcurrency(failed, concurrency, runTask);
  }, [concurrency, runTask, updateTask]);

  const clearDone = useCallback(() => {
    setTasks((cur) => cur.filter((t) => t.status !== "done"));
  }, []);

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }
  function onChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) handleFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = "";
  }

  const counts = useMemo(() => {
    let done = 0, error = 0, pending = 0;
    for (const t of tasks) {
      if (t.status === "done") done++;
      else if (t.status === "error") error++;
      else pending++;
    }
    return { done, error, pending, total: tasks.length };
  }, [tasks]);

  return (
    <div className="space-y-3">
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 px-6 py-10 text-center transition dark:border-zinc-700",
          dragOver && "border-zinc-500 bg-zinc-50 dark:border-zinc-400 dark:bg-zinc-900",
        )}
      >
        <p className="mb-3 text-sm text-zinc-500">拖拽照片 / 视频到这里，或</p>
        <Button onClick={() => inputRef.current?.click()}>选择文件</Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*,.heic"
          className="hidden"
          onChange={onChange}
        />
        <p className="mt-3 text-xs text-zinc-400">
          直接上传到 OSS · 同名 photo + mov 自动识别为实况图片 ⚡
        </p>
      </div>

      {tasks.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <span>
              共 {counts.total} 项 · 完成 {counts.done}
              {counts.error > 0 && (
                <span className="ml-1 text-rose-600">· 失败 {counts.error}</span>
              )}
              {counts.pending > 0 && <span className="ml-1">· 进行中 {counts.pending}</span>}
            </span>
            <div className="flex gap-1.5">
              {counts.error > 0 && (
                <Button size="sm" variant="outline" onClick={retryAllFailed}>
                  重试所有失败 ({counts.error})
                </Button>
              )}
              {counts.done > 0 && (
                <Button size="sm" variant="ghost" onClick={clearDone}>
                  清除已完成
                </Button>
              )}
            </div>
          </div>

          <ul className="space-y-1.5">
            {tasks.map((t) => (
              <UploadRow key={t.id} task={t} onRetry={() => retryOne(t.id)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function UploadRow({ task, onRetry }: { task: Task; onRetry: () => void }) {
  const tone =
    task.status === "error"
      ? "bg-rose-500"
      : task.status === "done"
        ? "bg-emerald-500"
        : "bg-zinc-700 dark:bg-zinc-300";
  // No thumbnails: a 100-item list with <img>/<video> blob: URLs trashes mobile
  // scroll. Show file kind + name + a thin progress bar instead.
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm [content-visibility:auto] [contain-intrinsic-size:48px] dark:border-zinc-800 dark:bg-zinc-950",
        task.status === "error" && "border-rose-300 dark:border-rose-900",
        task.status === "done" && "border-emerald-300 dark:border-emerald-900/50",
      )}
    >
      <span
        aria-hidden
        className="shrink-0 text-base leading-none"
        title={task.isVideo ? "视频" : task.livePhoto ? "Live Photo" : "图片"}
      >
        {task.isVideo ? "🎬" : task.livePhoto ? "⚡" : "📷"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate" title={task.label}>
            {task.label}
          </span>
          <span className="shrink-0 text-xs text-zinc-500">
            {statusLabel(task)}
          </span>
        </div>
        {task.status !== "done" && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className={cn("h-full transition-[width]", tone)}
              style={{ width: `${Math.round(task.progress * 100)}%` }}
            />
          </div>
        )}
        {task.status === "error" && task.error && (
          <p className="mt-1 break-words text-xs text-rose-600" title={task.error}>
            {task.error.slice(0, 200)}
          </p>
        )}
      </div>
      {task.status === "error" && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-rose-300 px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
        >
          重试
        </button>
      )}
    </li>
  );
}

function statusLabel(t: Task) {
  if (t.status === "error") return "失败";
  if (t.status === "done") return "完成";
  if (t.status === "registering") return "登记中…";
  if (t.status === "uploading") return `${Math.round(t.progress * 100)}%`;
  return "等待";
}

async function uploadGroup(
  tripId: number,
  g: Group,
  taskID: string,
  update: (id: string, patch: Partial<Task>) => void,
  bearer?: string,
) {
  if (g.video && !g.photo) {
    await uploadOne(tripId, g.video, "video", taskID, update, bearer);
    return;
  }
  if (!g.photo) return;

  if (g.motion) {
    update(taskID, { status: "uploading", progress: 0.02 });
    const photoFile = (await shrinkForOSS(g.photo)).file;
    const [photoRes, motionRes] = await Promise.all([
      uploadRawFile(tripId, photoFile, "photo", (p) =>
        update(taskID, { progress: 0.02 + p * 0.45 }),
        bearer,
      ),
      uploadRawFile(tripId, g.motion, "video", (p) =>
        update(taskID, { progress: 0.48 + p * 0.45 }),
        bearer,
      ),
    ]);
    const dims = await readImageDimsSafe(photoFile);
    update(taskID, { status: "registering", progress: 0.97 });
    await api.uploadComplete({
      trip_id: tripId,
      oss_key: photoRes.oss_key,
      kind: "photo",
      mime: photoFile.type,
      size: photoFile.size,
      width: dims?.width,
      height: dims?.height,
      is_live_photo: true,
      motion_oss_key: motionRes.oss_key,
      motion_mime: g.motion.type,
    }, bearer);
    update(taskID, { status: "done", progress: 1 });
    return;
  }

  await uploadOne(tripId, g.photo, "photo", taskID, update, bearer);
}

async function uploadOne(
  tripId: number,
  file: File,
  kind: "photo" | "video",
  taskID: string,
  update: (id: string, patch: Partial<Task>) => void,
  bearer?: string,
) {
  // Photos > 20MB break OSS image processing; shrink them in the browser
  // before upload. Videos pass through.
  let uploadFile = file;
  if (kind === "photo") {
    const shrunk = await shrinkForOSS(file);
    uploadFile = shrunk.file;
  }
  const policy = await api.uploadPolicy({
    trip_id: tripId,
    filename: uploadFile.name,
    mime: uploadFile.type,
    kind,
  }, bearer);
  update(taskID, { status: "uploading", progress: 0.02 });
  await postToOSS(policy, uploadFile, (p) => update(taskID, { progress: p }));

  let width: number | undefined,
    height: number | undefined,
    durationMs: number | undefined;
  if (kind === "photo") {
    const dims = await readImageDimsSafe(uploadFile);
    width = dims?.width;
    height = dims?.height;
  } else {
    const m = await readVideoMetaSafe(uploadFile);
    if (m) {
      width = m.width;
      height = m.height;
      durationMs = Math.round(m.duration * 1000);
    }
  }
  update(taskID, { status: "registering", progress: 0.99 });
  await api.uploadComplete({
    trip_id: tripId,
    oss_key: policy.oss_key,
    kind,
    mime: uploadFile.type,
    size: uploadFile.size,
    width,
    height,
    duration_ms: durationMs,
  }, bearer);
  update(taskID, { status: "done", progress: 1 });
}

async function uploadRawFile(
  tripId: number,
  file: File,
  kind: "photo" | "video",
  onProgress: (p: number) => void,
  bearer?: string,
) {
  const policy = await api.uploadPolicy({
    trip_id: tripId,
    filename: file.name,
    mime: file.type,
    kind,
  }, bearer);
  await postToOSS(policy, file, onProgress);
  return policy;
}

// postToOSSOnce is one upload attempt. postToOSS wraps it with one retry so
// transient mobile-network drops don't surface as a hard failure to the user.
function postToOSSOnce(
  policy: UploadPolicy,
  file: File,
  onProgress: (p: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("key", policy.key);
    fd.append("OSSAccessKeyId", policy.access_key_id);
    fd.append("policy", policy.policy);
    fd.append("signature", policy.signature);
    fd.append("success_action_status", policy.success_action_status);
    fd.append("Content-Type", file.type || "application/octet-stream");
    if (policy.cache_control) {
      fd.append("Cache-Control", policy.cache_control);
    }
    fd.append("file", file);

    const fileInfo = `${file.name} (${file.type || "?"}, ${file.size}B)`;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", policy.host, true);
    // 5 minutes per file — enough for 50 MB on 3G, but not infinite.
    xhr.timeout = 5 * 60 * 1000;
    let lastProgress = 0;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        lastProgress = e.loaded / e.total;
        onProgress(lastProgress);
      }
    };
    // upload.onerror can carry a separate signal vs the overall xhr.onerror
    // — log it independently so we don't miss it.
    xhr.upload.onerror = () => {
      console.error("[upload] xhr.upload.onerror", { file: fileInfo, host: policy.host });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      const body = (xhr.responseText || "").trim();
      const msg = extractOSSError(body) || body.slice(0, 200);
      console.error("[upload] OSS rejected", {
        status: xhr.status,
        statusText: xhr.statusText,
        body: body.slice(0, 800),
        file: fileInfo,
        host: policy.host,
        key: policy.key,
      });
      const err = new Error(`OSS ${xhr.status}: ${msg || xhr.statusText}`) as Error & {
        transient?: boolean;
      };
      err.transient =
        xhr.status === 408 || xhr.status === 429 || xhr.status >= 500;
      reject(err);
    };
    xhr.onerror = () => {
      console.error("[upload] xhr.onerror", {
        readyState: xhr.readyState,
        status: xhr.status,
        statusText: xhr.statusText,
        progress: lastProgress,
        file: fileInfo,
        host: policy.host,
        online: typeof navigator !== "undefined" ? navigator.onLine : null,
      });
      const tail =
        lastProgress > 0 && lastProgress < 1
          ? `（已传 ${Math.round(lastProgress * 100)}%）`
          : "（连接还没开始）";
      const err = new Error(
        diagnoseNetworkError(`上传中断 ${tail}`),
      ) as Error & { transient?: boolean };
      err.transient = true;
      reject(err);
    };
    xhr.ontimeout = () => {
      console.error("[upload] xhr.ontimeout", { file: fileInfo, progress: lastProgress });
      const err = new Error("上传超时（>5 分钟）— 网络太慢或卡住，请重试") as Error & {
        transient?: boolean;
      };
      err.transient = true;
      reject(err);
    };
    xhr.onabort = () => {
      const err = new Error("上传被浏览器中止（切后台 / 关页面？）") as Error & {
        transient?: boolean;
      };
      err.transient = true;
      reject(err);
    };
    xhr.send(fd);
  });
}

async function postToOSS(
  policy: UploadPolicy,
  file: File,
  onProgress: (p: number) => void,
): Promise<void> {
  try {
    await postToOSSOnce(policy, file, onProgress);
  } catch (e) {
    const isTransient = (e as { transient?: boolean }).transient === true;
    if (!isTransient) throw e;
    // One free retry with a short backoff. Reset progress so the bar
    // restarts cleanly and the user sees the second attempt happening.
    onProgress(0);
    await sleep(800);
    await postToOSSOnce(policy, file, onProgress);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// extractOSSError pulls the <Message> body out of an OSS XML error response so
// the user sees `AccessDenied: Access denied by bucket policy.` instead of a
// 200-char XML blob.
function extractOSSError(body: string): string {
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
  const msg = /<Message>([^<]+)<\/Message>/.exec(body)?.[1];
  if (code && msg) return `${code}: ${msg}`;
  if (msg) return msg;
  return "";
}

// diagnoseNetworkError augments xhr.onerror's empty event with whatever
// context the browser exposes — connection type, online state — so it's not
// just an opaque "network error".
function diagnoseNetworkError(base: string): string {
  const bits: string[] = [base];
  if (typeof navigator !== "undefined") {
    if (navigator.onLine === false) bits.push("当前离线");
    const conn = (navigator as unknown as {
      connection?: { effectiveType?: string; downlink?: number };
    }).connection;
    if (conn?.effectiveType) bits.push(`网络：${conn.effectiveType}`);
  }
  return bits.join(" · ");
}

async function readImageDimsSafe(file: File) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function readVideoMetaSafe(file: File) {
  return new Promise<{ width: number; height: number; duration: number } | null>(
    (resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve({
          width: v.videoWidth,
          height: v.videoHeight,
          duration: v.duration,
        });
      };
      v.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      v.src = url;
    },
  );
}
