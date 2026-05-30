import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDictionaryService } from '@/services/dictionary/dictionaryServiceCache';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import type { AppService } from '@/types/system';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
}));

vi.mock('@/services/dictionary/DictionaryService', () => ({
  DictionaryService: {
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

describe('dictionaryServiceCache', () => {
  beforeEach(() => {
    mocks.open.mockReset();
  });

  it('shares one in-flight open across concurrent calls for the same AppService', async () => {
    const appService = createAppService();
    const service = { id: 'dictionary-service' } as unknown as DictionaryService;
    const open = createDeferred<DictionaryService>();
    mocks.open.mockReturnValueOnce(open.promise);

    const first = getDictionaryService(appService);
    const second = getDictionaryService(appService);
    open.resolve(service);

    await expect(Promise.all([first, second])).resolves.toEqual([service, service]);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledWith(appService);
  });

  it('clears a rejected in-flight open so a later call can retry', async () => {
    const appService = createAppService();
    const service = { id: 'dictionary-service-retry' } as unknown as DictionaryService;
    const failure = new Error('database locked');
    const failedOpen = createDeferred<DictionaryService>();
    mocks.open.mockReturnValueOnce(failedOpen.promise).mockResolvedValueOnce(service);

    const first = getDictionaryService(appService);
    const second = getDictionaryService(appService);
    failedOpen.reject(failure);

    await expect(Promise.all([first, second])).rejects.toThrow('database locked');
    await expect(getDictionaryService(appService)).resolves.toBe(service);

    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(mocks.open).toHaveBeenNthCalledWith(2, appService);
  });
});
