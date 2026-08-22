import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Contact, type Deal } from "@/lib/api";
import { CURRENCIES } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, ChevronDown, ExternalLink } from "@/lib/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const EMPTY = { name: "", amount: "", currency: "USD", customer_id: "", expected_close_at: "" };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  slug: string;
  projectId: string;
  deal?: Deal | null;
  contacts: Contact[];
}

// One form, two modes: create (POST) and edit (PATCH with only changed keys).
// The customer picker is the Command combobox previously inline in
// PipelineBoardPage's create dialog.
export function DealFormDialog({
  open,
  onOpenChange,
  mode,
  slug,
  projectId,
  deal,
  contacts,
}: Props) {
  const qc = useQueryClient();
  const [customerOpen, setCustomerOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && deal) {
      setForm({
        name: deal.name,
        amount: deal.amount_cents ? (deal.amount_cents / 100).toFixed(2) : "",
        currency: deal.currency || "USD",
        customer_id: deal.customer_id ?? "",
        expected_close_at: deal.expected_close_at ?? "",
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, mode, deal]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["deals", slug, projectId] });
    qc.invalidateQueries({ queryKey: ["deal-stats", slug, projectId] });
  };

  const createMut = useMutation({
    mutationFn: () => {
      const amount = form.amount ? parseFloat(form.amount) : undefined;
      return api.createDeal(slug!, projectId!, {
        name: form.name,
        amount_cents:
          amount !== undefined && Number.isFinite(amount) ? Math.round(amount * 100) : undefined,
        currency: form.currency || undefined,
        customer_id: form.customer_id || undefined,
        expected_close_at: form.expected_close_at || undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
      toast.success("Deal created");
    },
    onError: () => toast.error("Failed to create deal"),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      if (!deal) throw new Error("No deal");
      // Send only changed keys; clearing the close date sends null.
      const body: Parameters<typeof api.updateDeal>[3] = {};
      if (form.name !== deal.name) body.name = form.name;
      const amount = form.amount.trim() === "" ? 0 : Math.round(parseFloat(form.amount) * 100);
      if (Number.isFinite(amount) && amount !== deal.amount_cents) body.amount_cents = amount;
      if (form.currency !== deal.currency) body.currency = form.currency;
      if ((form.customer_id || null) !== deal.customer_id)
        body.customer_id = form.customer_id || null;
      if ((form.expected_close_at || null) !== deal.expected_close_at)
        body.expected_close_at = form.expected_close_at || null;
      if (Object.keys(body).length === 0) {
        onOpenChange(false);
        return Promise.resolve(deal);
      }
      return api.updateDeal(slug!, projectId!, deal.issue_id, body);
    },
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
      toast.success("Deal updated");
    },
    onError: () => toast.error("Failed to update deal"),
  });

  const pending = createMut.isPending || updateMut.isPending;
  const submit = mode === "create" ? () => createMut.mutate() : () => updateMut.mutate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New deal" : "Edit deal"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Title</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Acme — Pro plan"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-sm font-medium">Amount</label>
              <Input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Currency</label>
              <Select
                value={form.currency}
                onValueChange={(v) => setForm({ ...form, currency: v })}
              >
                <SelectTrigger className="w-24 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Customer</label>
            <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={customerOpen}
                  className="w-full justify-between h-9"
                >
                  {form.customer_id
                    ? contacts.find((c) => c.id === form.customer_id)?.name ||
                      contacts.find((c) => c.id === form.customer_id)?.email ||
                      ""
                    : "— None —"}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search customers…" className="h-9" />
                  <CommandEmpty>No customer found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="none"
                      onSelect={() => {
                        setForm({ ...form, customer_id: "" });
                        setCustomerOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          !form.customer_id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      — None —
                    </CommandItem>
                    {contacts.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${c.id} ${c.name || ""} ${c.email || ""}`}
                        onSelect={() => {
                          setForm({ ...form, customer_id: c.id });
                          setCustomerOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            form.customer_id === c.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{c.name || c.email}</span>
                          {c.email && c.name && (
                            <span className="text-xs text-muted-foreground">{c.email}</span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label className="text-sm font-medium">Expected close</label>
            <DatePicker
              value={form.expected_close_at || null}
              onChange={(v) => setForm({ ...form, expected_close_at: v || "" })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button className="flex-1" disabled={!form.name || pending} onClick={submit}>
              {pending ? "Saving…" : mode === "create" ? "Create deal" : "Save changes"}
            </Button>
            {mode === "edit" && deal && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/${slug}/projects/${projectId}/issues/${deal.sequence_id}`}>
                  <ExternalLink className="h-4 w-4 mr-1" /> Issue
                </Link>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
