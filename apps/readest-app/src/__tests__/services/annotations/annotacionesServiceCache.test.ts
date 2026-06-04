import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnotacionesService } from '@/services/annotations/annotacionesServiceCache';
import type { AnotacionesService } from '@/services/annotations/AnotacionesService';
import type { AppService } from '@/types/system';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
}));

vi.mock('@/services/annotations/AnotacionesService', () => ({
  AnotacionesService: {
    open: mocks.open,
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createAppService(): AppService {
  return { platform: 'test' } as unknown as AppService;
}

describe('annotacionesServiceCache', () => {
  beforeEach(() => {
    mocks.open.mockReset();
  });

  it('shares one in-flight open across concurrent calls for the same AppService', async () => {
    const appService = createAppService();
    const service = { id: 'annotaciones-service' } as unknown as AnotacionesService;
    const open = createDeferred<AnotacionesService>();
    mocks.open.mockReturnValueOnce(open.promise);

    const first = getAnotacionesService(appService);
    const second = getAnotacionesService(appService);
    open.resolve(service);

    await expect(Promise.all([first, second])).resolves.toEqual([service, service]);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledWith(appService);
  });

  it('clears a rejected in-flight open so a later call can retry', async () => {
    const appService = createAppService();
    const service = { id: 'annotaciones-service-retry' } as unknown as AnotacionesService;
    const failure = new Error('database locked');
    const failedOpen = createDeferred<AnotacionesService>();
    mocks.open.mockReturnValueOnce(failedOpen.promise).mockResolvedValueOnce(service);

    const first = getAnotacionesService(appService);
    const second = getAnotacionesService(appService);
    failedOpen.reject(failure);

    await expect(Promise.all([first, second])).rejects.toThrow('database locked');
    await expect(getAnotacionesService(appService)).resolves.toBe(service);

    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(mocks.open).toHaveBeenNthCalledWith(2, appService);
  });
});
