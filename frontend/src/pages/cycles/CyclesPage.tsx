import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Plus, ArrowLeft } from '@/lib/icons';
import { Button } from "@/components/ui/button";
import CycleList from "@/components/cycles/CycleList";
import CreateCycleDialog from "@/components/cycles/CreateCycleDialog";

export default function CyclesPage() {
  const { slug, projectId } = useParams();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  if (!slug || !projectId) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 md:px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate(`/${slug}/projects/${projectId}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">Cycles</h1>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New Sprint
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <CycleList slug={slug} projectId={projectId} />
      </div>

      {/* Create dialog */}
      <CreateCycleDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
