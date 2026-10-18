import { create } from "zustand";

// Per-workspace pinned and recently visited project ids, kept in localStorage.
// Feeds the sidebar's Projects section and the "primary project" that the
// palette and shortcuts jump to.
const STORAGE_KEY = "atur-project-nav";
const MAX_RECENT = 5;

type ByWorkspace = Record<string, string[]>;

interface Persisted {
  pinned: ByWorkspace;
  recent: ByWorkspace;
}

interface ProjectNavState extends Persisted {
  trackVisit: (slug: string, projectId: string) => void;
  togglePin: (slug: string, projectId: string) => void;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return { pinned: parsed.pinned ?? {}, recent: parsed.recent ?? {} };
    }
  } catch {
    // corrupt or unavailable storage: start empty
  }
  return { pinned: {}, recent: {} };
}

export const useProjectNavStore = create<ProjectNavState>((set, get) => {
  const commit = (next: Persisted) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
    set(next);
  };
  return {
    ...load(),
    trackVisit: (slug, projectId) => {
      const { pinned, recent } = get();
      const list = recent[slug] ?? [];
      if (list[0] === projectId) return;
      commit({
        pinned,
        recent: {
          ...recent,
          [slug]: [projectId, ...list.filter((id) => id !== projectId)].slice(0, MAX_RECENT),
        },
      });
    },
    togglePin: (slug, projectId) => {
      const { pinned, recent } = get();
      const list = pinned[slug] ?? [];
      commit({
        recent,
        pinned: {
          ...pinned,
          [slug]: list.includes(projectId)
            ? list.filter((id) => id !== projectId)
            : [...list, projectId],
        },
      });
    },
  };
});
