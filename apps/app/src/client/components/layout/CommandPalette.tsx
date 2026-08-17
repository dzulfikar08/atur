import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { FolderKanban, CircleDot, FileText, Settings, Plus, LayoutDashboard } from "@/lib/icons";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const run = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

  const basePath = `/${slug || ""}`;

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", slug],
    queryFn: () => api.listProjects(slug!),
    enabled: !!slug && open,
  });

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search issues, projects, or type a command..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Navigation */}
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => run(() => navigate(`${basePath}`))}>
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate(`${basePath}/projects`))}>
            <FolderKanban className="h-4 w-4" />
            Projects
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate(`${basePath}/issues`))}>
            <CircleDot className="h-4 w-4" />
            My Issues
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate(`${basePath}/pages`))}>
            <FileText className="h-4 w-4" />
            Pages
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate(`${basePath}/settings`))}>
            <Settings className="h-4 w-4" />
            Workspace Settings
          </CommandItem>
        </CommandGroup>

        {/* Projects */}
        {projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {projects.slice(0, 8).map((p) => (
                <CommandItem
                  key={p.id}
                  onSelect={() => run(() => navigate(`${basePath}/projects/${p.id}`))}
                >
                  <FolderKanban className="h-4 w-4" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.slug || p.id.slice(0, 6)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        {/* Quick actions */}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => navigate(`${basePath}/projects`))}>
            <Plus className="h-4 w-4" />
            Create Project
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate(`${basePath}/pages`))}>
            <Plus className="h-4 w-4" />
            Create Page
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
