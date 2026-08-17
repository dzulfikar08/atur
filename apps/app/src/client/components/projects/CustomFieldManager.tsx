import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CustomField, type FieldType, type SelectOption } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, GripVertical, X } from "@/lib/icons";
import { toast } from "sonner";

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "url", label: "URL" },
  { value: "user", label: "User" },
];

const TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-100 text-blue-700",
  select: "bg-purple-100 text-purple-700",
  multi_select: "bg-pink-100 text-pink-700",
  number: "bg-green-100 text-green-700",
  date: "bg-amber-100 text-amber-700",
  checkbox: "bg-cyan-100 text-cyan-700",
  url: "bg-indigo-100 text-indigo-700",
  user: "bg-rose-100 text-rose-700",
};

interface Props {
  slug: string;
  projectId: string;
}

export default function CustomFieldManager({ slug, projectId }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editField, setEditField] = useState<CustomField | null>(null);

  const { data: fields = [] } = useQuery({
    queryKey: ["custom-fields", slug, projectId],
    queryFn: () => api.listCustomFields(slug, projectId),
    enabled: !!slug && !!projectId,
  });

  const deleteMutation = useMutation({
    mutationFn: (fieldId: string) => api.deleteCustomField(slug, projectId, fieldId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-fields", slug, projectId] });
      toast.success("Field deleted");
    },
    onError: () => toast.error("Failed to delete field"),
  });

  const handleCloseForm = () => {
    setShowForm(false);
    setEditField(null);
  };

  return (
    <div className="space-y-3">
      {showForm || editField ? (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{editField ? "Edit Field" : "Create Field"}</h3>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCloseForm}>
              <X className="h-3 w-3 mr-1" /> Back
            </Button>
          </div>
          <FieldForm
            slug={slug}
            projectId={projectId}
            initial={editField || undefined}
            onClose={handleCloseForm}
          />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Custom Fields</h3>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowForm(true)}
            >
              <Plus className="h-3 w-3 mr-1" /> Add Field
            </Button>
          </div>
          {fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">No custom fields yet</p>
          ) : (
            <div className="space-y-1">
              {fields.map((field) => (
                <div
                  key={field.id}
                  className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group"
                >
                  <GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  <span className="text-sm flex-1 truncate">{field.name}</span>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] ${TYPE_COLORS[field.field_type] || ""}`}
                  >
                    {FIELD_TYPES.find((t) => t.value === field.field_type)?.label ||
                      field.field_type}
                  </Badge>
                  {field.is_required && (
                    <Badge variant="outline" className="text-[10px]">
                      Required
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={() => setEditField(field)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive"
                    onClick={() => deleteMutation.mutate(field.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FieldForm({
  slug,
  projectId,
  initial,
  onClose,
}: {
  slug: string;
  projectId: string;
  initial?: CustomField;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || "");
  const [fieldType, setFieldType] = useState<FieldType>(initial?.field_type || "text");
  const [isRequired, setIsRequired] = useState(initial?.is_required || false);
  const [options, setOptions] = useState<SelectOption[]>(initial?.settings?.options || []);

  const isSelect = fieldType === "select" || fieldType === "multi_select";

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data: Record<string, unknown> = {
        name,
        field_type: fieldType,
        is_required: isRequired,
      };
      if (isSelect) {
        data.settings = { options };
      }
      if (initial) {
        return api.updateCustomField(slug, projectId, initial.id, data);
      }
      return api.createCustomField(slug, projectId, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-fields", slug, projectId] });
      toast.success(initial ? "Field updated" : "Field created");
      onClose();
    },
    onError: () => toast.error("Failed to save field"),
  });

  const addOption = () => {
    setOptions([...options, { id: crypto.randomUUID(), value: "" }]);
  };

  const removeOption = (idx: number) => {
    setOptions(options.filter((_, i) => i !== idx));
  };

  const updateOption = (idx: number, value: string) => {
    const updated = [...options];
    updated[idx] = { ...updated[idx]!, value };
    setOptions(updated);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-1 block">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Field name" />
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">Type</label>
        <Select
          value={fieldType}
          onValueChange={(v) => setFieldType(v as FieldType)}
          disabled={!!initial}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="required"
          checked={isRequired}
          onChange={(e) => setIsRequired(e.target.checked)}
          className="rounded"
        />
        <label htmlFor="required" className="text-sm">
          Required
        </label>
      </div>

      {isSelect && (
        <div>
          <label className="text-sm font-medium mb-1 block">Options</label>
          <div className="space-y-2">
            {options.map((opt, idx) => (
              <div key={opt.id} className="flex items-center gap-2">
                <Input
                  value={opt.value}
                  onChange={(e) => updateOption(idx, e.target.value)}
                  placeholder="Option value"
                  className="h-8 text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => removeOption(idx)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addOption}>
              <Plus className="h-3 w-3 mr-1" /> Add Option
            </Button>
          </div>
        </div>
      )}

      <Button
        className="w-full"
        onClick={() => saveMutation.mutate()}
        disabled={!name.trim() || saveMutation.isPending}
      >
        {saveMutation.isPending ? "Saving..." : initial ? "Update Field" : "Create Field"}
      </Button>
    </div>
  );
}
