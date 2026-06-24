import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DebugSyncTrigger,
  shouldEnableDebugSyncTrigger,
  type DebugSyncTriggerEnv,
} from '@/components/DebugSyncTrigger';
import { runSyncCycle } from '@/services/sync/localSyncUtils';

vi.mock('@/services/sync/localSyncUtils', () => ({
  createPeerTransport: vi.fn(() => ({ peer: 'usb' })),
  runSyncCycle: vi.fn(async () => ({
    errors: [],
    kindsResult: {
      annotation: { pulled: 1, pushed: 0, cursor: 'ann-cursor' },
      quote: { pulled: 0, pushed: 1, cursor: 'quote-cursor' },
      'dictionary-entry': { pulled: 0, pushed: 0, cursor: 'entry-cursor' },
      'dictionary-occurrence': { pulled: 0, pushed: 0, cursor: 'occurrence-cursor' },
    },
  })),
}));

const desktopUserAgent = 'Mozilla/5.0 (X11; Linux x86_64)';
const androidUserAgent = 'Mozilla/5.0 (Linux; Android 15)';

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

function productionEnv(): DebugSyncTriggerEnv {
  return { nodeEnv: 'production', devHarness: undefined };
}

describe('DebugSyncTrigger development gating', () => {
  it('disables the debug trigger in production desktop sessions', () => {
    expect(shouldEnableDebugSyncTrigger(productionEnv(), desktopUserAgent)).toBe(false);
    expect(
      shouldEnableDebugSyncTrigger({ nodeEnv: 'development', devHarness: '1' }, androidUserAgent),
    ).toBe(false);
    expect(
      shouldEnableDebugSyncTrigger(
        { nodeEnv: 'development', devHarness: undefined },
        desktopUserAgent,
      ),
    ).toBe(true);
  });

  it('does not poll or ping when the debug trigger is disabled', () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
    globalThis.fetch = fetchMock;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    render(<DebugSyncTrigger env={productionEnv()} userAgent={desktopUserAgent} />);
    vi.advanceTimersByTime(1500);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('logs structured evidence when a dev trigger run completes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 1, ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 2, ok: true }), { status: 200 }));
    globalThis.fetch = fetchMock;

    render(<DebugSyncTrigger env={{ nodeEnv: 'development' }} userAgent={desktopUserAgent} />);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(runSyncCycle).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      '[DebugSync] evidence',
      expect.objectContaining({
        runId: 'debug-sync-count-2',
        peer: 'usb:localhost:7878',
        timestamp: '2025-01-01T00:00:02.000Z',
        direction: 'bidirectional-local-usb',
        outcome: 'success',
        changedKinds: ['annotation', 'quote'],
        cursors: expect.objectContaining({
          triggerCounter: '2',
          annotation: 'ann-cursor',
          quote: 'quote-cursor',
        }),
      }),
    );
  });
});
