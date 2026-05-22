import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../auth';

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      loading: false,
      initialized: false,
    });
  });

  it('starts with no user and not authenticated', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.initialized).toBe(false);
  });

  it('fetchUser sets user on successful response', async () => {
    const mockUser = {
      id: '123',
      email: 'test@example.com',
      display_name: 'Test User',
      username: 'testuser',
      avatar_url: null,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockUser),
    } as Response);

    await useAuthStore.getState().fetchUser();

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.isAuthenticated).toBe(true);
    expect(state.initialized).toBe(true);
  });

  it('fetchUser clears user on failed response', async () => {
    useAuthStore.setState({ user: { id: '1', email: 'a@b.c', display_name: 'X', username: 'x', avatar_url: null }, isAuthenticated: true });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
    } as Response);

    await useAuthStore.getState().fetchUser();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.initialized).toBe(true);
  });

  it('logout clears user and isAuthenticated', async () => {
    useAuthStore.setState({
      user: { id: '1', email: 'a@b.c', display_name: 'X', username: 'x', avatar_url: null },
      isAuthenticated: true,
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('login sets loading during request', async () => {
    let resolveFetch: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });

    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchPromise as Promise<Response>);

    const loginPromise = useAuthStore.getState().login('test@example.com', 'password');

    expect(useAuthStore.getState().loading).toBe(true);

    resolveFetch!({ ok: true } as Response);

    // fetchUser will also be called after login succeeds
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '1', email: 'test@example.com', display_name: 'T', username: 't', avatar_url: null }),
    } as Response);

    await loginPromise;

    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('login throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Invalid credentials'),
    } as Response);

    await expect(useAuthStore.getState().login('test@example.com', 'wrong')).rejects.toThrow('Invalid credentials');
    expect(useAuthStore.getState().loading).toBe(false);
  });
});
