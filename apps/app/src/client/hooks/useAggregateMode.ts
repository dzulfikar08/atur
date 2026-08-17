import { useParams } from "react-router-dom";

// True when the URL slug is the "All Workspaces" sentinel. Pages branch their
// data fetching on this to call the /api/me/* cross-workspace endpoints.
export const ALL_WORKSPACE_SLUG = "all";

export function useAggregateMode(): boolean {
  const { slug } = useParams<{ slug: string }>();
  return slug === ALL_WORKSPACE_SLUG;
}
