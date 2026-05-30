import { create } from 'zustand';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';

export interface UpdateEntryInput {
  id: string;
  definition?: string;
  curiosity?: string;
  imagePath?: string;
}

export interface DictionaryStoreState {
  entries: DictionaryEntry[];
  entry: DictionaryEntry | null;
  occurrencesByEntryId: Record<string, DictionaryOccurrence[]>;
  captureError: string | null;
  isLoading: boolean;
  setEntries: (entries: DictionaryEntry[]) => void;
  setEntry: (entry: DictionaryEntry) => void;
  setOccurrences: (entryId: string, occurrences: DictionaryOccurrence[]) => void;
  setCaptureError: (message: string | null) => void;
  loadEntries: (service: DictionaryService) => Promise<void>;
  loadEntry: (id: string, service: DictionaryService) => Promise<void>;
  loadOccurrences: (entryId: string, service: DictionaryService) => Promise<void>;
  updateEntry: (input: UpdateEntryInput, service: DictionaryService) => Promise<void>;
  reset: () => void;
}

export const useDictionaryStore = create<DictionaryStoreState>((set) => ({
  entries: [],
  entry: null,
  occurrencesByEntryId: {},
  captureError: null,
  isLoading: false,

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

  reset() {
    set({
      entries: [],
      entry: null,
      occurrencesByEntryId: {},
      captureError: null,
      isLoading: false,
    });
  },
}));
