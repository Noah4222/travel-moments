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
  console.debug("[passkey] register/start ->", opts);
  const publicKey = preparePublicKey(opts.publicKey ?? opts);
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential | null;
  } catch (e) {
    console.error("[passkey] navigator.credentials.create rejected:", e);
    throw e;
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
  console.debug("[passkey] login/start ->", opts);
  const publicKey = preparePublicKey(opts.publicKey ?? opts);
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey,
    })) as PublicKeyCredential | null;
  } catch (e) {
    console.error("[passkey] navigator.credentials.get rejected:", e);
    throw e;
  }
  if (!cred) throw new Error("Passkey 登录被取消");
  console.debug("[passkey] got assertion, finishing");
  return api.passkeyLoginFinish(credentialToJSON(cred));
}
