import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter, X, ArrowUpDown, Package } from "@/lib/icons";

export interface FilterState {
  stateId: string;
  priority: string;
  moduleId: string;
  sortBy: string;
  sortDir: "asc" | "desc";
}

interface FilterBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  states: { id: string; name: string; color?: string; group: string }[];
  modules?: { id: string; name: string }[];
}

const PRIORITIES = ["urgent", "high", "medium", "low", "none"];
const SORT_OPTIONS = [
  { value: "created_at", label: "Created" },
  { value: "updated_at", label: "Updated" },
  { value: "sequence_id", label: "ID" },
  { value: "priority", label: "Priority" },
];

export default function FilterBar({ filters, onChange, states, modules }: FilterBarProps) {
  const [stateOpen, setStateOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const activeCount = [
    filters.stateId !== "all",
    filters.priority !== "all",
    filters.moduleId !== "all",
  ].filter(Boolean).length;

  const update = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  const clearAll = () => update({ stateId: "all", priority: "all", moduleId: "all" });

  const priorityColors: Record<string, string> = {
    urgent: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-yellow-500",
    low: "bg-blue-500",
    none: "bg-gray-400",
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* State filter */}
      <Popover open={stateOpen} onOpenChange={setStateOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={filters.stateId !== "all" ? "secondary" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1"
          >
            <Filter className="h-3 w-3" />
            State
            {filters.stateId !== "all" && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">
                {states.find((s) => s.id === filters.stateId)?.name?.slice(0, 8) || "..."}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start">
          <button
            className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent ${filters.stateId === "all" ? "bg-accent font-medium" : ""}`}
            onClick={() => {
              update({ stateId: "all" });
              setStateOpen(false);
            }}
          >
            All States
          </button>
          {states.map((s) => (
            <button
              key={s.id}
              className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent flex items-center gap-2 ${filters.stateId === s.id ? "bg-accent font-medium" : ""}`}
              onClick={() => {
                update({ stateId: s.id });
                setStateOpen(false);
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color || "#6b7280" }}
              />
              {s.name}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* Priority filter */}
      <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={filters.priority !== "all" ? "secondary" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1"
          >
            Priority
            {filters.priority !== "all" && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">
                {filters.priority}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-40 p-1" align="start">
          <button
            className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent ${filters.priority === "all" ? "bg-accent font-medium" : ""}`}
            onClick={() => {
              update({ priority: "all" });
              setPriorityOpen(false);
            }}
          >
            All Priority
          </button>
          {PRIORITIES.map((p) => (
            <button
              key={p}
              className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent flex items-center gap-2 ${filters.priority === p ? "bg-accent font-medium" : ""}`}
              onClick={() => {
                update({ priority: p });
                setPriorityOpen(false);
              }}
            >
              <span className={`h-2 w-2 rounded-full ${priorityColors[p]}`} />
              {p}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* Module filter */}
      {modules && modules.length > 0 && (
        <Popover open={moduleOpen} onOpenChange={setModuleOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={filters.moduleId !== "all" ? "secondary" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
            >
              <Package className="h-3 w-3" />
              Module
              {filters.moduleId !== "all" && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">
                  {modules.find((m) => m.id === filters.moduleId)?.name?.slice(0, 10) || "..."}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            <button
              className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent ${filters.moduleId === "all" ? "bg-accent font-medium" : ""}`}
              onClick={() => {
                update({ moduleId: "all" });
                setModuleOpen(false);
              }}
            >
              All Modules
            </button>
            {modules.map((m) => (
              <button
                key={m.id}
                className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent flex items-center gap-2 ${filters.moduleId === m.id ? "bg-accent font-medium" : ""}`}
                onClick={() => {
                  update({ moduleId: m.id });
                  setModuleOpen(false);
                }}
              >
                <Package className="h-3 w-3 text-muted-foreground" />
                {m.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}

      {/* Sort */}
      <Popover open={sortOpen} onOpenChange={setSortOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
            <ArrowUpDown className="h-3 w-3" />
            Sort
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1" align="start">
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.value}
              className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent flex items-center justify-between ${filters.sortBy === s.value ? "bg-accent font-medium" : ""}`}
              onClick={() => {
                update({
                  sortBy: s.value,
                  sortDir: filters.sortBy === s.value && filters.sortDir === "asc" ? "desc" : "asc",
                });
                setSortOpen(false);
              }}
            >
              {s.label}
              {filters.sortBy === s.value && (
                <span className="text-[10px] text-muted-foreground">
                  {filters.sortDir === "asc" ? "ASC" : "DESC"}
                </span>
              )}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* Clear */}
      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={clearAll}
        >
          <X className="h-3 w-3 mr-0.5" />
          Clear
        </Button>
      )}
    </div>
  );
}
