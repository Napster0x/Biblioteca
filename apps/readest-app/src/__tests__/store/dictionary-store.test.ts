import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDictionaryStore } from '@/store/dictionaryStore';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';

const entryOne: DictionaryEntry = {
  id: 'entry-1',
  term: 'serendipia',
  displayTerm: 'serendipia',
  enrichmentStatus: 'none',
  createdAt: 1,
  updatedAt: 2,
};

const entryTwo: DictionaryEntry = {
  id: 'entry-2',
  term: 'ephemeral',
  displayTerm: 'ephemeral',
  enrichmentStatus: 'ready',
  definition: 'fleeting',
  createdAt: 1,
  updatedAt: 2,
};

function asDictionaryService(service: Partial<DictionaryService>): DictionaryService {
  return service as DictionaryService;
}

describe('dictionaryStore', () => {
  afterEach(() => {
    useDictionaryStore.getState().reset();
  });

  it('loads entries from service and sets them in state', async () => {
    const mockEntries = [{ ...entryOne, enrichmentStatus: 'pending' as const }, entryTwo];
    const service = { listEntries: vi.fn().mockResolvedValue(mockEntries) };

    await useDictionaryStore.getState().loadEntries(asDictionaryService(service));

    const state = useDictionaryStore.getState();
    expect(state.entries).toEqual(mockEntries);
    expect(state.isLoading).toBe(false);
    expect(service.listEntries).toHaveBeenCalledOnce();
  });

  it('loads occurrences for an entry and stores them keyed by entryId', async () => {
    const mockOccurrences: DictionaryOccurrence[] = [
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

    await useDictionaryStore.getState().loadOccurrences('entry-1', asDictionaryService(service));

    const state = useDictionaryStore.getState();
    expect(state.occurrencesByEntryId['entry-1']).toEqual(mockOccurrences);
    expect(state.isLoading).toBe(false);
    expect(service.listOccurrences).toHaveBeenCalledWith('entry-1');
  });

  it('loads a single entry via loadEntry and sets it in state', async () => {
    const mockEntry: DictionaryEntry = {
      ...entryOne,
      imagePath: 'images/serendipia.jpg',
      curiosity: 'Coined by Horace Walpole',
    };
    const service = { getEntry: vi.fn().mockResolvedValue(mockEntry) };

    await useDictionaryStore.getState().loadEntry(mockEntry.id, asDictionaryService(service));

    const state = useDictionaryStore.getState();
    expect(state.entry).toEqual(mockEntry);
    expect(state.isLoading).toBe(false);
    expect(service.getEntry).toHaveBeenCalledWith(mockEntry.id);
  });

  it('calls service.updateEntry and updates the entry in state via store.updateEntry', async () => {
    const original = { ...entryOne, term: 'ephemeral', displayTerm: 'ephemeral' };
    const updatedEntry: DictionaryEntry = {
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
      asDictionaryService(service),
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

    await useDictionaryStore
      .getState()
      .loadEntry('entry-nonexistent', asDictionaryService(service));

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

    const loadPromise = useDictionaryStore.getState().loadEntries(asDictionaryService(service));
    expect(useDictionaryStore.getState().isLoading).toBe(true);
    await loadPromise;
    expect(useDictionaryStore.getState().isLoading).toBe(false);
  });

  it('enters select mode, toggles ids, and clears selection on cancel', () => {
    const store = useDictionaryStore.getState();

    store.enterSelectMode();
    store.toggleSelectedEntry('entry-1');
    store.toggleSelectedEntry('entry-2');
    store.toggleSelectedEntry('entry-1');

    expect(useDictionaryStore.getState().isSelectMode).toBe(true);
    expect(useDictionaryStore.getState().selectedEntryIds).toEqual(['entry-2']);

    useDictionaryStore.getState().cancelSelectMode();

    expect(useDictionaryStore.getState().isSelectMode).toBe(false);
    expect(useDictionaryStore.getState().selectedEntryIds).toEqual([]);
  });

  it('clears selection state during reset', () => {
    useDictionaryStore.getState().enterSelectMode();
    useDictionaryStore.getState().toggleSelectedEntry('entry-1');

    useDictionaryStore.getState().reset();

    expect(useDictionaryStore.getState().isSelectMode).toBe(false);
    expect(useDictionaryStore.getState().selectedEntryIds).toEqual([]);
  });

  it('adds a manual entry and updates existing metadata without creating occurrences', async () => {
    const updatedEntry: DictionaryEntry = {
      ...entryOne,
      definition: 'A fortunate discovery.',
      updatedAt: 3,
    };
    const service = {
      upsertEntry: vi.fn().mockResolvedValue(entryOne),
      updateEntry: vi.fn().mockResolvedValue(updatedEntry),
    };

    await useDictionaryStore
      .getState()
      .addEntry(
        { term: 'serendipia', definition: 'A fortunate discovery.' },
        asDictionaryService(service),
      );

    const state = useDictionaryStore.getState();
    expect(service.upsertEntry).toHaveBeenCalledWith({
      term: 'serendipia',
      displayTerm: 'serendipia',
      definition: 'A fortunate discovery.',
      language: undefined,
      enrichmentStatus: 'none',
    });
    expect(service.updateEntry).toHaveBeenCalledWith({
      id: 'entry-1',
      definition: 'A fortunate discovery.',
    });
    expect(state.entries).toEqual([updatedEntry]);
    expect(state.entry).toEqual(updatedEntry);
    expect(state.occurrencesByEntryId).toEqual({});
  });

  it('bulk deletes selected entries, prunes cached state, and exits select mode', async () => {
    const keepOccurrence: DictionaryOccurrence = {
      id: 'occ-1',
      entryId: 'entry-1',
      bookHash: 'book-1',
      cfi: '/6/2',
      selectedText: 'serendipia',
      createdAt: 1,
    };
    const removeOccurrence: DictionaryOccurrence = {
      id: 'occ-2',
      entryId: 'entry-2',
      bookHash: 'book-2',
      cfi: '/6/4',
      selectedText: 'ephemeral',
      createdAt: 1,
    };
    const service = { deleteEntries: vi.fn().mockResolvedValue(undefined) };

    useDictionaryStore.getState().setEntries([entryOne, entryTwo]);
    useDictionaryStore.getState().setEntry(entryTwo);
    useDictionaryStore.getState().setOccurrences(entryOne.id, [keepOccurrence]);
    useDictionaryStore.getState().setOccurrences(entryTwo.id, [removeOccurrence]);
    useDictionaryStore.getState().enterSelectMode();
    useDictionaryStore.getState().toggleSelectedEntry(entryTwo.id);

    await useDictionaryStore.getState().deleteSelectedEntries(asDictionaryService(service));

    const state = useDictionaryStore.getState();
    expect(service.deleteEntries).toHaveBeenCalledWith([entryTwo.id]);
    expect(state.entries).toEqual([entryOne]);
    expect(state.entry).toBeNull();
    expect(state.occurrencesByEntryId).toEqual({ [entryOne.id]: [keepOccurrence] });
    expect(state.selectedEntryIds).toEqual([]);
    expect(state.isSelectMode).toBe(false);
  });

  it('does not call delete service when no entries are selected', async () => {
    const service = { deleteEntries: vi.fn().mockResolvedValue(undefined) };

    await useDictionaryStore.getState().deleteSelectedEntries(asDictionaryService(service));

    expect(service.deleteEntries).not.toHaveBeenCalled();
    expect(useDictionaryStore.getState().isLoading).toBe(false);
  });
});
