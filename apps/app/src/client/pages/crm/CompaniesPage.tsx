import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Company } from "@/lib/api";
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

const EMPTY = {
  name: "",
  domain: "",
  industry: "",
  website: "",
  description: "",
};

export default function CompaniesPage() {
  const { slug } = useParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["companies", slug, search],
    queryFn: () => api.listCompanies(slug!, { search: search || undefined }),
    enabled: !!slug,
  });

  const createMut = useMutation({
    mutationFn: (body: typeof form) => api.createCompany(slug!, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies", slug] });
      setCreateOpen(false);
      setForm(EMPTY);
      toast.success("Company created");
    },
    onError: () => toast.error("Failed to create company"),
  });

  const updateMut = useMutation({
    mutationFn: (body: Partial<typeof form>) => api.updateCompany(slug!, editing!.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies", slug] });
      qc.invalidateQueries({ queryKey: ["contacts", slug] });
      setEditing(null);
      toast.success("Company updated");
    },
    onError: () => toast.error("Failed to update company"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteCompany(slug!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies", slug] });
      qc.invalidateQueries({ queryKey: ["contacts", slug] });
      setDeleteTarget(null);
      toast.success("Company deleted — contacts kept, unlinked");
    },
    onError: () => toast.error("Failed to delete company"),
  });

  const openEdit = (c: Company) => {
    setEditing(c);
    setForm({
      name: c.name ?? "",
      domain: c.domain ?? "",
      industry: c.industry ?? "",
      website: c.website ?? "",
      description: c.description ?? "",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Companies</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> New Company
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>New company</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <Input
                placeholder="Name *"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <Input
                placeholder="Domain (e.g. acme.com)"
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
              />
              <Input
                placeholder="Industry"
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              />
              <Input
                placeholder="Website"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
              <Input
                placeholder="Description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!form.name.trim() || createMut.isPending}
                  onClick={() => createMut.mutate(form)}
                >
                  {createMut.isPending ? "Creating…" : "Create"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Input
        placeholder="Search companies…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Domain</th>
                <th className="px-4 py-2 font-medium">Industry</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : (data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-muted-foreground">
                    No companies yet.
                  </td>
                </tr>
              ) : (
                (data ?? []).map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        to={`/${slug}/crm/companies/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.domain ?? "—"}</td>
                    <td className="px-4 py-2">
                      {c.industry ? <Badge variant="outline">{c.industry}</Badge> : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(c)}>
                            <Pencil className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => setDeleteTarget(c)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit company</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              placeholder="Name *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              placeholder="Domain"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
            />
            <Input
              placeholder="Industry"
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
            />
            <Input
              placeholder="Website"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
            <Input
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!form.name.trim() || updateMut.isPending}
                onClick={() => updateMut.mutate(form)}
              >
                {updateMut.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Contacts stay — they're just unlinked from this company.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMut.isPending}
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
