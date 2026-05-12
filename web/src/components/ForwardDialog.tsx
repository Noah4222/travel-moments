import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input, Label, Textarea } from "./ui";
import { copyText, composeForwardCopy } from "@/lib/clipboard";

export function ForwardDialog({
  onClose,
  tripTitle,
}: {
  onClose: () => void;
  tripTitle?: string;
}) {
  const [note, setNote] = useState("");
  const [disableForward, setDisableForward] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; password: string; url: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.publicForward({ note, disable_forward: disableForward });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const shareURL = result
    ? `${window.location.origin}${result.url}#${encodeURIComponent(result.password)}`
    : "";
  const clipboard = shareURL ? composeForwardCopy(tripTitle, shareURL) : "";

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <Card className="w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-semibold">转发给好友</h2>
        <p className="mb-4 text-xs text-zinc-500">
          会生成一个新的密码 + 链接，方便你分享给朋友。
        </p>

        {result ? (
          <div className="space-y-3">
            <div>
              <Label>访问链接（密码已隐藏在 # 后）</Label>
              <Input readOnly value={shareURL} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <p className="text-xs text-zinc-500">
              密码：<code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{result.password}</code>
            </p>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => copyText(clipboard)}
              >
                复制分享文案
              </Button>
              <Button className="flex-1" onClick={onClose}>
                完成
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Label>备注（可选）</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：给小王"
            />
            <label className="mt-3 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={disableForward}
                onChange={(e) => setDisableForward(e.target.checked)}
              />
              一次性分享（接收人不能再转发）
            </label>
            {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
            <div className="mt-4 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={onClose}>
                取消
              </Button>
              <Button className="flex-1" onClick={submit} disabled={busy}>
                {busy ? "生成中…" : "生成链接"}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
