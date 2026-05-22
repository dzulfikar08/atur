import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch, ApiError } from '../api';

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('constructs correct URL with /api prefix', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '1' }),
    } as Response);

    await apiFetch('/workspaces/');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/workspaces/',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });

  it('includes credentials: include', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    } as Response);

    await apiFetch('/test');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sets Content-Type to application/json by default', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    } as Response);

    await apiFetch('/test');

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.spyOn>).mock.calls[0][1] as RequestInit;
    expect(callArgs.headers).toEqual(
      expect.objectContaining({ 'Content-Type': 'application/json' }),
    );
  });

  it('allows overriding headers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    } as Response);

    await apiFetch('/test', {
      headers: { 'Content-Type': 'text/plain', 'X-Custom': 'yes' },
    });

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.spyOn>).mock.calls[0][1] as RequestInit;
    expect(callArgs.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'text/plain',
        'X-Custom': 'yes',
      }),
    );
  });

  it('throws ApiError on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    } as Response);

    await expect(apiFetch('/missing')).rejects.toThrow(ApiError);
    await expect(apiFetch('/missing')).rejects.toThrow('Not found');
  });

  it('ApiError has correct status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server error'),
    } as Response);

    try {
      await apiFetch('/fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('Server error');
    }
  });

  it('returns undefined for 204 status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 204,
    } as Response);

    const result = await apiFetch<void>('/delete');
    expect(result).toBeUndefined();
  });

  it('returns parsed JSON for successful responses', async () => {
    const data = [{ id: '1', name: 'Workspace' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    } as Response);

    const result = await apiFetch<typeof data>('/workspaces/');
    expect(result).toEqual(data);
  });

  it('uses fallback error message when response text fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('read error')),
    } as Response);

    await expect(apiFetch('/fail')).rejects.toThrow('API error: 500');
  });
});
