import { cn } from "@/lib/cn";

/** A small inline spinner; pass className for color/size. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("h-5 w-5 animate-spin text-zinc-500", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoadingOverlay({ label }: { label?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black/20 text-white">
      <Spinner className="text-white" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
