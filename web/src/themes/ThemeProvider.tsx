import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { THEMES, type ThemeId, type ThemeTokens, isThemeId } from "./tokens";

type Ctx = {
  themeId: ThemeId;
  tokens: ThemeTokens;
  /** Override the theme for the current session (does NOT persist). Used by admin
   *  Settings to preview switching before saving. */
  setLocalTheme: (id: ThemeId) => void;
  /** Re-fetch the active theme from the server (call after admin saves). */
  refresh: () => Promise<void>;
};

const ThemeContext = createContext<Ctx | null>(null);

export function useTheme(): Ctx {
  const c = useContext(ThemeContext);
  if (!c) throw new Error("useTheme must be used inside <ThemeProvider>");
  return c;
}

/** Hook that returns just the token bag — for components that don't care
 *  about the provider lifecycle. */
export function useThemeTokens(): ThemeTokens {
  return useTheme().tokens;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    if (typeof window !== "undefined") {
      const cached = window.localStorage.getItem("tm_theme");
      if (isThemeId(cached)) return cached;
    }
    return "a";
  });

  const refresh = async () => {
    try {
      const r = await api.publicSite();
      if (isThemeId(r.theme)) {
        setThemeId(r.theme);
        try {
          window.localStorage.setItem("tm_theme", r.theme);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* keep cached or default */
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tokens = THEMES[themeId];

  // Apply CSS variables on <html> so any non-themed page still picks up the
  // base accent / font tokens.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--tm-bg", tokens.bg);
    root.style.setProperty("--tm-paper", tokens.paper);
    root.style.setProperty("--tm-ink", tokens.ink);
    root.style.setProperty("--tm-mute", tokens.mute);
    root.style.setProperty("--tm-rule", tokens.rule);
    root.style.setProperty("--tm-rule2", tokens.rule2);
    root.style.setProperty("--tm-accent", tokens.accent);
    root.style.setProperty("--tm-serif", tokens.serif);
    root.style.setProperty("--tm-mono", tokens.mono);
    root.style.setProperty("--tm-sans", tokens.sans);
    if (tokens.hand) root.style.setProperty("--tm-hand", tokens.hand);
    root.setAttribute("data-theme", tokens.id);
  }, [tokens]);

  const value = useMemo<Ctx>(
    () => ({
      themeId,
      tokens,
      setLocalTheme: (id) => {
        setThemeId(id);
        try {
          window.localStorage.setItem("tm_theme", id);
        } catch {
          /* ignore */
        }
      },
      refresh,
    }),
    [themeId, tokens],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
