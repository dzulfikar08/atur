import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';

export default function PipelineListPage() {
  const { slug } = useParams();
  const isAll = slug === 'all';

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', slug],
    queryFn: () => (isAll ? api.listAllProjects() : api.listProjects(slug!)),
    enabled: !!slug,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pipelines</h1>
        <p className="text-sm text-muted-foreground">
          Any project doubles as a sales pipeline. Open one to view its deal board.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p: any) => (
          <Link key={p.id} to={`/${p.workspace_slug || slug}/crm/pipelines/${p.id}`}>
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">Open deal board →</p>
              </CardContent>
            </Card>
          </Link>
        ))}
        {!isLoading && projects.length === 0 && (
          <p className="text-sm text-muted-foreground">No projects yet — create a project first.</p>
        )}
      </div>
    </div>
  );
}
