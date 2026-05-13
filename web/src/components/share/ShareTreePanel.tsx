import { useEffect, useState } from "react";
import { api, type ShareTreeNode } from "@/lib/api";
import { Badge, Button, Card } from "@/components/ui";

export function ShareTreePanel({ id, onClose }: { id: number; onClose: () => void }) {
  const [tree, setTree] = useState<ShareTreeNode | null>(null);
  useEffect(() => {
    api.shareTree(id).then(setTree);
  }, [id]);
  return (
    <Modal onClose={onClose} title="传播树">
      {!tree ? <p>加载中…</p> : <TreeNode node={tree} depth={0} />}
    </Modal>
  );
}

function TreeNode({ node, depth }: { node: ShareTreeNode; depth: number }) {
  return (
    <div style={{ marginLeft: depth * 20 }} className="text-sm">
      <div className="flex items-center gap-2 py-1">
        <span className="font-mono">{node.code}</span>
        {node.note && <span className="text-zinc-500">— {node.note}</span>}
        {node.revoked_at && <Badge tone="danger">撤销</Badge>}
        {!node.created_by_user_id && node.parent_share_id && (
          <Badge tone="neutral">访客转发</Badge>
        )}
      </div>
      {node.children?.map((c) => (
        <TreeNode key={c.id} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <Card
        className="w-full max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
        {children}
      </Card>
    </div>
  );
}
