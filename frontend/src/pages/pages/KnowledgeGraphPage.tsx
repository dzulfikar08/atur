import { useParams } from 'react-router-dom';
import KnowledgeGraph from '@/components/editor/KnowledgeGraph';

export default function KnowledgeGraphPage() {
  const { slug } = useParams<{ slug: string }>();

  if (!slug) return null;

  return (
    <div className="flex h-[calc(100vh-7.5rem)] -m-4 md:-m-6 lg:-m-8">
      <KnowledgeGraph slug={slug} />
    </div>
  );
}
