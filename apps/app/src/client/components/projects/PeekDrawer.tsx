import { Route, Routes } from "react-router-dom";
import IssueDetail from "@/components/issues/IssueDetail";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ArrowUpRight } from "@/lib/icons";

/** "JOYO-42" → 42 (also accepts a bare "42"). */
export const peekSeq = (peek: string | null): number | null => {
  const m = peek ? /(\d+)$/.exec(peek) : null;
  return m ? Number(m[1]) : null;
};

/**
 * Side sheet that renders the regular IssueDetail without leaving the
 * list/board. <Routes location> feeds IssueDetail its :slug/:projectId/
 * :issueSeqId params while the page URL stays on the board (?peek=JOYO-42).
 * Anything IssueDetail navigates to (delete, sub-issue, back) is a normal
 * router navigation, which also closes the drawer.
 */
export default function PeekDrawer({
  slug,
  projectId,
  identifier,
  seq,
  onClose,
  onOpenFull,
}: {
  slug: string;
  projectId: string;
  identifier: string;
  seq: number | null;
  onClose: () => void;
  onOpenFull: (seq: number) => void;
}) {
  return (
    <Sheet open={seq !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[1000px]"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">
          {identifier}-{seq}
        </SheetTitle>
        <SheetDescription className="sr-only">Issue details</SheetDescription>
        {seq !== null && (
          <>
            <div className="flex items-center gap-2 border-b px-4 py-2 pr-12">
              <span className="font-ops-mono text-xs text-muted-foreground">
                {identifier}-{seq}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 gap-1 text-xs"
                onClick={() => onOpenFull(seq)}
              >
                Open full page <ArrowUpRight className="h-3 w-3" />
              </Button>
            </div>
            <div className="p-4">
              <Routes location={`/${slug}/projects/${projectId}/issues/${seq}`}>
                <Route path="issues/:issueSeqId" element={<IssueDetail />} />
              </Routes>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
