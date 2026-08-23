import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "@/lib/icons";

export default function CompanyDetailPage() {
  const { slug, id } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["company", slug, id],
    queryFn: () => api.getCompany(slug!, id!),
    enabled: !!slug && !!id,
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data) return <p>Not found.</p>;

  return (
    <div className="space-y-4">
      <Link
        to={`/${slug}/crm/companies`}
        className="inline-flex items-center text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Companies
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{data.name}</h1>
        <div className="flex flex-wrap gap-2 mt-2">
          {data.domain && <Badge variant="outline">{data.domain}</Badge>}
          {data.industry && <Badge variant="outline">{data.industry}</Badge>}
          {data.website && (
            <a
              href={data.website}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              {data.website}
            </a>
          )}
        </div>
      </div>
      {data.description && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {data.description}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
