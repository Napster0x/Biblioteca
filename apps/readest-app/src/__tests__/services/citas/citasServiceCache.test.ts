import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCitasService } from '@/services/citas/citasServiceCache';
import type { CitasService } from '@/services/citas/CitasService';
import type { AppService } from '@/types/system';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
}));

vi.mock('@/services/citas/CitasService', () => ({
  CitasService: {
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

describe('citasServiceCache', () => {
  beforeEach(() => {
    mocks.open.mockReset();
  });

  it('shares one in-flight open across concurrent calls for the same AppService', async () => {
    const appService = createAppService();
    const service = { id: 'citas-service' } as unknown as CitasService;
    const open = createDeferred<CitasService>();
    mocks.open.mockReturnValueOnce(open.promise);

    const first = getCitasService(appService);
    const second = getCitasService(appService);
    open.resolve(service);

    await expect(Promise.all([first, second])).resolves.toEqual([service, service]);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledWith(appService);
  });

  it('clears a rejected in-flight open so a later call can retry', async () => {
    const appService = createAppService();
    const service = { id: 'citas-service-retry' } as unknown as CitasService;
    const failure = new Error('database locked');
    const failedOpen = createDeferred<CitasService>();
    mocks.open.mockReturnValueOnce(failedOpen.promise).mockResolvedValueOnce(service);

    const first = getCitasService(appService);
    const second = getCitasService(appService);
    failedOpen.reject(failure);

    await expect(Promise.all([first, second])).rejects.toThrow('database locked');
    await expect(getCitasService(appService)).resolves.toBe(service);

    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(mocks.open).toHaveBeenNthCalledWith(2, appService);
  });
});
