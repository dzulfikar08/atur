import { create } from "zustand";
import { ApiError, portalApi, type PortalCustomer } from "@/lib/portalApi";

interface PortalAuthState {
  customer: PortalCustomer | null;
  initialized: boolean;
  loading: boolean;
  slug: string | null;
  fetchCustomer: (slug: string) => Promise<void>;
  signOut: (slug: string) => Promise<void>;
  setCustomer: (c: PortalCustomer | null) => void;
  reset: () => void;
}

export const usePortalAuthStore = create<PortalAuthState>((set) => ({
  customer: null,
  initialized: false,
  loading: false,
  slug: null,

  fetchCustomer: async (slug) => {
    set({ loading: true, slug });
    try {
      const { customer } = await portalApi.getMe(slug);
      set({ customer, initialized: true });
    } catch (err) {
      // 401/403 = not signed in (expected); anything else still resolves init.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        set({ customer: null, initialized: true });
      } else {
        set({ customer: null, initialized: true });
      }
    } finally {
      set({ loading: false });
    }
  },

  signOut: async (slug) => {
    try {
      await portalApi.signOut(slug);
    } catch {
      // best-effort
    }
    set({ customer: null, initialized: false, slug: null });
  },

  setCustomer: (customer) => set({ customer, initialized: true }),
  reset: () => set({ customer: null, initialized: false, slug: null, loading: false }),
}));
