import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRIORITIES, badgeGroup, stripProduct } from "@/lib/issueQuery";
import type { IssuePatch } from "./ListView";
import { ProductChip, type ViewContext, type ViewIssue } from "./shared";

const TRIGGER =
  "h-7 w-full justify-start gap-1 border-none bg-transparent px-2 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-offset-0 dark:bg-transparent";

/** Spreadsheet mode: every date and select is editable in place. */
export default function SheetView({
  issues,
  ctx,
  onOpen,
  onPatch,
}: {
  issues: ViewIssue[];
  ctx: ViewContext;
  onOpen: (issue: ViewIssue) => void;
  onPatch: (issues: ViewIssue[], patch: IssuePatch) => void;
}) {
  const th = "sticky top-0 bg-muted/80 p-2 text-left text-xs font-medium text-muted-foreground";
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <table className="w-full min-w-[800px] border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className={`${th} w-16`}>ID</th>
            <th className={`${th} w-28`}>Product</th>
            <th className={`${th} min-w-[220px]`}>Title</th>
            <th className={`${th} w-36`}>State</th>
            <th className={`${th} w-32`}>Priority</th>
            <th className={`${th} w-36`}>Start</th>
            <th className={`${th} w-36`}>Target</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr
              key={issue.id}
              className="group h-9 cursor-pointer border-b hover:bg-muted/30"
              onClick={() => onOpen(issue)}
            >
              <td className="px-2 font-ops-mono text-xs text-muted-foreground">
                {String(issue.sequence_id).padStart(4, "0")}
              </td>
              <td className="px-2">
                <ProductChip name={issue.name} />
              </td>
              <td className="px-2 font-medium">{stripProduct(issue.name)}</td>
              <td className="p-1" onClick={(e) => e.stopPropagation()}>
                <Select
                  value={issue.state_id ?? undefined}
                  onValueChange={(v) => onPatch([issue], { state_id: v })}
                >
                  <SelectTrigger className={TRIGGER} aria-label="State">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="min-w-[10rem]">
                    {ctx.states.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        <span className="state-badge" data-state-group={badgeGroup(s.key, s.group)}>
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="p-1" onClick={(e) => e.stopPropagation()}>
                <Select
                  value={issue.priority || "none"}
                  onValueChange={(v) => onPatch([issue], { priority: v })}
                >
                  <SelectTrigger className={TRIGGER} aria-label="Priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="min-w-[8rem]">
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs capitalize">
                        <span className="flex items-center gap-2">
                          <span className="priority-dot" data-priority={p} />
                          {p}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="p-1" onClick={(e) => e.stopPropagation()}>
                <DatePicker
                  value={issue.start_date}
                  onChange={(v) => onPatch([issue], { start_date: v })}
                />
              </td>
              <td className="p-1" onClick={(e) => e.stopPropagation()}>
                <DatePicker
                  value={issue.target_date}
                  onChange={(v) => onPatch([issue], { target_date: v })}
                />
              </td>
            </tr>
          ))}
          {issues.length === 0 && (
            <tr>
              <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                No issues match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
