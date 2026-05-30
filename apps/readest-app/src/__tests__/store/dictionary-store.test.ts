import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDictionaryStore } from '@/store/dictionaryStore';

describe('dictionaryStore', () => {
  afterEach(() => {
    useDictionaryStore.getState().reset();
  });

  it('loads entries from service and sets them in state', async () => {
    const mockEntries = [
      {
        id: 'entry-1',
        term: 'serendipia',
        displayTerm: 'serendipia',
        enrichmentStatus: 'pending' as const,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'entry-2',
        term: 'ephemeral',
        displayTerm: 'ephemeral',
        enrichmentStatus: 'ready' as const,
        definition: 'fleeting',
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const service = { listEntries: vi.fn().mockResolvedValue(mockEntries) };

    await useDictionaryStore.getState().loadEntries(service as any);

    const state = useDictionaryStore.getState();
    expect(state.entries).toEqual(mockEntries);
    expect(state.isLoading).toBe(false);
    expect(service.listEntries).toHaveBeenCalledOnce();
  });

  it('loads occurrences for an entry and stores them keyed by entryId', async () => {
    const mockOccurrences = [
      {
        id: 'occ-1',
        entryId: 'entry-1',
        bookHash: 'hash-1',
        bookTitle: 'Test Book',
        cfi: '/6/2',
        selectedText: 'serendipia',
        createdAt: 1,
      },
    ];
    const service = { listOccurrences: vi.fn().mockResolvedValue(mockOccurrences) };

    await useDictionaryStore.getState().loadOccurrences('entry-1', service as any);

    const state = useDictionaryStore.getState();
    expect(state.occurrencesByEntryId['entry-1']).toEqual(mockOccurrences);
    expect(state.isLoading).toBe(false);
    expect(service.listOccurrences).toHaveBeenCalledWith('entry-1');
  });

  it('loads a single entry via loadEntry and sets it in state', async () => {
    const mockEntry = {
      id: 'entry-1',
      term: 'serendipia',
      displayTerm: 'serendipia',
      enrichmentStatus: 'none' as const,
      imagePath: 'images/serendipia.jpg',
      curiosity: 'Coined by Horace Walpole',
      createdAt: 1,
      updatedAt: 2,
    };
    const service = { getEntry: vi.fn().mockResolvedValue(mockEntry) };

    await useDictionaryStore.getState().loadEntry(mockEntry.id, service as any);

    const state = useDictionaryStore.getState();
    expect(state.entry).toEqual(mockEntry);
    expect(state.isLoading).toBe(false);
    expect(service.getEntry).toHaveBeenCalledWith(mockEntry.id);
  });

  it('calls service.updateEntry and updates the entry in state via store.updateEntry', async () => {
    const original = {
      id: 'entry-1',
      term: 'ephemeral',
      displayTerm: 'ephemeral',
      enrichmentStatus: 'none' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const updatedEntry = {
      ...original,
      definition: 'Lasting for a very short time',
      curiosity: 'From Greek ephēmeros',
      updatedAt: 3,
    };
    const service = {
      updateEntry: vi.fn().mockResolvedValue(updatedEntry),
    };

    // Set initial entry in state
    useDictionaryStore.getState().setEntry(original);

    await useDictionaryStore.getState().updateEntry(
      {
        id: 'entry-1',
        definition: 'Lasting for a very short time',
        curiosity: 'From Greek ephēmeros',
      },
      service as any,
    );

    const state = useDictionaryStore.getState();
    expect(state.entry).toEqual(updatedEntry);
    expect(service.updateEntry).toHaveBeenCalledWith({
      id: 'entry-1',
      definition: 'Lasting for a very short time',
      curiosity: 'From Greek ephēmeros',
    });
  });

  it('sets entry to null via loadEntry when service returns null', async () => {
    const service = { getEntry: vi.fn().mockResolvedValue(null) };

    await useDictionaryStore.getState().loadEntry('entry-nonexistent', service as any);

    const state = useDictionaryStore.getState();
    expect(state.entry).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(service.getEntry).toHaveBeenCalledWith('entry-nonexistent');
  });

  it('sets loading to true while loading entries', async () => {
    const service = {
      listEntries: vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10))),
    };

    const loadPromise = useDictionaryStore.getState().loadEntries(service as any);
    expect(useDictionaryStore.getState().isLoading).toBe(true);
    await loadPromise;
    expect(useDictionaryStore.getState().isLoading).toBe(false);
  });
});
