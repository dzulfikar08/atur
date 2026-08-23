import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, MoreHorizontal, Pencil, Trash2 } from "@/lib/icons";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_COLORS: Record<string, string> = {
  lead: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  active: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  churned: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const EMPTY = { email: "", name: "", company: "", phone: "", source: "" };

export default function ContactsListPage() {
  const { slug } = useParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const isAll = slug === "all";

  const { data, isLoading } = useQuery({
    queryKey: ["contacts", slug, search, status],
    queryFn: async () =>
      isAll
        ? (await api.listAllContacts({ search: search || undefined, status: status || undefined }))
            .results
        : api.listContacts(slug!, { search: search || undefined, status: status || undefined }),
    enabled: !!slug,
  });

  const createMut = useMutation({
    mutationFn: (body: typeof form) => api.createContact(slug!, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", slug] });
      setCreateOpen(false);
      setForm(EMPTY);
      toast.success("Contact created");
    },
    onError: () => toast.error("Failed to create contact"),
  });

  const updateMut = useMutation({
    mutationFn: (body: Partial<typeof form>) =>
      api.updateContact(editing.workspace_slug || slug!, editing.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", slug] });
      setEditing(null);
      toast.success("Contact updated");
    },
    onError: () => toast.error("Failed to update contact"),
  });

  const deleteMut = useMutation({
    mutationFn: ({ id, wsSlug }: { id: string; wsSlug: string }) => api.deleteContact(wsSlug, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", slug] });
      setDeleteTarget(null);
      toast.success("Contact deleted");
    },
    onError: () => toast.error("Failed to delete contact"),
  });

  useEffect(() => {
    if (editing) {
      setForm({
        email: editing.email ?? "",
        name: editing.name ?? "",
        company: editing.company ?? "",
        phone: editing.phone ?? "",
        source: editing.source ?? "",
      });
    } else {
      setForm(EMPTY);
    }
  }, [editing]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Contacts</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          {!isAll && (
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> New Lead
              </Button>
            </DialogTrigger>
          )}
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New contact</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Email</label>
                <Input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="name@company.com"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Company</label>
                <Input
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Phone</label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Source</label>
                <Input
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  placeholder="referral, ads, …"
                />
              </div>
              <Button
                className="w-full"
                disabled={!form.email || createMut.isPending}
                onClick={() => createMut.mutate(form)}
              >
                {createMut.isPending ? "Creating…" : "Create contact"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit contact</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Email</label>
                <Input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="name@company.com"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Company</label>
                <Input
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Phone</label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Source</label>
                <Input
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  placeholder="referral, ads, …"
                />
              </div>
              <Button
                className="w-full"
                disabled={!form.email || updateMut.isPending}
                onClick={() => updateMut.mutate(form)}
              >
                {updateMut.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete contact?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This action cannot be undone. Remove{" "}
              <span className="font-medium">{deleteTarget?.name || deleteTarget?.email}</span>?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={() => {
                  if (deleteTarget)
                    deleteMut.mutate({
                      id: deleteTarget.id,
                      wsSlug: deleteTarget.workspace_slug || slug!,
                    });
                }}
              >
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Search contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="lead">Lead</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="churned">Churned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Email</th>
                  <th className="text-left p-3 font-medium">Company</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  {isAll && <th className="text-left p-3 font-medium">Workspace</th>}
                  {!isAll && <th className="p-3" />}
                </tr>
              </thead>
              <tbody>
                {data?.map((c: any) => (
                  <tr key={c.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <Link
                        to={`/${c.workspace_slug || slug}/crm/contacts/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.name || c.email || "—"}
                      </Link>
                    </td>
                    <td className="p-3 text-muted-foreground">{c.email || "—"}</td>
                    <td className="p-3 text-muted-foreground">{c.company || "—"}</td>
                    <td className="p-3">
                      <Badge variant="secondary" className={STATUS_COLORS[c.status] || ""}>
                        {c.status}
                      </Badge>
                    </td>
                    {isAll && (
                      <td className="p-3 text-muted-foreground">{c.workspace_name || "—"}</td>
                    )}
                    {!isAll && (
                      <td className="p-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditing(c)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteTarget(c)}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    )}
                  </tr>
                ))}
                {data?.length === 0 && (
                  <tr>
                    <td colSpan={isAll ? 6 : 5} className="p-6 text-center text-muted-foreground">
                      No contacts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
