import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { FileText, ArrowRight } from "@/lib/icons";
import { useNavigate, useParams } from "react-router-dom";

interface Page {
  id: string;
  name: string;
  updated_at: string;
}

export default function BacklinksPanel() {
  const { slug, pageId } = useParams();
  const navigate = useNavigate();

  const { data: backlinks = [], isLoading } = useQuery({
    queryKey: ["backlinks", slug, pageId],
    queryFn: () =>
      apiFetch<Page[]>(`/workspaces/${slug}/pages/${pageId}/backlinks/`).catch(() => []),
    enabled: !!slug && !!pageId,
  });

  if (isLoading) {
    return <div className="text-xs text-muted-foreground animate-pulse">Loading backlinks...</div>;
  }

  if (backlinks.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No backlinks yet</p>;
  }

  return (
    <div className="space-y-1">
      {backlinks.map((page) => (
        <button
          key={page.id}
          className="w-full flex items-center gap-2 p-2 rounded-md text-sm text-left hover:bg-muted/50 transition-colors"
          onClick={() => navigate(`/${slug}/pages/${page.id}`)}
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1 truncate">{page.name}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
        </button>
      ))}
    </div>
  );
}
