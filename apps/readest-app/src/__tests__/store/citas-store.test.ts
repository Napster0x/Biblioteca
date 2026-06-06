import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCitasStore } from '@/store/citasStore';
import type { CitasService } from '@/services/citas/CitasService';
import type { Cite, CiteInput, CiteUpdate } from '@/types/citas';

const quoteOne: Cite = {
  id: 'cite-1',
  bookHash: 'book-1',
  bookTitle: 'Ficciones',
  bookAuthor: 'Borges',
  cfi: '/6/4',
  sectionHref: null,
  page: 12,
  text: 'El universo es una vasta biblioteca.',
  contextBefore: 'En el centro',
  contextAfter: 'dijo el bibliotecario.',
  contentHash: 'hash-1',
  createdAt: 1,
  updatedAt: null,
};

const quoteTwo: Cite = {
  id: 'cite-2',
  bookHash: 'book-2',
  bookTitle: 'El Aleph',
  bookAuthor: 'Borges',
  cfi: '/6/8',
  sectionHref: 'sec-2',
  page: 33,
  text: 'Siempre imaginé que el Paraíso sería una especie de biblioteca.',
  contextBefore: null,
  contextAfter: null,
  contentHash: 'hash-2',
  createdAt: 2,
  updatedAt: 2,
};

function asCitasService(service: Partial<CitasService>): CitasService {
  return service as CitasService;
}

