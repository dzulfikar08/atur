import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { issueKey, issueLink, useIssueSearch, useNavProjects } from "@/hooks/useMyWork";
import { splitProduct } from "@/lib/product";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  FolderKanban,
  CircleDot,
  FileText,
  Settings,
  Plus,
  Columns3,
  CalendarDays,
} from "@/lib/icons";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
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
    setSearch("");
    action();
  }, []);

  const basePath = `/${slug || ""}`;

  const { ordered: projects, primary } = useNavProjects(slug, open);
  const { results: issues, isSearching } = useIssueSearch(search, slug, open);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search issues, projects, or type a command..."
      />
      <CommandList>
        {/* forceMount items are not counted by cmdk, so Empty would show beside them */}
        {issues.length === 0 && (
          <CommandEmpty>{isSearching ? "Searching…" : "No results found."}</CommandEmpty>
        )}

        {/* Issues: matched server-side, so cmdk's own filter must not hide them */}
        {issues.length > 0 && (
          <CommandGroup heading="Issues" forceMount>
            {issues.map((issue) => (
              <CommandItem
                key={issue.id}
                forceMount
                value={`issue ${issue.id}`}
                onSelect={() => run(() => navigate(issueLink(issue)))}
              >
                <CircleDot className="h-4 w-4" />
                <span className="flex-1 truncate">{splitProduct(issue.name).title}</span>
                <span className="text-xs text-muted-foreground">
                  {issue.state?.name ? `${issue.state.name} · ` : ""}
                  {issueKey(issue)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Quick actions */}
        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => run(() => navigate(basePath))}>
            <CalendarDays className="h-4 w-4" />
            Today
          </CommandItem>
          {primary && (
            <CommandItem onSelect={() => run(() => navigate(`${basePath}/projects/${primary.id}`))}>
              <FolderKanban className="h-4 w-4" />
              Go to {primary.name}
            </CommandItem>
          )}
          {primary && (
            <CommandItem
              onSelect={() => run(() => navigate(`${basePath}/projects/${primary.id}?new=1`))}
            >
              <Plus className="h-4 w-4" />
              New issue
            </CommandItem>
          )}
        </CommandGroup>
        <CommandSeparator />

        {/* Navigation */}
        <CommandGroup heading="Navigate">
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
          <CommandItem onSelect={() => run(() => navigate("/panes"))}>
            <Columns3 className="h-4 w-4" />
            {/* Absolute route — Panes is not slug-scoped. */}
            Panes
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate(`${basePath}/settings`))}>
            <Settings className="h-4 w-4" />
            Workspace Settings
          </CommandItem>
        </CommandGroup>

        {/* Projects */}
        {projects.some((p) => p.id !== primary?.id) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {projects
                .filter((p) => p.id !== primary?.id)
                .slice(0, 8)
                .map((p) => (
                  <CommandItem
                    key={p.id}
                    onSelect={() => run(() => navigate(`${basePath}/projects/${p.id}`))}
                  >
                    <FolderKanban className="h-4 w-4" />
                    <span className="flex-1 truncate">Go to {p.name}</span>
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
