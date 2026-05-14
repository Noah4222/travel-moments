import { useTheme } from "@/themes/ThemeProvider";
import { ShareViewA } from "./ShareViewA";
import { ShareViewB } from "./ShareViewB";
import { ShareViewC } from "./ShareViewC";
import type { ShareViewProps } from "./types";

export function ThemedShareView(props: ShareViewProps) {
  const { themeId } = useTheme();
  if (themeId === "b") return <ShareViewB {...props} />;
  if (themeId === "c") return <ShareViewC {...props} />;
  return <ShareViewA {...props} />;
}
