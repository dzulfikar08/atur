import { useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "@/lib/icons";
import { stripProduct } from "@/lib/issueQuery";
import type { ViewContext, ViewIssue } from "./shared";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarView({
  issues,
  ctx,
  onOpen,
}: {
  issues: ViewIssue[];
  ctx: ViewContext;
  onOpen: (issue: ViewIssue) => void;
}) {
  const [month, setMonth] = useState(new Date());
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });
  const today = new Date();
  const dated = issues.filter((i) => i.start_date || i.target_date);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setMonth(subMonths(month, 1))}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Prev
        </Button>
        <h3 className="text-sm font-semibold">{format(month, "MMMM yyyy")}</h3>
        <Button variant="ghost" size="sm" onClick={() => setMonth(addMonths(month, 1))}>
          Next <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 bg-muted/50">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="border-r p-2 text-center text-xs font-medium text-muted-foreground last:border-r-0"
            >
              {d}
            </div>
          ))}
        </div>
        {Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => (
          <div key={w} className="grid grid-cols-7 border-t">
            {days.slice(w * 7, w * 7 + 7).map((day) => {
              const dayIssues = dated.filter((i) => {
                const start = i.start_date ? parseISO(i.start_date) : null;
                const end = i.target_date ? parseISO(i.target_date) : null;
                if (start && end) return isWithinInterval(day, { start, end });
                return isSameDay(day, (start ?? end)!);
              });
              const inMonth = isSameMonth(day, month);
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={day.toISOString()}
                  className={`min-h-[104px] border-r p-1 last:border-r-0 ${
                    inMonth ? "" : "bg-muted/20"
                  } ${isToday ? "bg-primary/5" : ""}`}
                >
                  <div
                    className={`mb-1 px-1 text-xs ${
                      isToday
                        ? "font-bold text-primary"
                        : inMonth
                          ? "text-foreground"
                          : "text-muted-foreground/50"
                    }`}
                  >
                    {format(day, "d")}
                  </div>
                  <div className="space-y-0.5">
                    {dayIssues.slice(0, 3).map((issue) => {
                      const st = issue.state_id ? ctx.stateById.get(issue.state_id) : undefined;
                      const color = st?.color || "var(--state-backlog)";
                      return (
                        <button
                          key={issue.id}
                          type="button"
                          className="w-full truncate rounded px-1 py-0.5 text-left text-xs leading-tight transition-colors hover:bg-muted/60"
                          style={{
                            borderLeft: `2px solid ${color}`,
                            background: `color-mix(in oklab, ${color} 10%, transparent)`,
                          }}
                          onClick={() => onOpen(issue)}
                          title={issue.name}
                        >
                          {stripProduct(issue.name)}
                        </button>
                      );
                    })}
                    {dayIssues.length > 3 && (
                      <div className="px-1 text-xs text-muted-foreground">
                        +{dayIssues.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
