import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDictionaryService } from '@/services/dictionary/dictionaryServiceCache';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

type OpenResult = DatabaseService | Promise<DatabaseService> | Error;

const openedServices = new Set<DictionaryService>();

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createDatabaseService(id: string): DatabaseService {
  return {
    execute: vi.fn(async () => ({ rowsAffected: 0, lastInsertId: 0 })),
    select: vi.fn(async () => []),
    batch: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    id,
  } as DatabaseService & { id: string };
}

function createAppService(openResults: OpenResult[]) {
  const openDatabase = vi.fn(async () => {
    const result = openResults.shift();
    if (!result) throw new Error('No database result queued');
    if (result instanceof Error) throw result;
    return result;
  });

  return {
    appService: { openDatabase } as unknown as AppService,
    openDatabase,
  };
}

async function track(promise: Promise<DictionaryService>): Promise<DictionaryService> {
  const service = await promise;
  openedServices.add(service);
  return service;
}

describe('dictionaryServiceCache', () => {
  afterEach(async () => {
    await Promise.all([...openedServices].map((service) => service.close()));
    openedServices.clear();
  });

  it('returns the same cached service instance for repeated calls with the same AppService', async () => {
    const db = createDatabaseService('dictionary-db');
    const pendingOpen = createDeferred<DatabaseService>();
    const { appService, openDatabase } = createAppService([pendingOpen.promise]);

    const first = track(getDictionaryService(appService));
    const second = track(getDictionaryService(appService));
    pendingOpen.resolve(db);

    const [firstService, secondService] = await Promise.all([first, second]);

    expect(firstService).toBe(secondService);
    expect(openDatabase).toHaveBeenCalledTimes(1);
    expect(openDatabase).toHaveBeenCalledWith('dictionary', 'dictionary.db', 'Data');
  });

  it('returns different service instances and opens separate DBs for different AppService instances', async () => {
    const firstDb = createDatabaseService('dictionary-db-a');
    const secondDb = createDatabaseService('dictionary-db-b');
    const firstApp = createAppService([firstDb]);
    const secondApp = createAppService([secondDb]);

    const firstService = await track(getDictionaryService(firstApp.appService));
    const secondService = await track(getDictionaryService(secondApp.appService));

    expect(firstService).not.toBe(secondService);
    expect(firstApp.openDatabase).toHaveBeenCalledTimes(1);
    expect(secondApp.openDatabase).toHaveBeenCalledTimes(1);
  });

  it('clears only the failed AppService cache entry without affecting another AppService', async () => {
    const failure = new Error('database locked');
    const failedOpen = createDeferred<DatabaseService>();
    const successfulDb = createDatabaseService('dictionary-db-ok');
    const retryDb = createDatabaseService('dictionary-db-retry');
    const failedApp = createAppService([failedOpen.promise, retryDb]);
    const successfulApp = createAppService([successfulDb]);

    const failedService = getDictionaryService(failedApp.appService);
    const unaffectedService = track(getDictionaryService(successfulApp.appService));
    failedOpen.reject(failure);

    await expect(failedService).rejects.toThrow('database locked');
    const resolvedUnaffectedService = await unaffectedService;
    const retriedService = await track(getDictionaryService(failedApp.appService));

    expect(retriedService).not.toBe(resolvedUnaffectedService);
    expect(failedApp.openDatabase).toHaveBeenCalledTimes(2);
    expect(successfulApp.openDatabase).toHaveBeenCalledTimes(1);
  });
});
