import { useEffect, useState } from "react";
import { api, type AppSettings, type Passkey } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";
import { ImageProcessEditor } from "@/components/ImageProcessEditor";
import { isPasskeySupported, registerPasskey } from "@/lib/passkey";

type RowDef = { key: string; label: string; desc: string };

const BASIC_ROWS: RowDef[] = [
  {
    key: "signed_url_ttl",
    label: "签名 URL 有效期",
    desc: "OSS GET URL Expires。默认 10m。例：10m / 30m / 2h",
  },
  {
    key: "signed_url_cache_ttl",
    label: "签名 URL 内存缓存",
    desc: "服务端 LRU 缓存同一签名 URL 的时间，应比上面短 1 分钟以上",
  },
  {
    key: "upload_cache_control",
    label: "上传 Cache-Control",
    desc: "新上传文件写入 OSS 的 Cache-Control。默认 public, max-age=31536000, immutable",
  },
  {
    key: "asset_share_default_ttl",
    label: "单图分享默认过期",
    desc: "通过「分享此图」生成的链接默认多久后失效。例：168h（7 天）",
  },
];

const IMAGE_ROWS: Array<{
  key: string;
  label: string;
  desc: string;
  format: "webp" | "avif";
}> = [
  {
    key: "image_process_thumb_webp",
    label: "缩略图（网格小图）",
    desc: "相册/分享页的网格缩略图。",
    format: "webp",
  },
  {
    key: "image_process_thumb_avif",
    label: "缩略图（网格小图）",
    desc: "支持 AVIF 的浏览器优先使用，体积更小。",
    format: "avif",
  },
  {
    key: "image_process_preview_webp",
    label: "Lightbox 大图预览",
    desc: "点开图片时显示的清晰大图。",
    format: "webp",
  },
  {
    key: "image_process_preview_avif",
    label: "Lightbox 大图预览",
    desc: "支持 AVIF 的浏览器优先使用。",
    format: "avif",
  },
  {
    key: "image_process_cover_webp",
    label: "相册集封面",
    desc: "相册列表大图横幅，建议尺寸 ≥ 1600，质量略高。",
    format: "webp",
  },
  {
    key: "image_process_cover_avif",
    label: "相册集封面",
    desc: "支持 AVIF 的浏览器优先使用。",
    format: "avif",
  },
];

export function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const r = await api.adminGetSettings();
    setS(r);
    setDrafts({ ...r.raw });
  }

  useEffect(() => {
    reload();
  }, []);

  async function saveRaw(key: string) {
    await save(key, drafts[key] || "");
  }
  async function save(key: string, value: string) {
    setBusy(key);
    setMsg(null);
    try {
      await api.adminUpdateSetting(key, value);
      setMsg("已保存");
      await reload();
    } catch (err) {
      setMsg("保存失败：" + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!s) return <p className="text-zinc-500">加载中…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">系统设置</h1>
        <p className="text-sm text-zinc-500">
          改动立即生效，写入数据库覆盖 .env 默认值。
        </p>
      </div>

      {msg && <p className="text-sm text-emerald-600">{msg}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          签名 URL / 缓存
        </h2>
        {BASIC_ROWS.map((row) => (
          <Card key={row.key} className="p-4">
            <Label>{row.label}</Label>
            <p className="mb-2 text-xs text-zinc-500">{row.desc}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={drafts[row.key] ?? ""}
                placeholder={`默认：${s.defaults[row.key] ?? ""}`}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [row.key]: e.target.value }))
                }
                className="min-w-0 flex-1"
              />
              <Button
                size="sm"
                disabled={busy === row.key}
                onClick={() => saveRaw(row.key)}
              >
                {busy === row.key ? "…" : "保存"}
              </Button>
            </div>
            <p className="mt-2 break-all text-xs text-zinc-400">
              当前生效：<code className="font-mono">{s.effective[row.key]}</code>
            </p>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          图片处理参数
        </h2>
        <p className="-mt-2 text-xs text-zinc-500">
          下面的参数会拼成 OSS 图片处理字符串。调整宽度 / 质量 / 缩放模式，预览
          会实时显示最终的处理参数。
        </p>
        <div className="space-y-3">
          {IMAGE_ROWS.map((row) => (
            <ImageProcessEditor
              key={row.key}
              label={row.label}
              desc={row.desc}
              defaultFormat={row.format}
              effective={s.effective[row.key] ?? ""}
              draft={drafts[row.key] ?? ""}
              saving={busy === row.key}
              onSave={(next) => save(row.key, next)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Passkey
        </h2>
        <p className="-mt-2 text-xs text-zinc-500">
          注册 Passkey 后可以用 Touch ID / Windows Hello / 手机指纹替代密码登录。
        </p>
        <PasskeysSection />
      </section>
    </div>
  );
}

function PasskeysSection() {
  const [list, setList] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function reload() {
    try {
      setList(await api.listMyPasskeys());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      await registerPasskey(name || undefined);
      setName("");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isPasskeySupported()) {
    return (
      <Card className="p-4 text-sm text-zinc-500">
        这个浏览器不支持 WebAuthn / Passkey。请在 Chrome / Safari 上的 HTTPS（或 localhost）环境使用。
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label>新 Passkey 名称（可选）</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：iPhone / MacBook"
          />
        </div>
        <Button size="sm" onClick={add} disabled={busy}>
          {busy ? "请按提示…" : "注册新 Passkey"}
        </Button>
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {!list ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-zinc-500">还没有注册 Passkey</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {list.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900"
            >
              <span>
                <b>{k.name || "未命名"}</b>
                <span className="ml-2 text-xs text-zinc-500">
                  注册 {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at &&
                    `· 最近用 ${new Date(k.last_used_at).toLocaleDateString()}`}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!window.confirm(`删除 Passkey「${k.name || "未命名"}」？`)) return;
                  await api.deletePasskey(k.id);
                  reload();
                }}
              >
                删除
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
