import { useMemo, useState } from "react";

export type SparkPoint = { date: string; value: number };

export function Sparkline({
  points,
  width = 720,
  height = 160,
  stroke = "currentColor",
}: {
  points: SparkPoint[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const padX = 24;
  const padY = 16;

  const { path, max, scaleX, scaleY, coords } = useMemo(() => {
    const max = Math.max(1, ...points.map((p) => p.value));
    const n = points.length;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const scaleX = (i: number) => {
      if (n <= 1) return width / 2;
      return padX + (i / (n - 1)) * innerW;
    };
    const scaleY = (v: number) => padY + innerH - (v / max) * innerH;
    const coords = points.map((p, i) => ({ x: scaleX(i), y: scaleY(p.value) }));
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
    return { path, max, scaleX, scaleY, coords };
  }, [points, width, height]);

  if (points.length === 0) {
    return (
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full text-zinc-700 dark:text-zinc-300">
          <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-zinc-400 text-xs">
            无数据
          </text>
        </svg>
      </div>
    );
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full text-zinc-700 dark:text-zinc-300">
        <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={hover === i ? 4 : 2}
            fill={stroke}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && points[hover] && (
        <div
          className="absolute bg-zinc-900 text-white px-2 py-1 rounded text-xs pointer-events-none whitespace-nowrap"
          style={{
            left: `${(scaleX(hover) / width) * 100}%`,
            top: `${(scaleY(points[hover].value) / height) * 100}%`,
            transform: "translate(-50%, -100%)",
          }}
        >
          {points[hover].date}：{points[hover].value}
        </div>
      )}
      <div className="text-right text-xs text-zinc-400">峰值 {max}</div>
    </div>
  );
}
