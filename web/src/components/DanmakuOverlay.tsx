import { useEffect, useRef, useState } from "react";
import { api, type Comment } from "@/lib/api";

type Active = { id: string; text: string; lane: number; color?: string };

const LANES = 5;
const DURATION_MS = 8000;

export function DanmakuOverlay({
  assetID,
  videoRef,
}: {
  assetID: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [active, setActive] = useState<Active[]>([]);
  const fired = useRef<Set<number>>(new Set());
  const list = useRef<Comment[]>([]);
  const lane = useRef(0);

  useEffect(() => {
    api.publicListComments("asset", assetID).then((cs) => {
      list.current = cs.filter((c) => c.video_time_ms != null);
    });
  }, [assetID]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tick = () => {
      const t = v.currentTime * 1000;
      for (const c of list.current) {
        if (fired.current.has(c.id)) continue;
        if (c.video_time_ms != null && t >= c.video_time_ms) {
          fired.current.add(c.id);
          const id = `${c.id}-${Date.now()}`;
          const myLane = lane.current;
          lane.current = (lane.current + 1) % LANES;
          setActive((cur) => [...cur, { id, text: `${c.display_name}：${c.content}`, lane: myLane, color: c.color }]);
          window.setTimeout(() => {
            setActive((cur) => cur.filter((a) => a.id !== id));
          }, DURATION_MS);
        }
      }
    };
    const interval = window.setInterval(tick, 200);
    return () => window.clearInterval(interval);
  }, [videoRef]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {active.map((d) => (
        <span
          key={d.id}
          className="absolute whitespace-nowrap text-shadow-sm"
          style={{
            top: `${10 + d.lane * 16}%`,
            left: "100%",
            color: d.color || "white",
            textShadow: "0 0 4px rgba(0,0,0,0.8)",
            fontSize: 18,
            animation: `tm-danmaku ${DURATION_MS}ms linear forwards`,
          }}
        >
          {d.text}
        </span>
      ))}
      <style>{`
        @keyframes tm-danmaku {
          from { transform: translateX(0); }
          to   { transform: translateX(-200vw); }
        }
      `}</style>
    </div>
  );
}
