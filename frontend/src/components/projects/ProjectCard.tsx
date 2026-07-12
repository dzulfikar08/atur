import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderKanban, MoreHorizontal } from '@/lib/icons';
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    identifier: string;
    description: string | null;
    cover_image: string | null;
    is_member: boolean;
    is_favorite: boolean;
    is_deployed: boolean;
    archived_at: string | null;
  };
  slug: string;
  onDelete?: (id: string) => void;
}

export default function ProjectCard({ project, slug, onDelete }: ProjectCardProps) {
  const navigate = useNavigate();

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => navigate(`/${slug}/projects/${project.id}`)}
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
            <FolderKanban className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm font-medium">{project.name}</CardTitle>
            <p className="text-xs text-muted-foreground">{project.identifier}</p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/${slug}/projects/${project.id}`); }}>
              Open
            </DropdownMenuItem>
            {onDelete && (
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
              >
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        {project.description ? (
          <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>
        ) : (
          <p className="text-xs text-muted-foreground italic">No description</p>
        )}
        <div className="mt-3 flex gap-1">
          {project.archived_at && <Badge variant="secondary">Archived</Badge>}
          {project.is_deployed && <Badge variant="outline">Deployed</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}
