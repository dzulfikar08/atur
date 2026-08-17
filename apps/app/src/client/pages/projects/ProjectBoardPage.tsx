import { useWindowSize } from "@/hooks/useWindowSize";
import DesktopProjectBoard from "@/components/projects/ProjectBoard";
import MobileProjectBoard from "@/components/mobile/MobileProjectBoard";
import { useParams } from "react-router-dom";

export default function ProjectBoardPage() {
  const { width } = useWindowSize();
  const { slug, projectId } = useParams();

  if (width < 768 && slug && projectId) {
    return <MobileProjectBoard slug={slug} projectId={projectId} />;
  }

  return <DesktopProjectBoard />;
}
