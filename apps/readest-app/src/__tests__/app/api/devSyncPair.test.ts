import { beforeEach, describe, expect, it, vi } from 'vitest';

function pairRequest(body: Record<string, unknown>): Request {
  return new Request('http://127.0.0.1:3000/api/dev-sync/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/dev-sync/pair', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['BIBLIOTECA_DEV_SYNC_HARNESS'] = '1';
  });

  it('returns syncDone on GET even after the other device is no longer searching or syncing', async () => {
    const route = await import('@/app/api/dev-sync/pair/route');

    await route.POST(
      pairRequest({
        deviceId: 'desktop',
        searching: false,
        syncing: false,
        progress: 100,
        syncDone: true,
      }),
    );

    const response = await route.GET(
      new Request('http://127.0.0.1:3000/api/dev-sync/pair?deviceId=android'),
    );
    const payload = await response.json();

    expect(payload).toMatchObject({
      ok: true,
      paired: true,
      otherDevice: 'desktop',
      syncing: false,
      progress: 100,
      syncDone: true,
    });
  });

  it('returns syncDone on POST when the other device has completed sync', async () => {
    const route = await import('@/app/api/dev-sync/pair/route');

    await route.POST(
      pairRequest({
        deviceId: 'desktop',
        searching: false,
        syncing: false,
        progress: 100,
        syncDone: true,
      }),
    );

    const response = await route.POST(
      pairRequest({
        deviceId: 'android',
        searching: false,
        syncing: true,
        progress: 60,
      }),
    );
    const payload = await response.json();

    expect(payload).toMatchObject({
      ok: true,
      paired: true,
      otherDevice: 'desktop',
      syncing: false,
      progress: 100,
      syncDone: true,
    });
  });
});
