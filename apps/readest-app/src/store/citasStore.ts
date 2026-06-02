import { create } from 'zustand';
import type { CitasService } from '@/services/citas/CitasService';
import type { Cite, CiteInput, CiteUpdate } from '@/types/citas';

export interface CitasState {
  quotes: Cite[];
  quote: Cite | null;
  isLoading: boolean;
  isSelectMode: boolean;
  selectedQuoteIds: string[];
  searchQuery: string;
  captureError: string | null;
}

export interface CitasActions {
  setQuotes(quotes: Cite[]): void;
  setQuote(quote: Cite | null): void;
  setSearchQuery(query: string): void;
  setCaptureError(message: string | null): void;
  enterSelectMode(): void;
  cancelSelectMode(): void;
  toggleSelectedQuote(id: string): void;
  loadQuotes(service: CitasService): Promise<void>;
  searchQuotes(query: string, service: CitasService): Promise<void>;
  createQuote(input: CiteInput, service: CitasService): Promise<Cite>;
  updateQuote(input: CiteUpdate, service: CitasService): Promise<Cite>;
  deleteSelectedQuotes(service: CitasService): Promise<void>;
  reset(): void;
}

export type CitasStore = CitasState & CitasActions;

export const useCitasStore = create<CitasStore>((set) => ({
  quotes: [],
  quote: null,
  isLoading: false,
  isSelectMode: false,
  selectedQuoteIds: [],
  searchQuery: '',
  captureError: null,

  setQuotes(quotes) {
    set({ quotes });
  },

  setQuote(quote) {
    set({ quote });
  },

  setSearchQuery(query) {
    set({ searchQuery: query });
  },

  setCaptureError(message) {
    set({ captureError: message });
  },

  enterSelectMode() {
    set({ isSelectMode: true });
  },

  cancelSelectMode() {
    set({ isSelectMode: false, selectedQuoteIds: [] });
  },

  toggleSelectedQuote(id) {
    set((state) => ({
      selectedQuoteIds: state.selectedQuoteIds.includes(id)
        ? state.selectedQuoteIds.filter((selectedId) => selectedId !== id)
        : [...state.selectedQuoteIds, id],
    }));
  },

  async loadQuotes(service) {
    set({ isLoading: true });
    try {
      const quotes = await service.listQuotes();
      set({ quotes, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  async searchQuotes(query, service) {
    set({ isLoading: true });
    try {
      const quotes = await service.searchQuotes(query);
      set({ quotes, searchQuery: query, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  async createQuote(input, service) {
    set({ isLoading: true });
    try {
      const quote = await service.createQuote(input);
      set((state) => ({
        quotes: [quote, ...state.quotes],
        quote,
        isLoading: false,
      }));
      return quote;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  async updateQuote(input, service) {
    set({ isLoading: true });
    try {
      const quote = await service.updateQuote(input);
      set((state) => ({
        quotes: state.quotes.map((candidate) => (candidate.id === quote.id ? quote : candidate)),
        quote: state.quote && state.quote.id === quote.id ? quote : state.quote,
        isLoading: false,
      }));
      return quote;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  async deleteSelectedQuotes(service) {
    const ids = useCitasStore.getState().selectedQuoteIds;
    if (ids.length === 0) return;

    set({ isLoading: true });
    try {
      await service.deleteQuotes(ids);
      const deletedIds = new Set(ids);
      set((state) => ({
        quotes: state.quotes.filter((quote) => !deletedIds.has(quote.id)),
        quote: state.quote && deletedIds.has(state.quote.id) ? null : state.quote,
        selectedQuoteIds: [],
        isSelectMode: false,
        isLoading: false,
      }));
    } catch {
      set({ isLoading: false });
    }
  },

  reset() {
    set({
      quotes: [],
      quote: null,
      isLoading: false,
      isSelectMode: false,
      selectedQuoteIds: [],
      searchQuery: '',
      captureError: null,
    });
  },
}));
