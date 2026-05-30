import { create } from 'zustand';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';

export interface UpdateEntryInput {
  id: string;
  definition?: string;
  curiosity?: string;
  imagePath?: string;
}

export interface ManualDictionaryEntryInput {
  term: string;
  definition?: string;
  language?: string;
}

export interface DictionaryStoreState {
  entries: DictionaryEntry[];
  entry: DictionaryEntry | null;
  occurrencesByEntryId: Record<string, DictionaryOccurrence[]>;
  captureError: string | null;
  isLoading: boolean;
  isSelectMode: boolean;
  selectedEntryIds: string[];
  setEntries: (entries: DictionaryEntry[]) => void;
  setEntry: (entry: DictionaryEntry) => void;
  setOccurrences: (entryId: string, occurrences: DictionaryOccurrence[]) => void;
  setCaptureError: (message: string | null) => void;
  enterSelectMode: () => void;
  cancelSelectMode: () => void;
  toggleSelectedEntry: (id: string) => void;
  loadEntries: (service: DictionaryService) => Promise<void>;
  loadEntry: (id: string, service: DictionaryService) => Promise<void>;
  loadOccurrences: (entryId: string, service: DictionaryService) => Promise<void>;
  addEntry: (input: ManualDictionaryEntryInput, service: DictionaryService) => Promise<void>;
  deleteSelectedEntries: (service: DictionaryService) => Promise<void>;
  updateEntry: (input: UpdateEntryInput, service: DictionaryService) => Promise<void>;
  reset: () => void;
}

export const useDictionaryStore = create<DictionaryStoreState>((set) => ({
  entries: [],
  entry: null,
  occurrencesByEntryId: {},
  captureError: null,
  isLoading: false,
  isSelectMode: false,
  selectedEntryIds: [],

  setEntries(entries) {
    set({ entries });
  },

  setEntry(entry) {
    set({ entry });
  },

  setOccurrences(entryId, occurrences) {
    set((state) => ({
      occurrencesByEntryId: {
        ...state.occurrencesByEntryId,
        [entryId]: occurrences,
      },
    }));
  },

  setCaptureError(message) {
    set({ captureError: message });
  },

  enterSelectMode() {
    set({ isSelectMode: true });
  },

  cancelSelectMode() {
    set({ isSelectMode: false, selectedEntryIds: [] });
  },

  toggleSelectedEntry(id) {
    set((state) => ({
      selectedEntryIds: state.selectedEntryIds.includes(id)
        ? state.selectedEntryIds.filter((selectedId) => selectedId !== id)
        : [...state.selectedEntryIds, id],
    }));
  },

  async loadEntries(service) {
    set({ isLoading: true });
    try {
      const entries = await service.listEntries();
      set({ entries, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  async loadEntry(id, service) {
    set({ isLoading: true });
    try {
      const entry = await service.getEntry(id);
      set({ entry, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  async loadOccurrences(entryId, service) {
    set({ isLoading: true });
    try {
      const occurrences = await service.listOccurrences(entryId);
      set((state) => ({
        occurrencesByEntryId: {
          ...state.occurrencesByEntryId,
          [entryId]: occurrences,
        },
        isLoading: false,
      }));
    } catch {
      set({ isLoading: false });
    }
  },

  async updateEntry(input, service) {
    set({ isLoading: true });
    try {
      const updated = await service.updateEntry(input);
      set({ entry: updated, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  async addEntry(input, service) {
    set({ isLoading: true });
    try {
      const entry = await service.upsertEntry({
        term: input.term,
        displayTerm: input.term,
        language: input.language,
        definition: input.definition,
        enrichmentStatus: 'none',
      });
      const savedEntry =
        input.definition !== undefined && entry.definition !== input.definition
          ? await service.updateEntry({ id: entry.id, definition: input.definition })
          : entry;

      set((state) => ({
        entries: upsertEntryInList(state.entries, savedEntry),
        entry: savedEntry,
        isLoading: false,
      }));
    } catch {
      set({ isLoading: false });
    }
  },

  async deleteSelectedEntries(service) {
    const ids = useDictionaryStore.getState().selectedEntryIds;
    if (ids.length === 0) return;

    set({ isLoading: true });
    try {
      await service.deleteEntries(ids);
      const deletedIds = new Set(ids);
      set((state) => ({
        entries: state.entries.filter((entry) => !deletedIds.has(entry.id)),
        entry: state.entry && deletedIds.has(state.entry.id) ? null : state.entry,
        occurrencesByEntryId: pruneOccurrencesByEntryId(state.occurrencesByEntryId, deletedIds),
        selectedEntryIds: [],
        isSelectMode: false,
        isLoading: false,
      }));
    } catch {
      set({ isLoading: false });
    }
  },

  reset() {
    set({
      entries: [],
      entry: null,
      occurrencesByEntryId: {},
      captureError: null,
      isLoading: false,
      isSelectMode: false,
      selectedEntryIds: [],
    });
  },
}));

function upsertEntryInList(entries: DictionaryEntry[], entry: DictionaryEntry): DictionaryEntry[] {
  const index = entries.findIndex((candidate) => candidate.id === entry.id);
  if (index === -1) return [entry, ...entries];

  return entries.map((candidate) => (candidate.id === entry.id ? entry : candidate));
}

function pruneOccurrencesByEntryId(
  occurrencesByEntryId: Record<string, DictionaryOccurrence[]>,
  deletedIds: ReadonlySet<string>,
): Record<string, DictionaryOccurrence[]> {
  return Object.entries(occurrencesByEntryId).reduce<Record<string, DictionaryOccurrence[]>>(
    (result, [entryId, occurrences]) => {
      if (!deletedIds.has(entryId)) result[entryId] = occurrences;
      return result;
    },
    {},
  );
}
