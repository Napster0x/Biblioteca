import { beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshUsbSyncedStores } from '@/services/sync/refreshUsbSyncedStores';

const mocks = vi.hoisted(() => ({
  appService: {
    loadLibraryBooks: vi.fn(),
  },
  getAppService: vi.fn(),
  citasService: { listQuotes: vi.fn() },
  anotacionesService: { listAnnotations: vi.fn() },
  dictionaryService: { listEntries: vi.fn(), listAllOccurrences: vi.fn() },
  getCitasService: vi.fn(),
  getAnotacionesService: vi.fn(),
  getDictionaryService: vi.fn(),
  setLibrary: vi.fn(),
  loadQuotes: vi.fn(),
  loadAnnotations: vi.fn(),
  loadEntries: vi.fn(),
}));

vi.mock('@/services/environment', () => ({
  default: {
    getAppService: mocks.getAppService,
  },
}));

vi.mock('@/services/citas/citasServiceCache', () => ({
  getCitasService: mocks.getCitasService,
}));

vi.mock('@/services/annotations/annotacionesServiceCache', () => ({
  getAnotacionesService: mocks.getAnotacionesService,
}));

vi.mock('@/services/dictionary/dictionaryServiceCache', () => ({
  getDictionaryService: mocks.getDictionaryService,
}));

vi.mock('@/store/citasStore', () => ({
  useCitasStore: {
    getState: () => ({ loadQuotes: mocks.loadQuotes }),
  },
}));

vi.mock('@/store/annotacionesStore', () => ({
  useAnotacionesStore: {
    getState: () => ({ loadAnnotations: mocks.loadAnnotations }),
  },
}));

vi.mock('@/store/dictionaryStore', () => ({
  useDictionaryStore: {
    getState: () => ({ loadEntries: mocks.loadEntries }),
  },
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({ setLibrary: mocks.setLibrary }),
  },
}));

describe('refreshUsbSyncedStores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAppService.mockResolvedValue(mocks.appService);
    mocks.getCitasService.mockResolvedValue(mocks.citasService);
    mocks.getAnotacionesService.mockResolvedValue(mocks.anotacionesService);
    mocks.getDictionaryService.mockResolvedValue(mocks.dictionaryService);
    mocks.appService.loadLibraryBooks.mockResolvedValue([{ hash: 'book-1', title: 'Synced book' }]);
    mocks.loadQuotes.mockResolvedValue(undefined);
    mocks.loadAnnotations.mockResolvedValue(undefined);
    mocks.loadEntries.mockResolvedValue(undefined);
  });

  it('reloads quote, annotation, dictionary, and library stores from persistent services', async () => {
    await refreshUsbSyncedStores();

    expect(mocks.getAppService).toHaveBeenCalledOnce();
    expect(mocks.getCitasService).toHaveBeenCalledWith(mocks.appService);
    expect(mocks.loadQuotes).toHaveBeenCalledWith(mocks.citasService);
    expect(mocks.getAnotacionesService).toHaveBeenCalledWith(mocks.appService);
    expect(mocks.loadAnnotations).toHaveBeenCalledWith(mocks.anotacionesService);
    expect(mocks.getDictionaryService).toHaveBeenCalledWith(mocks.appService);
    expect(mocks.loadEntries).toHaveBeenCalledWith(mocks.dictionaryService);
    expect(mocks.setLibrary).toHaveBeenCalledWith([{ hash: 'book-1', title: 'Synced book' }]);
  });

  it('still refreshes later stores when one store reload fails', async () => {
    mocks.loadQuotes.mockRejectedValueOnce(new Error('quote reload failed'));

    await refreshUsbSyncedStores();

    expect(mocks.loadQuotes).toHaveBeenCalledWith(mocks.citasService);
    expect(mocks.loadAnnotations).toHaveBeenCalledWith(mocks.anotacionesService);
    expect(mocks.loadEntries).toHaveBeenCalledWith(mocks.dictionaryService);
    expect(mocks.setLibrary).toHaveBeenCalledWith([{ hash: 'book-1', title: 'Synced book' }]);
  });

  it('does not reject when the app service is temporarily unavailable', async () => {
    mocks.getAppService.mockRejectedValueOnce(new Error('app service unavailable'));

    await expect(refreshUsbSyncedStores()).resolves.toBeUndefined();

    expect(mocks.getCitasService).not.toHaveBeenCalled();
    expect(mocks.loadQuotes).not.toHaveBeenCalled();
  });
});
