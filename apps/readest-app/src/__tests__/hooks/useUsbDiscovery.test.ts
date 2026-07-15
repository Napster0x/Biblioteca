import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUsbDiscovery } from '@/hooks/useUsbDiscovery';

const syncMocks = vi.hoisted(() => ({
  runSyncCycle: vi.fn(),
}));

const refreshMocks = vi.hoisted(() => ({
  refreshUsbSyncedStores: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('not available in jsdom')),
}));

vi.mock('@/services/sync/USBHttpTransport', () => ({
  USBHttpTransport: vi.fn(),
}));

vi.mock('@/services/sync/localSyncUtils', () => ({
  ALL_KINDS: ['dict-entry'],
  runSyncCycle: syncMocks.runSyncCycle,
}));

vi.mock('@/services/sync/refreshUsbSyncedStores', () => ({
  refreshUsbSyncedStores: refreshMocks.refreshUsbSyncedStores,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function pairResponse(result: {
  paired?: boolean;
  syncing?: boolean;
  progress?: number;
  runId?: string | null;
  syncDone?: boolean;
}) {
  return {
    paired: result.paired ?? false,
    syncing: result.syncing ?? false,
    progress: result.progress ?? 0,
    runId: result.runId,
    syncDone: result.syncDone ?? false,
  };
}

/**
 * Set up the mock fetch to respond to pair POSTs and sync-trigger calls.
 *
 * The `pairState` controls what the POST to /api/dev-sync/pair returns.
 * `progressForRunId` controls what GET /api/sync-trigger/progress returns.
 */
function setupMock(options: {
  pairOnPost?: ReturnType<typeof pairResponse>;
  syncTriggerResponse?: Record<string, unknown>;
  progressResponse?: Record<string, unknown>;
}) {
  mockFetch.mockReset();

  const {
    pairOnPost = pairResponse({}),
    syncTriggerResponse = { ok: true, runId: 'test-run-123' },
    progressResponse = { ok: true, progress: 0, phase: 'init' },
  } = options;

  mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
    const urlStr = String(url);

    // POST to /api/dev-sync/pair
    if (urlStr.includes('/api/dev-sync/pair') && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(pairOnPost),
      });
    }

    // DELETE to /api/dev-sync/pair
    if (urlStr.includes('/api/dev-sync/pair') && init?.method === 'DELETE') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }

    // POST to /api/sync-trigger (fire-and-forget)
    if (urlStr === 'http://127.0.0.1:3000/api/sync-trigger' && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(syncTriggerResponse),
      });
    }

    // GET /api/sync-trigger/progress?runId=...
    if (urlStr.includes('/api/sync-trigger/progress')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(progressResponse),
      });
    }

    // Default
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useUsbDiscovery', () => {
  describe('startSearching / cancelSearching', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      syncMocks.runSyncCycle.mockReset();
      syncMocks.runSyncCycle.mockResolvedValue(undefined);
      setupMock({});
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('transitions from idle to searching and back', () => {
      const { result } = renderHook(() => useUsbDiscovery());
      expect(result.current.state).toBe('idle');

      act(() => {
        result.current.startSearching();
      });
      expect(result.current.state).toBe('searching');

      act(() => {
        result.current.cancelSearching();
      });
      expect(result.current.state).toBe('idle');
    });
  });

  describe('pairing flow', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      setupMock({
        pairOnPost: pairResponse({ paired: false, syncing: false }),
      });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('transitions to paired when other device is active', async () => {
      setupMock({
        pairOnPost: pairResponse({ paired: true, syncing: false }),
      });

      const { result } = renderHook(() => useUsbDiscovery());

      act(() => {
        result.current.startSearching();
      });

      // Flush the initial tick + pending microtasks
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.state).toBe('paired');
    });

    it('returns to searching when other device disappears', async () => {
      // First pair
      setupMock({
        pairOnPost: pairResponse({ paired: true, syncing: false }),
      });

      const { result } = renderHook(() => useUsbDiscovery());

      act(() => {
        result.current.startSearching();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.state).toBe('paired');

      // Then unpair (other device disappears)
      setupMock({
        pairOnPost: pairResponse({ paired: false, syncing: false }),
      });

      // Let the tick fire (paired state uses 4s polling)
      await act(async () => {
        vi.advanceTimersByTime(4000);
        await Promise.resolve();
      });

      expect(result.current.state).toBe('searching');
    });
  });

  describe('sync flow', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      syncMocks.runSyncCycle.mockReset();
      syncMocks.runSyncCycle.mockResolvedValue(undefined);
      refreshMocks.refreshUsbSyncedStores.mockReset();
      refreshMocks.refreshUsbSyncedStores.mockResolvedValue(undefined);
      setupMock({});
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('startSync transitions to syncing with progress 0', () => {
      const { result } = renderHook(() => useUsbDiscovery());

      act(() => {
        result.current.startSync();
      });

      expect(result.current.state).toBe('syncing');
      expect(result.current.progress).toBe(0);
    });

    it('returns progress in the result interface', () => {
      const { result } = renderHook(() => useUsbDiscovery());

      // Start syncing
      act(() => {
        result.current.startSync();
      });

      expect(result.current.state).toBe('syncing');
      expect(result.current.progress).toBe(0);
      expect(typeof result.current.progress).toBe('number');
    });

    it('cleanup on unmount stops sync', () => {
      const { result, unmount } = renderHook(() => useUsbDiscovery());

      act(() => {
        result.current.startSync();
      });
      expect(result.current.state).toBe('syncing');

      // Unmount should clean up without errors
      expect(() => unmount()).not.toThrow();
    });

    it('keeps syncDone visible longer than the fast polling interval before clearing pair state', async () => {
      const { result } = renderHook(() => useUsbDiscovery());

      act(() => {
        result.current.startSync();
      });

      await act(async () => {
        await Promise.resolve();
      });

      const pairCallsBeforeGrace = mockFetch.mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/api/dev-sync/pair') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );

      expect(
        pairCallsBeforeGrace.some(([, init]) => {
          const body = JSON.parse(String((init as RequestInit).body));
          return body.syncDone === true && body.progress === 100;
        }),
      ).toBe(true);
      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/dev-sync/pair') &&
            (init as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/dev-sync/pair') &&
            (init as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/dev-sync/pair') &&
            (init as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true);
    });

    it('refreshes visible stores after desktop finishes the USB sync cycle', async () => {
      const { result } = renderHook(() => useUsbDiscovery());

      act(() => {
        result.current.startSync();
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(syncMocks.runSyncCycle).toHaveBeenCalledOnce();
      expect(refreshMocks.refreshUsbSyncedStores).toHaveBeenCalledOnce();
      expect(result.current.state).toBe('idle');
      expect(result.current.progress).toBe(100);
    });

    it('refreshes visible stores when Android observes syncDone from desktop', async () => {
      const originalUserAgent = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 Android wv',
      });
      setupMock({
        pairOnPost: pairResponse({ syncDone: true, progress: 100 }),
      });

      const { result } = renderHook(() => useUsbDiscovery());

      act(() => {
        result.current.startSync();
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(syncMocks.runSyncCycle).not.toHaveBeenCalled();
      expect(refreshMocks.refreshUsbSyncedStores).toHaveBeenCalledOnce();
      expect(result.current.state).toBe('idle');
      expect(result.current.progress).toBe(100);

      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent,
      });
    });
  });
});
