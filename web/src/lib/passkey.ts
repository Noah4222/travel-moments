import { api } from "./api";

/**
 * WebAuthn helpers: convert the JSON challenges that the Go server returns
 * (base64url-encoded byte fields) into ArrayBuffers and back.
 */

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  s = s + "=".repeat(pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function preparePublicKey<T extends Record<string, unknown>>(opts: T): T {
  // Walk known byte-encoded fields. The Go webauthn library returns these as
  // base64url strings in JSON; the browser API wants ArrayBuffers.
  const o = JSON.parse(JSON.stringify(opts));
  if (typeof o.challenge === "string") o.challenge = b64urlToBytes(o.challenge);
  if (o.user && typeof o.user.id === "string") o.user.id = b64urlToBytes(o.user.id);
  if (Array.isArray(o.excludeCredentials)) {
    o.excludeCredentials = o.excludeCredentials.map((c: any) => ({
      ...c,
      id: typeof c.id === "string" ? b64urlToBytes(c.id) : c.id,
    }));
  }
  if (Array.isArray(o.allowCredentials)) {
    o.allowCredentials = o.allowCredentials.map((c: any) => ({
      ...c,
      id: typeof c.id === "string" ? b64urlToBytes(c.id) : c.id,
    }));
  }
  return o;
}

function credentialToJSON(cred: PublicKeyCredential): unknown {
  const r: any = cred.response;
  const out: any = {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToB64url(r.clientDataJSON),
    },
  };
  if (r.attestationObject) {
    out.response.attestationObject = bytesToB64url(r.attestationObject);
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bytesToB64url(r.authenticatorData);
  }
  if (r.signature) out.response.signature = bytesToB64url(r.signature);
  if (r.userHandle) out.response.userHandle = bytesToB64url(r.userHandle);
  if (typeof r.getTransports === "function") {
    out.response.transports = r.getTransports();
  }
  return out;
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.PublicKeyCredential &&
    !!navigator.credentials
  );
}

export async function registerPasskey(name?: string): Promise<void> {
  const opts = (await api.passkeyRegisterStart(name)) as any;
  console.debug("[passkey] register/start ->", {
    rpId: opts?.publicKey?.rp?.id ?? opts?.rp?.id,
    rpName: opts?.publicKey?.rp?.name ?? opts?.rp?.name,
    user: opts?.publicKey?.user?.name ?? opts?.user?.name,
    excludeCount: (opts?.publicKey?.excludeCredentials ?? opts?.excludeCredentials ?? []).length,
    locationHost: typeof window !== "undefined" ? window.location.host : "",
  });
  const publicKey = preparePublicKey(opts.publicKey ?? opts);
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential | null;
  } catch (e) {
    console.error("[passkey] navigator.credentials.create rejected:", e);
    throw friendlyWebAuthnError(e, "register");
  }
  if (!cred) throw new Error("Passkey 注册被取消");
  console.debug("[passkey] got attestation, finishing");
  await api.passkeyRegisterFinish(credentialToJSON(cred));
}

export async function loginWithPasskey(username?: string): Promise<{
  token: string;
  user: { id: number; username: string; role: string };
}> {
  const opts = (await api.passkeyLoginStart(username)) as any;
  const allow = opts?.publicKey?.allowCredentials ?? opts?.allowCredentials ?? [];
  console.debug("[passkey] login/start ->", {
    rpId: opts?.publicKey?.rpId ?? opts?.rpId,
    allowCount: allow.length,
    discoverable: allow.length === 0,
    userVerification: opts?.publicKey?.userVerification ?? opts?.userVerification,
    locationHost: typeof window !== "undefined" ? window.location.host : "",
  });
  const publicKey = preparePublicKey(opts.publicKey ?? opts);
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey,
    })) as PublicKeyCredential | null;
  } catch (e) {
    console.error("[passkey] navigator.credentials.get rejected:", e);
    throw friendlyWebAuthnError(e, "login", { hadAllowList: allow.length > 0 });
  }
  if (!cred) throw new Error("Passkey 登录被取消");
  console.debug("[passkey] got assertion, finishing");
  return api.passkeyLoginFinish(credentialToJSON(cred));
}

function friendlyWebAuthnError(
  e: unknown,
  op: "login" | "register",
  ctx: { hadAllowList?: boolean } = {},
): Error {
  if (!(e instanceof DOMException)) {
    return e instanceof Error ? e : new Error(String(e));
  }
  const verb = op === "login" ? "登录" : "注册";
  switch (e.name) {
    case "NotAllowedError": {
      // The umbrella WebAuthn error: cancel / timeout / no matching credential.
      const tips: string[] = [];
      if (op === "login") {
        if (!ctx.hadAllowList) {
          tips.push(
            "如果你没填用户名：当前账号可能没有「resident key」类型的 Passkey，试试填用户名再点 Passkey 登录",
          );
        }
        tips.push("检查是否在同一个域名/端口/协议下注册过 Passkey（IP 和域名互不相通）");
        tips.push("Touch ID / Windows Hello 弹出后请在 60 秒内完成验证，且不要点取消");
      } else {
        tips.push("等待 Touch ID / Windows Hello / 安全密钥验证完成，不要点取消");
        tips.push("如果同一个账号已经在该设备注册过 Passkey，浏览器可能拒绝重复注册");
      }
      return new Error(
        `Passkey ${verb}失败：操作被取消、超时、或者本机找不到匹配的密钥。\n\n排查：\n· ${tips.join("\n· ")}`,
      );
    }
    case "InvalidStateError":
      return new Error(`Passkey ${verb}失败：该 Passkey 已被注册过 / 状态异常。`);
    case "SecurityError":
      return new Error(
        `Passkey ${verb}失败：浏览器拒绝了 RP 配置（多半是 PUBLIC_BASE_URL 跟当前域名不匹配，或当前不是 HTTPS / localhost）。`,
      );
    case "AbortError":
      return new Error(`Passkey ${verb}已取消。`);
    case "ConstraintError":
      return new Error(
        `Passkey ${verb}失败：当前认证器不满足要求（例如不支持 resident key 或用户验证）。`,
      );
    default:
      return new Error(`Passkey ${verb}失败（${e.name}）：${e.message}`);
  }
}
