import { useParams, useNavigate } from "react-router-dom";
import CycleDetail from "@/components/cycles/CycleDetail";

export default function CycleDetailPage() {
  const { slug, projectId, cycleId } = useParams();
  const navigate = useNavigate();

  if (!slug || !projectId || !cycleId) return null;

  return (
    <CycleDetail
      slug={slug}
      projectId={projectId}
      cycleId={cycleId}
      onBack={() => navigate(`/${slug}/projects/${projectId}/cycles`)}
    />
  );
}
