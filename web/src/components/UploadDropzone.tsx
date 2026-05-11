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
  thumbURL?: string;        // blob: URL for preview (revoked on unmount)
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
  const main = g.photo ?? g.video!;
  const isVideo = !!g.video;
  const label = (g.photo?.name ?? g.video?.name ?? "") +
    (g.motion ? " ⚡ (Live Photo)" : "");
  let thumbURL: string | undefined;
  // Photo: blob URL works directly. Video: blob URL on <video> with
  // preload=metadata also works as poster.
  if (main && (main.type.startsWith("image/") || main.type.startsWith("video/"))) {
    thumbURL = URL.createObjectURL(main);
  }
  return {
    id: uuid(),
    label,
    progress: 0,
    status: "pending",
    livePhoto: !!(g.photo && g.motion),
    thumbURL,
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

  // Revoke blob URLs on unmount.
  useEffect(() => {
    return () => {
      for (const t of tasksRef.current) {
        if (t.thumbURL) URL.revokeObjectURL(t.thumbURL);
      }
    };
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
    setTasks((cur) => {
      for (const t of cur) {
        if (t.status === "done" && t.thumbURL) URL.revokeObjectURL(t.thumbURL);
      }
      return cur.filter((t) => t.status !== "done");
    });
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

          <ul className="space-y-2">
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
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-2 text-sm dark:border-zinc-800 dark:bg-zinc-950",
        task.status === "error" && "border-rose-300 dark:border-rose-900",
        task.status === "done" && "border-emerald-300 dark:border-emerald-900/50",
      )}
    >
      <Thumbnail task={task} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm" title={task.label}>
            {task.label}
          </span>
          <span className="shrink-0 text-xs text-zinc-500">
            {statusLabel(task)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={cn("h-full transition-all", tone)}
            style={{ width: `${Math.round(task.progress * 100)}%` }}
          />
        </div>
        {task.status === "error" && task.error && (
          <p className="break-words text-xs text-rose-600" title={task.error}>
            {task.error.slice(0, 200)}
          </p>
        )}
      </div>
      {task.status === "error" && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
        >
          重试
        </button>
      )}
    </li>
  );
}

function Thumbnail({ task }: { task: Task }) {
  const size = "h-12 w-12";
  if (!task.thumbURL) {
    return (
      <div
        className={cn(
          size,
          "flex shrink-0 items-center justify-center rounded-md bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800",
        )}
      >
        {task.isVideo ? "🎬" : "📄"}
      </div>
    );
  }
  if (task.isVideo) {
    return (
      <div className={cn(size, "relative shrink-0 overflow-hidden rounded-md bg-black")}>
        <video
          src={task.thumbURL}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 text-[10px] text-white">
          ▶
        </span>
      </div>
    );
  }
  return (
    <img
      src={task.thumbURL}
      alt=""
      className={cn(
        size,
        "shrink-0 rounded-md object-cover ring-1 ring-zinc-200 dark:ring-zinc-800",
      )}
    />
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

function postToOSS(
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

    const xhr = new XMLHttpRequest();
    xhr.open("POST", policy.host, true);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`OSS ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error("网络错误（OSS bucket 是否配了 CORS？）"));
    xhr.send(fd);
  });
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
