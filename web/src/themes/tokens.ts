// Theme tokens — three visitor-facing visual languages.
//
// A · Contact Sheet — 35mm印样, 红色点缀, Instrument Serif + JetBrains Mono
// B · Album Pages   — 影集胶页, 黄色点缀, Source Serif + Caveat
// C · Modern Editorial — 杂志志书, 电光蓝点缀, DM Serif Display + JetBrains Mono

export type ThemeId = "a" | "b" | "c";

export const THEME_IDS: ThemeId[] = ["a", "b", "c"];

export type ThemeTokens = {
  id: ThemeId;
  name: string;
  short: string;
  blurb: string;
  bg: string;
  paper: string;
  ink: string;
  mute: string;
  rule: string;
  rule2: string;
  accent: string;
  serif: string;
  mono: string;
  sans: string;
  hand?: string;
};

const A: ThemeTokens = {
  id: "a",
  name: "Contact Sheet 接触印样",
  short: "A · 印样",
  blurb: "35mm 接触印样 · 红色darkroom点缀",
  bg: "#FFFFFF",
  paper: "#FAFAF7",
  ink: "#0A0A0A",
  mute: "#6B6B6B",
  rule: "#D5D5D2",
  rule2: "#1A1A1A",
  accent: "#E10600",
  serif: '"Instrument Serif", "EB Garamond", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  sans: '"Inter Tight", ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", sans-serif',
};

const B: ThemeTokens = {
  id: "b",
  name: "Album Pages 影集胶页",
  short: "B · 胶页",
  blurb: "白纸 · 黑色照片角 · 美纹胶带 · 手写注脚",
  bg: "#F6F1E6",
  paper: "#FBF6EA",
  ink: "#1A1A1A",
  mute: "#7A7060",
  rule: "#D6CCB7",
  rule2: "#1A1A1A",
  accent: "#F0B500",
  serif: '"Source Serif 4", "Source Serif Pro", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  sans: '"Inter Tight", ui-sans-serif, system-ui, -apple-system, sans-serif',
  hand: '"Caveat", "Kalam", "Marker Felt", cursive',
};

const C: ThemeTokens = {
  id: "c",
  name: "Modern Editorial 杂志志书",
  short: "C · 杂志",
  blurb: "超大斜体 · 巨幅 folio · 引用页 · 电光蓝点缀",
  bg: "#F4F2EE",
  paper: "#FFFFFF",
  ink: "#0E0E10",
  mute: "#7A7A82",
  rule: "#D7D4CB",
  rule2: "#0E0E10",
  accent: "#1242FF",
  serif: '"DM Serif Display", "Playfair Display", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  sans: '"Inter Tight", ui-sans-serif, system-ui, -apple-system, sans-serif',
};

export const THEMES: Record<ThemeId, ThemeTokens> = { a: A, b: B, c: C };

export function isThemeId(v: string | null | undefined): v is ThemeId {
  return v === "a" || v === "b" || v === "c";
}
