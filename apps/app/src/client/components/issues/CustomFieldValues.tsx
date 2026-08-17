import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CustomField, type CustomFieldValue, type SelectOption } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Props {
  slug: string;
  projectId: string;
  issueSeqId: number;
}

export default function CustomFieldValues({ slug, projectId, issueSeqId }: Props) {
  const qc = useQueryClient();

  const { data: fields = [] } = useQuery({
    queryKey: ["custom-fields", slug, projectId],
    queryFn: () => api.listCustomFields(slug, projectId),
    enabled: !!slug && !!projectId,
  });

  const { data: values = [] } = useQuery({
    queryKey: ["custom-values", slug, projectId, issueSeqId],
    queryFn: () => api.listCustomValues(slug, projectId, issueSeqId),
    enabled: !!slug && !!projectId && !!issueSeqId,
  });

  const setMutation = useMutation({
    mutationFn: (params: { custom_field_id: string; value_json: unknown }) =>
      api.setCustomValues(slug, projectId, issueSeqId, [params]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-values", slug, projectId, issueSeqId] });
    },
    onError: () => toast.error("Failed to update field"),
  });

  const valueMap = new Map(values.map((v) => [v.custom_field_id, v]));

  if (fields.length === 0) return null;

  return (
    <div className="space-y-2">
      {fields.map((field) => {
        const value = valueMap.get(field.id);
        return (
          <FieldInput
            key={field.id}
            field={field}
            value={value}
            onChange={(val) => setMutation.mutate({ custom_field_id: field.id, value_json: val })}
          />
        );
      })}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomField;
  value: CustomFieldValue | undefined;
  onChange: (val: unknown) => void;
}) {
  const currentVal = value?.value_json ?? null;
  const options: SelectOption[] = field.settings?.options || [];
  // Continuous (typed) fields debounce the PATCH; discrete fields commit immediately.
  const isContinuous =
    field.field_type === "text" ||
    field.field_type === "url" ||
    field.field_type === "number" ||
    field.field_type === "date" ||
    field.field_type === "user";
  const [local, setLocal] = useState<unknown>(currentVal);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isContinuous) setLocal(currentVal);
  }, [currentVal, isContinuous]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const schedule = (val: unknown) => {
    setLocal(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(val), 500);
  };

  const display = isContinuous ? local : currentVal;

  switch (field.field_type) {
    case "text":
    case "url":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.name}
            {field.is_required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <Input
            type={field.field_type === "url" ? "url" : "text"}
            value={(display as string) || ""}
            onChange={(e) => schedule(e.target.value || null)}
            placeholder={field.name}
            className="h-8 text-sm"
          />
        </div>
      );

    case "number":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.name}
            {field.is_required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <Input
            type="number"
            value={(display as number) ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              schedule(v === "" ? null : Number(v));
            }}
            placeholder={field.name}
            className="h-8 text-sm"
          />
        </div>
      );

    case "date":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.name}
            {field.is_required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <DatePicker value={(display as string) || null} onChange={(v) => schedule(v)} />
        </div>
      );

    case "checkbox":
      return (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={currentVal === true}
            onChange={(e) => onChange(e.target.checked)}
            className="rounded"
          />
          <label className="text-xs text-muted-foreground">
            {field.name}
            {field.is_required && <span className="text-destructive ml-0.5">*</span>}
          </label>
        </div>
      );

    case "select":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.name}
            {field.is_required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <Select
            value={(currentVal as string) || "__none__"}
            onValueChange={(v) => onChange(v === "__none__" ? null : v)}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {options.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );

    case "multi_select": {
      const selected = (Array.isArray(currentVal) ? currentVal : []) as string[];
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.name}
            {field.is_required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <div className="flex flex-wrap gap-1">
            {options.map((opt) => {
              const isSelected = selected.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    const next = isSelected
                      ? selected.filter((s) => s !== opt.id)
                      : [...selected, opt.id];
                    onChange(next.length > 0 ? next : null);
                  }}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    isSelected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:bg-muted"
                  }`}
                >
                  {opt.value}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    case "user":
      return (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {field.name}
            {field.is_required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          <Input
            value={(display as string) || ""}
            onChange={(e) => schedule(e.target.value || null)}
            placeholder="User UUID"
            className="h-8 text-sm"
          />
        </div>
      );

    default:
      return null;
  }
}
