import { create } from 'zustand';

const STORAGE_KEY = 'plane-pages-store';

interface PagesStoreState {
  favorites: string[];
  pinned: string[];
  recent: string[];
  addFavorite: (pageId: string) => void;
  removeFavorite: (pageId: string) => void;
  toggleFavorite: (pageId: string) => void;
  isFavorite: (pageId: string) => boolean;
  addPin: (pageId: string) => void;
  removePin: (pageId: string) => void;
  togglePin: (pageId: string) => void;
  isPinned: (pageId: string) => boolean;
  addRecent: (pageId: string) => void;
}

function loadFromStorage(): Pick<PagesStoreState, 'favorites' | 'pinned' | 'recent'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      };
    }
  } catch {
    // ignore
  }
  return { favorites: [], pinned: [], recent: [] };
}

function persist(state: Pick<PagesStoreState, 'favorites' | 'pinned' | 'recent'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const initial = loadFromStorage();

export const usePagesStore = create<PagesStoreState>((set, get) => ({
  favorites: initial.favorites,
  pinned: initial.pinned,
  recent: initial.recent,

  addFavorite: (pageId) => {
    set((s) => {
      if (s.favorites.includes(pageId)) return s;
      const favorites = [...s.favorites, pageId];
      persist({ favorites, pinned: s.pinned, recent: s.recent });
      return { favorites };
    });
  },

  removeFavorite: (pageId) => {
    set((s) => {
      const favorites = s.favorites.filter((id) => id !== pageId);
      persist({ favorites, pinned: s.pinned, recent: s.recent });
      return { favorites };
    });
  },

  toggleFavorite: (pageId) => {
    const state = get();
    if (state.favorites.includes(pageId)) {
      state.removeFavorite(pageId);
    } else {
      state.addFavorite(pageId);
    }
  },

  isFavorite: (pageId) => get().favorites.includes(pageId),

  addPin: (pageId) => {
    set((s) => {
      if (s.pinned.includes(pageId)) return s;
      const pinned = [...s.pinned, pageId];
      persist({ favorites: s.favorites, pinned, recent: s.recent });
      return { pinned };
    });
  },

  removePin: (pageId) => {
    set((s) => {
      const pinned = s.pinned.filter((id) => id !== pageId);
      persist({ favorites: s.favorites, pinned, recent: s.recent });
      return { pinned };
    });
  },

  togglePin: (pageId) => {
    const state = get();
    if (state.pinned.includes(pageId)) {
      state.removePin(pageId);
    } else {
      state.addPin(pageId);
    }
  },

  isPinned: (pageId) => get().pinned.includes(pageId),

  addRecent: (pageId) => {
    set((s) => {
      // Remove if already present, then prepend
      const recent = [pageId, ...s.recent.filter((id) => id !== pageId)].slice(0, 20);
      persist({ favorites: s.favorites, pinned: s.pinned, recent });
      return { recent };
    });
  },
}));
