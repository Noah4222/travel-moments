import { useEffect, useState } from "react";
import QRCodeLib from "qrcode";
import { api, type AppSettings, type Passkey, type User } from "@/lib/api";
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
          Passkey 登录默认跳过两步验证。
        </p>
        <PasskeysSection />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          账号安全
        </h2>
        <ChangePasswordSection />
        <TOTPSection />
      </section>
    </div>
  );
}

function ChangePasswordSection() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await api.changePassword({ current_password: cur, new_password: next });
      setMsg("密码已更新");
      setCur("");
      setNext("");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-medium">修改密码</h3>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>当前密码</Label>
          <Input
            type="password"
            autoComplete="current-password"
            value={cur}
            onChange={(e) => setCur(e.target.value)}
          />
        </div>
        <div>
          <Label>新密码（至少 8 位）</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            minLength={8}
          />
        </div>
        <div className="sm:col-span-2">
          {msg && <p className="mb-2 text-sm text-emerald-600">{msg}</p>}
          {err && <p className="mb-2 text-sm text-rose-600">{err}</p>}
          <Button
            type="submit"
            disabled={busy || !cur || next.length < 8}
            size="sm"
          >
            {busy ? "保存中…" : "保存新密码"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TOTPSection() {
  const [me, setMe] = useState<User | null>(null);
  const [setupData, setSetupData] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [disablePw, setDisablePw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    try {
      setMe(await api.me());
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    reload();
  }, []);

  async function beginSetup() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.totpSetup();
      setSetupData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable() {
    setBusy(true);
    setErr(null);
    try {
      await api.totpEnable(code.trim());
      setSetupData(null);
      setCode("");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!disablePw) return;
    setBusy(true);
    setErr(null);
    try {
      await api.totpDisable(disablePw);
      setDisablePw("");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <Card className="p-4 text-sm text-zinc-500">加载中…</Card>;

  if (me.totp_enabled) {
    return (
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">两步验证 (TOTP)</h3>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            已启用
          </span>
        </div>
        <p className="text-xs text-zinc-500">
          密码登录时会要求验证器中的 6 位代码。Passkey 登录不需要。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            placeholder="输入当前密码以禁用"
            value={disablePw}
            onChange={(e) => setDisablePw(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button
            size="sm"
            variant="danger"
            onClick={disable}
            disabled={busy || !disablePw}
          >
            {busy ? "处理中…" : "禁用 2FA"}
          </Button>
        </div>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-medium">两步验证 (TOTP)</h3>
      <p className="text-xs text-zinc-500">
        启用后，密码登录时会增加一步 6 位代码验证（用 Google Authenticator / 1Password / Bitwarden 等都可）。
      </p>
      {!setupData ? (
        <Button size="sm" onClick={beginSetup} disabled={busy}>
          {busy ? "生成中…" : "启用 2FA"}
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            用验证器扫描下方二维码，或手动添加密钥：
          </p>
          <QRCode value={setupData.otpauth_uri} />
          <div className="rounded bg-zinc-100 p-2 text-center font-mono text-xs dark:bg-zinc-900">
            {setupData.secret}
          </div>
          <div>
            <Label>验证器中的 6 位代码</Label>
            <Input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center text-lg tracking-widest"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={confirmEnable}
              disabled={busy || code.length !== 6}
            >
              {busy ? "验证中…" : "确认启用"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSetupData(null);
                setCode("");
              }}
              disabled={busy}
            >
              取消
            </Button>
          </div>
        </div>
      )}
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </Card>
  );
}

function QRCode({ value }: { value: string }) {
  const [dataURL, setDataURL] = useState<string | null>(null);
  useEffect(() => {
    QRCodeLib.toDataURL(value, { width: 220, margin: 1 })
      .then(setDataURL)
      .catch(() => setDataURL(null));
  }, [value]);
  if (!dataURL) {
    return (
      <div className="flex h-[220px] items-center justify-center text-xs text-zinc-400">
        生成二维码…
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <img
        src={dataURL}
        alt="otpauth QR"
        width={220}
        height={220}
        className="rounded bg-white p-2"
      />
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
