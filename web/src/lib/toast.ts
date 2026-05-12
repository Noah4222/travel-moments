export type ToastTone = "success" | "error";
export type Toast = { id: number; message: string; tone: ToastTone };

const TOAST_EVENT = "tm-toast";

export function showToast(message: string, tone: ToastTone = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<Toast>(TOAST_EVENT, {
      detail: { id: Date.now() + Math.random(), message, tone },
    }),
  );
}

export function subscribeToasts(handler: (t: Toast) => void): () => void {
  const wrapped = (e: Event) => handler((e as CustomEvent<Toast>).detail);
  window.addEventListener(TOAST_EVENT, wrapped);
  return () => window.removeEventListener(TOAST_EVENT, wrapped);
}
