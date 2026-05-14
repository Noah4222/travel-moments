import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { THEMES, THEME_IDS, type ThemeId, isThemeId } from "@/themes/tokens";
import { useTheme } from "@/themes/ThemeProvider";

type Props = {
  /** value currently persisted in DB (or "" if relying on default) */
  draft: string;
  effective: string;
  saving: boolean;
  onSave: (next: ThemeId) => Promise<void>;
};

// Theme picker rendered inside the admin Settings page. Picking a theme
// previews it live (via setLocalTheme) without persisting; "保存" writes
// the choice to AppSettings so it becomes the default for all visitors.
export function ThemePicker({ draft, effective, saving, onSave }: Props) {
  const { themeId: active, setLocalTheme, refresh } = useTheme();
  const persisted: ThemeId = isThemeId(effective) ? effective : "a";
  const [picked, setPicked] = useState<ThemeId>(isThemeId(draft) ? draft : persisted);

  // If admin navigates away and the underlying setting changes, refresh.
  useEffect(() => {
    if (isThemeId(draft)) setPicked(draft);
  }, [draft]);

  function previewLocal(id: ThemeId) {
    setPicked(id);
    setLocalTheme(id);
  }

  async function save() {
    await onSave(picked);
    // Force the provider to re-fetch the canonical theme from the server
    // so every visitor (and this admin's own non-preview state) is consistent.
    await refresh();
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">访客侧主题</h3>
          <p className="mt-1 text-xs text-zinc-500">
            点击下方卡片可<b>本地预览</b>（不影响其他访客）。点「保存为默认」后，
            所有访客都将看到这个主题。
          </p>
        </div>
        <div className="text-xs text-zinc-500">
          当前生效：<code className="font-mono">{persisted.toUpperCase()}</code>
          {active !== persisted && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-700">
              本地预览：{active.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {THEME_IDS.map((id) => {
          const t = THEMES[id];
          const isPicked = picked === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => previewLocal(id)}
              className="flex flex-col gap-3 border p-4 text-left transition hover:shadow-sm"
              style={{
                borderColor: isPicked ? t.accent : "rgb(228 228 231)",
                borderWidth: isPicked ? 2 : 1,
                background: t.bg,
                color: t.ink,
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[10px] uppercase tracking-[.15em]"
                  style={{ fontFamily: t.mono, color: t.mute }}
                >
                  {id.toUpperCase()} · {t.short.split(" · ")[1] ?? t.short}
                </span>
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: t.accent }}
                />
              </div>
              <div
                className="italic"
                style={{
                  fontFamily: t.serif,
                  fontSize: 28,
                  lineHeight: 1,
                  letterSpacing: -0.5,
                }}
              >
                {t.name.split(" ")[0]}
              </div>
              <p
                className="m-0 text-xs leading-relaxed"
                style={{ color: t.mute, fontFamily: t.sans }}
              >
                {t.blurb}
              </p>
              <div
                className="text-[10px] uppercase tracking-[.12em]"
                style={{ fontFamily: t.mono, color: t.mute }}
              >
                {isPicked ? "✓ Selected" : "Tap to preview"}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving || picked === persisted}>
          {saving ? "保存中…" : "保存为默认"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => previewLocal(persisted)}
          disabled={active === persisted}
        >
          重置预览
        </Button>
      </div>
    </Card>
  );
}

// Exposed for callers that need to validate before invoking onSave.
export { isThemeId };
