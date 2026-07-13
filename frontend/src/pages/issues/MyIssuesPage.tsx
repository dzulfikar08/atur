import { useParams } from 'react-router-dom';
import { useWindowSize } from '@/hooks/useWindowSize';
import MobileIssueList from '@/components/mobile/MobileIssueList';
import { useQuery } from '@tanstack/react-query';
import { api, type Issue } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';

function DesktopMyIssues({ slug }: { slug: string }) {
  const navigate = useNavigate();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', slug],
    queryFn: () => api.listProjects(slug!),
    enabled: !!slug,
  });

  const { data: allIssues = [], isLoading } = useQuery({
    queryKey: ['my-issues', slug, projects.map((p: any) => p.id).join(',')],
    queryFn: async () => {
      const settled = await Promise.all(
        projects.map(async (project) => {
          try {
            const issues = await api.listIssues(slug, project.id);
            return issues.map((issue) => ({ ...issue, project_name: project.name }));
          } catch {
            return [] as (Issue & { project_name?: string })[];
          }
        })
      );
      return settled.flat();
    },
    enabled: !!slug && projects.length > 0,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading issues...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My Issues</h1>
      {allIssues.length === 0 ? (
        <p className="text-muted-foreground">No issues found</p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground">ID</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Title</th>
                <th className="text-left p-2 font-medium text-muted-foreground hidden sm:table-cell">Project</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Priority</th>
                <th className="text-left p-2 font-medium text-muted-foreground hidden md:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {allIssues.map((issue) => (
                <tr
                  key={issue.id}
                  className="border-t hover:bg-muted/30 cursor-pointer"
                  onClick={() => navigate(`/${slug}/projects/${issue.project_id}/issues/${issue.sequence_id}`)}
                >
                  <td className="p-2 text-muted-foreground">{String(issue.sequence_id).padStart(4, '0')}</td>
                  <td className="p-2 font-medium">{issue.name}</td>
                  <td className="p-2 text-muted-foreground hidden sm:table-cell">{issue.project_name}</td>
                  <td className="p-2"><Badge variant="outline" className="text-xs">{issue.priority || 'none'}</Badge></td>
                  <td className="p-2 text-muted-foreground text-xs hidden md:table-cell">
                    {formatDistanceToNow(new Date(issue.updated_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MyIssuesPage() {
  const { slug } = useParams();
  const { width } = useWindowSize();

  if (!slug) return null;

  if (width < 768) {
    return (
      <div>
        <h1 className="text-lg font-semibold mb-3">My Issues</h1>
        <MobileIssueList slug={slug} />
      </div>
    );
  }

  return <DesktopMyIssues slug={slug} />;
}
