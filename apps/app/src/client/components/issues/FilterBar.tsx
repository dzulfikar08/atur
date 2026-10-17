import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronDown } from "@/lib/icons";
import {
  DUE_BUCKET_LABEL,
  PRIORITIES,
  STATE_KEYS,
  STATE_KEY_COLOR,
  STATE_KEY_LABEL,
  type FacetCounts,
  type IssueQuery,
} from "@/lib/issueQuery";
import { productColor } from "@/lib/product";

export interface FilterOptions {
  assignees: { id: string; name: string }[];
  labels: { id: string; name: string; color?: string }[];
  products: string[];
  modules?: { id: string; name: string }[];
  /** Total issues per facet (before the state/done filter), shown beside each option. */
  counts: FacetCounts;
}

interface FilterBarProps extends FilterOptions {
  query: IssueQuery;
  onChange: (patch: Partial<IssueQuery>) => void;
}

const DUE_OPTIONS: { value: IssueQuery["due"]; label: string }[] = [
  { value: "overdue", label: DUE_BUCKET_LABEL.overdue },
  { value: "today", label: DUE_BUCKET_LABEL.today },
  { value: "week", label: "Due this week" },
  { value: "none", label: DUE_BUCKET_LABEL.none },
];

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

function Chip({
  label,
  summary,
  active,
  width = "w-56",
  children,
}: {
  label: string;
  summary?: string;
  active: boolean;
  width?: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "secondary" : "outline"}
          size="sm"
          className="h-8 gap-1 rounded-full px-3 text-xs"
        >
          {label}
          {active && summary && (
            <span className="max-w-[9rem] truncate font-semibold text-foreground">{summary}</span>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={`${width} p-1`} align="start">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function Option({
  checked,
  onClick,
  leading,
  children,
  count,
}: {
  checked: boolean;
  onClick: () => void;
  leading?: ReactNode;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
        }`}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
      {leading}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="text-xs text-muted-foreground">{count}</span>}
    </button>
  );
}

const summarize = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names[0]} +${names.length - 1}`;

export default function FilterBar({
  query,
  onChange,
  counts,
  assignees,
  labels,
  products,
  modules,
}: FilterBarProps) {
  const set =
    (key: "state" | "priority" | "assignee" | "label" | "product" | "module") => (value: string) =>
      onChange({ [key]: toggle(query[key], value) });

  const stateKeys = STATE_KEYS.filter((k) => (counts.state[k] ?? 0) > 0 || query.state.includes(k));
  const hasRange = !!(query.target_from || query.target_to || query.start_from || query.start_to);
  const dueActive = query.due !== "any" || hasRange;
  const dueSummary =
    query.due !== "any"
      ? (DUE_OPTIONS.find((o) => o.value === query.due)?.label ?? "")
      : "Date range";
  const labelName = (id: string) => labels.find((l) => l.id === id)?.name ?? "…";
  const assigneeName = (id: string) =>
    id === "me"
      ? "Me"
      : id === "none"
        ? "Unassigned"
        : (assignees.find((a) => a.id === id)?.name ?? "…");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip
        label="State"
        active={query.state.length > 0}
        summary={summarize(query.state.map((k) => STATE_KEY_LABEL[k] ?? k))}
      >
        {stateKeys.map((k) => (
          <Option
            key={k}
            checked={query.state.includes(k)}
            onClick={() => set("state")(k)}
            count={counts.state[k] ?? 0}
            leading={
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: STATE_KEY_COLOR[k] }}
              />
            }
          >
            {STATE_KEY_LABEL[k]}
          </Option>
        ))}
      </Chip>

      <Chip
        label="Priority"
        active={query.priority.length > 0}
        summary={summarize(query.priority)}
        width="w-44"
      >
        {PRIORITIES.map((p) => (
          <Option
            key={p}
            checked={query.priority.includes(p)}
            onClick={() => set("priority")(p)}
            count={counts.priority[p] ?? 0}
            leading={<span className="priority-dot" data-priority={p} />}
          >
            <span className="capitalize">{p}</span>
          </Option>
        ))}
      </Chip>

      <Chip
        label="Assignee"
        active={query.assignee.length > 0}
        summary={summarize(query.assignee.map(assigneeName))}
      >
        <Option checked={query.assignee.includes("me")} onClick={() => set("assignee")("me")}>
          Me
        </Option>
        <Option checked={query.assignee.includes("none")} onClick={() => set("assignee")("none")}>
          Unassigned
        </Option>
        {assignees.map((a) => (
          <Option
            key={a.id}
            checked={query.assignee.includes(a.id)}
            onClick={() => set("assignee")(a.id)}
          >
            {a.name}
          </Option>
        ))}
      </Chip>

      {labels.length > 0 && (
        <Chip
          label="Label"
          active={query.label.length > 0}
          summary={summarize(query.label.map(labelName))}
        >
          {labels.map((l) => (
            <Option
              key={l.id}
              checked={query.label.includes(l.id)}
              onClick={() => set("label")(l.id)}
              leading={
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: l.color || "var(--state-backlog)" }}
                />
              }
            >
              {l.name}
            </Option>
          ))}
        </Chip>
      )}

      {products.length > 0 && (
        <Chip label="Product" active={query.product.length > 0} summary={summarize(query.product)}>
          {products.map((p) => (
            <Option
              key={p}
              checked={query.product.includes(p)}
              onClick={() => set("product")(p)}
              count={counts.product[p] ?? 0}
              leading={
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: productColor(p) }}
                />
              }
            >
              {p}
            </Option>
          ))}
        </Chip>
      )}

      {modules && modules.length > 0 && (
        <Chip
          label="Module"
          active={query.module.length > 0}
          summary={summarize(
            query.module.map((id) => modules.find((m) => m.id === id)?.name ?? "…"),
          )}
        >
          {modules.map((m) => (
            <Option
              key={m.id}
              checked={query.module.includes(m.id)}
              onClick={() => set("module")(m.id)}
            >
              {m.name}
            </Option>
          ))}
        </Chip>
      )}

      <Chip label="Due" active={dueActive} summary={dueSummary} width="w-64">
        {DUE_OPTIONS.map((o) => (
          <Option
            key={o.value}
            checked={query.due === o.value}
            onClick={() => onChange({ due: query.due === o.value ? "any" : o.value })}
          >
            {o.label}
          </Option>
        ))}
        <div className="mt-1 space-y-1.5 border-t px-2 pb-1.5 pt-2">
          <DateRange
            label="Target"
            from={query.target_from}
            to={query.target_to}
            onChange={(from, to) => onChange({ target_from: from, target_to: to })}
          />
          <DateRange
            label="Start"
            from={query.start_from}
            to={query.start_to}
            onChange={(from, to) => onChange({ start_from: from, start_to: to })}
          />
        </div>
      </Chip>

      <Button
        variant={query.decision ? "secondary" : "outline"}
        size="sm"
        aria-pressed={query.decision}
        className="h-8 rounded-full px-3 text-xs"
        onClick={() => onChange({ decision: !query.decision })}
      >
        Decisions
      </Button>

      <Button
        variant={query.done === "show" ? "secondary" : "outline"}
        size="sm"
        aria-pressed={query.done === "show"}
        className="h-8 rounded-full px-3 text-xs"
        onClick={() => onChange({ done: query.done === "show" ? "hide" : "show" })}
      >
        Show completed
      </Button>
    </div>
  );
}

function DateRange({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="w-10 shrink-0">{label}</span>
      <Input
        type="date"
        aria-label={`${label} from`}
        value={from}
        max={to || undefined}
        onChange={(e) => onChange(e.target.value, to)}
        className="h-7 px-1.5 text-xs"
      />
      <span>–</span>
      <Input
        type="date"
        aria-label={`${label} to`}
        value={to}
        min={from || undefined}
        onChange={(e) => onChange(from, e.target.value)}
        className="h-7 px-1.5 text-xs"
      />
    </div>
  );
}