describe('citasStore', () => {
  afterEach(() => {
    useCitasStore.getState().reset();
  });

  it('initializes with the documented default state', () => {
    const state = useCitasStore.getState();

    expect(state.quotes).toEqual([]);
    expect(state.quote).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.isSelectMode).toBe(false);
    expect(state.selectedQuoteIds).toEqual([]);
    expect(state.searchQuery).toBe('');
    expect(state.captureError).toBeNull();
  });

  it('loads quotes from the service and sets them in state', async () => {
    const mockQuotes = [quoteOne, quoteTwo];
    const service = { listQuotes: vi.fn().mockResolvedValue(mockQuotes) };

    await useCitasStore.getState().loadQuotes(asCitasService(service));

    const state = useCitasStore.getState();
    expect(state.quotes).toEqual(mockQuotes);
    expect(state.isLoading).toBe(false);
    expect(service.listQuotes).toHaveBeenCalledOnce();
  });

  it('flips isLoading to true while loadQuotes is in flight', async () => {
    const service = {
      listQuotes: vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 10))),
    };

    const loadPromise = useCitasStore.getState().loadQuotes(asCitasService(service));
    expect(useCitasStore.getState().isLoading).toBe(true);
    await loadPromise;
    expect(useCitasStore.getState().isLoading).toBe(false);
  });

  it('searches quotes via the service and updates searchQuery plus quotes', async () => {
    const matches = [quoteTwo];
    const service = { searchQuotes: vi.fn().mockResolvedValue(matches) };

    await useCitasStore.getState().searchQuotes('Paraíso', asCitasService(service));

    const state = useCitasStore.getState();
    expect(state.searchQuery).toBe('Paraíso');
    expect(state.quotes).toEqual(matches);
    expect(state.isLoading).toBe(false);
    expect(service.searchQuotes).toHaveBeenCalledWith('Paraíso');
  });

  it('creates a quote via the service, prepends it to the list, and returns the new quote', async () => {
    const existing = quoteOne;
    const created: Cite = {
      ...quoteTwo,
      id: 'cite-3',
      contentHash: 'hash-3',
      createdAt: 3,
    };
    const service = { createQuote: vi.fn().mockResolvedValue(created) };
    useCitasStore.getState().setQuotes([existing]);

    const input: CiteInput = {
      bookHash: 'book-2',
      bookTitle: created.bookTitle,
      bookAuthor: created.bookAuthor,
      cfi: created.cfi,
      sectionHref: created.sectionHref,
      page: created.page,
      text: created.text,
      contextBefore: created.contextBefore,
      contextAfter: created.contextAfter,
    };
    const result = await useCitasStore.getState().createQuote(input, asCitasService(service));

    const state = useCitasStore.getState();
    expect(service.createQuote).toHaveBeenCalledWith(input);
    expect(result).toEqual(created);
    expect(state.quotes).toEqual([created, existing]);
    expect(state.isLoading).toBe(false);
  });

  it('updates a quote via the service and replaces the matching entry in state', async () => {
    const updated: Cite = {
      ...quoteOne,
      text: 'Texto editado',
      updatedAt: 5,
    };
    const service = { updateQuote: vi.fn().mockResolvedValue(updated) };
    useCitasStore.getState().setQuotes([quoteOne, quoteTwo]);
    useCitasStore.getState().setQuote(quoteOne);

    const patch: CiteUpdate = { id: 'cite-1', text: 'Texto editado' };
    const result = await useCitasStore.getState().updateQuote(patch, asCitasService(service));

    const state = useCitasStore.getState();
    expect(service.updateQuote).toHaveBeenCalledWith(patch);
    expect(result).toEqual(updated);
    expect(state.quotes).toEqual([updated, quoteTwo]);
    expect(state.quote).toEqual(updated);
    expect(state.isLoading).toBe(false);
  });

  it('enters select mode, toggles ids, and clears selection on cancel', () => {
    const store = useCitasStore.getState();

    store.enterSelectMode();
    store.toggleSelectedQuote('cite-1');
    store.toggleSelectedQuote('cite-2');
    store.toggleSelectedQuote('cite-1');

    expect(useCitasStore.getState().isSelectMode).toBe(true);
    expect(useCitasStore.getState().selectedQuoteIds).toEqual(['cite-2']);

    useCitasStore.getState().cancelSelectMode();

    expect(useCitasStore.getState().isSelectMode).toBe(false);
    expect(useCitasStore.getState().selectedQuoteIds).toEqual([]);
  });

  it('clears all state during reset', () => {
    useCitasStore.getState().setQuotes([quoteOne, quoteTwo]);
    useCitasStore.getState().setQuote(quoteOne);
    useCitasStore.getState().setSearchQuery('Paraíso');
    useCitasStore.getState().setCaptureError('boom');
    useCitasStore.getState().enterSelectMode();
    useCitasStore.getState().toggleSelectedQuote('cite-1');

    useCitasStore.getState().reset();

    const state = useCitasStore.getState();
    expect(state.quotes).toEqual([]);
    expect(state.quote).toBeNull();
    expect(state.searchQuery).toBe('');
    expect(state.captureError).toBeNull();
    expect(state.isSelectMode).toBe(false);
    expect(state.selectedQuoteIds).toEqual([]);
  });

  it('bulk deletes selected quotes, prunes them from state, and exits select mode', async () => {
    const service = { deleteQuotes: vi.fn().mockResolvedValue(undefined) };

    useCitasStore.getState().setQuotes([quoteOne, quoteTwo]);
    useCitasStore.getState().setQuote(quoteTwo);
    useCitasStore.getState().enterSelectMode();
    useCitasStore.getState().toggleSelectedQuote('cite-2');

    await useCitasStore.getState().deleteSelectedQuotes(asCitasService(service));

    const state = useCitasStore.getState();
    expect(service.deleteQuotes).toHaveBeenCalledWith(['cite-2']);
    expect(state.quotes).toEqual([quoteOne]);
    expect(state.quote).toBeNull();
    expect(state.selectedQuoteIds).toEqual([]);
    expect(state.isSelectMode).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it('deleteQuotes removes the requested ids from SQL-backed service and local state', async () => {
    const service = { deleteQuotes: vi.fn().mockResolvedValue(undefined) };
    useCitasStore.getState().setQuotes([quoteOne, quoteTwo]);
    useCitasStore.getState().setQuote(quoteOne);

    await useCitasStore.getState().deleteQuotes(['cite-1'], asCitasService(service));

    const state = useCitasStore.getState();
    expect(service.deleteQuotes).toHaveBeenCalledWith(['cite-1']);
    expect(state.quotes).toEqual([quoteTwo]);
    expect(state.quote).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it('removeQuotesFromState prunes external reader-synced deletes without calling SQL', () => {
    useCitasStore.getState().setQuotes([quoteOne, quoteTwo]);
    useCitasStore.getState().setQuote(quoteTwo);
    useCitasStore.getState().enterSelectMode();
    useCitasStore.getState().toggleSelectedQuote('cite-1');
    useCitasStore.getState().toggleSelectedQuote('cite-2');

    useCitasStore.getState().removeQuotesFromState(['cite-2']);

    const state = useCitasStore.getState();
    expect(state.quotes).toEqual([quoteOne]);
    expect(state.quote).toBeNull();
    expect(state.selectedQuoteIds).toEqual(['cite-1']);
  });

  it('does not call delete service when no quotes are selected', async () => {
    const service = { deleteQuotes: vi.fn().mockResolvedValue(undefined) };

    await useCitasStore.getState().deleteSelectedQuotes(asCitasService(service));

    expect(service.deleteQuotes).not.toHaveBeenCalled();
    expect(useCitasStore.getState().isLoading).toBe(false);
  });

  it('round-trip: create → list → select → delete returns to an empty state', async () => {
    const stored: Cite[] = [];
    const service = {
      createQuote: vi.fn().mockImplementation(async (input: CiteInput): Promise<Cite> => {
        const created: Cite = {
          ...input,
          id: 'cite-rt',
          contentHash: 'hash-rt',
          createdAt: 1700000000000,
          updatedAt: null,
        };
        stored.push(created);
        return created;
      }),
      listQuotes: vi.fn().mockImplementation(async (): Promise<Cite[]> => [...stored]),
      deleteQuotes: vi.fn().mockImplementation(async (ids: readonly string[]): Promise<void> => {
        const set = new Set(ids);
        for (let i = stored.length - 1; i >= 0; i--) {
          const quote = stored[i];
          if (quote && set.has(quote.id)) stored.splice(i, 1);
        }
      }),
    };

    const input: CiteInput = {
      bookHash: 'book-rt',
      bookTitle: 'Round Trip',
      bookAuthor: 'RT',
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'el viaje completo',
      contextBefore: null,
      contextAfter: null,
    };

    // 1. create
    const created = await useCitasStore.getState().createQuote(input, asCitasService(service));
    expect(created.id).toBe('cite-rt');
    expect(stored).toHaveLength(1);

    // 2. list (loadQuotes)
    await useCitasStore.getState().loadQuotes(asCitasService(service));
    const [loadedQuote] = useCitasStore.getState().quotes;
    expect(loadedQuote?.id).toBe('cite-rt');

    // 3. enter select-mode + toggle
    useCitasStore.getState().enterSelectMode();
    useCitasStore.getState().toggleSelectedQuote('cite-rt');
    expect(useCitasStore.getState().isSelectMode).toBe(true);
    expect(useCitasStore.getState().selectedQuoteIds).toEqual(['cite-rt']);

    // 4. deleteSelectedQuotes
    await useCitasStore.getState().deleteSelectedQuotes(asCitasService(service));
    expect(stored).toHaveLength(0);
    expect(useCitasStore.getState().quotes).toHaveLength(0);
    expect(useCitasStore.getState().selectedQuoteIds).toEqual([]);
    expect(useCitasStore.getState().isSelectMode).toBe(false);
  });

  it('does not expose a softDeleteDictionaryHighlights action', () => {
    const state = useCitasStore.getState() as unknown as Record<string, unknown>;
    expect(state['softDeleteDictionaryHighlights']).toBeUndefined();
  });
});
