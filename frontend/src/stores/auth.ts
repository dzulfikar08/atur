import { create } from 'zustand';
import { ApiError } from '@/lib/api';

interface User {
  id: string;
  email: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  initialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, username: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  loading: false,
  initialized: false,

  login: async (email, password) => {
    set({ loading: true });
    try {
      const res = await fetch('/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        throw new ApiError(res.status, await res.text().catch(() => ''));
      }
      await get().fetchUser();
    } finally {
      set({ loading: false });
    }
  },

  register: async (email, password, username) => {
    set({ loading: true });
    try {
      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, username }),
      });
      if (!res.ok) {
        throw new ApiError(res.status, await res.text().catch(() => ''));
      }
      await get().fetchUser();
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    await fetch('/auth/sign-out', { method: 'POST', credentials: 'include' });
    set({ user: null, isAuthenticated: false });
  },

  fetchUser: async () => {
    try {
      const res = await fetch('/api/users/me/', { credentials: 'include' });
      if (res.ok) {
        const user = await res.json();
        set({ user, isAuthenticated: true, initialized: true });
      } else {
        set({ user: null, isAuthenticated: false, initialized: true });
      }
    } catch {
      set({ user: null, isAuthenticated: false, initialized: true });
    }
  },
}));
