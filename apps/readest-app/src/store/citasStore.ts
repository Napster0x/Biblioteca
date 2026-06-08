import { create } from 'zustand';
import type { CitasService } from '@/services/citas/CitasService';
import type { Cite, CiteInput, CiteUpdate } from '@/types/citas';
import type { ReplicaRow, Hlc, FieldEnvelope } from '@/types/replica';
import { createReplicaRow } from '@/libs/replica/factory';
import { useSettingsStore } from './settingsStore';
import type { SyncCategory } from '@/types/settings';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const QUOTE_REPLICA_FIELDS = [
  'bookHash',
  'bookTitle',
  'bookAuthor',
  'cfi',
  'sectionHref',
  'page',
  'text',
  'contextBefore',
  'contextAfter',
  'contentHash',
] as const;

function pickReplicaFields(quote: Cite): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of QUOTE_REPLICA_FIELDS) {
    fields[key] = (quote as unknown as Record<string, unknown>)[key];
  }
  return fields;
}

function replicaDeviceId(): string {
  return useSettingsStore.getState().settings?.replicaDeviceId ?? 'unknown-device';
}

function lastOutboxHLC(outbox: ReplicaRow[]): Hlc | undefined {
  if (outbox.length === 0) return undefined;
  return outbox[outbox.length - 1]!.updated_at_ts;
}

function parseReplicaItemId(row: ReplicaRow): string | null {
  const parts = row.replica_id.split(':');
  if (parts.length < 2) return null;
  return parts.slice(1).join(':');
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface CitasState {
  quotes: Cite[];
  quote: Cite | null;
  isLoading: boolean;
  isSelectMode: boolean;
  selectedQuoteIds: string[];
  searchQuery: string;
  captureError: string | null;
  replicaOutbox: ReplicaRow[];
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
  deleteQuotes(ids: readonly string[], service: CitasService): Promise<void>;
  deleteSelectedQuotes(service: CitasService): Promise<void>;
  removeQuotesFromState(ids: readonly string[]): void;
  applyRemoteQuote(row: ReplicaRow): void;
  reset(): void;
}

export type CitasStore = CitasState & CitasActions;

export const useCitasStore = create<CitasStore>((set, get) => ({
  quotes: [],
  quote: null,
  isLoading: false,
  isSelectMode: false,
  selectedQuoteIds: [],
  searchQuery: '',
  captureError: null,
  replicaOutbox: [],

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
      set((state) => {
        const deviceId = replicaDeviceId();
        const lastHLC = lastOutboxHLC(state.replicaOutbox);
        const row = createReplicaRow({
          kind: 'quote' as SyncCategory,
          item: { id: quote.id, fields: pickReplicaFields(quote) },
          deviceId,
          lastHLC,
        });
        return {
          quotes: [quote, ...state.quotes],
          quote,
          isLoading: false,
          replicaOutbox: [...state.replicaOutbox, row],
        };
      });
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
      set((state) => {
        const deviceId = replicaDeviceId();
        const lastHLC = lastOutboxHLC(state.replicaOutbox);
        const row = createReplicaRow({
          kind: 'quote' as SyncCategory,
          item: { id: quote.id, fields: pickReplicaFields(quote) },
          deviceId,
          lastHLC,
        });
        return {
          quotes: state.quotes.map((candidate) => (candidate.id === quote.id ? quote : candidate)),
          quote: state.quote && state.quote.id === quote.id ? quote : state.quote,
          isLoading: false,
          replicaOutbox: [...state.replicaOutbox, row],
        };
      });
      return quote;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  async deleteQuotes(ids, service) {
    if (ids.length === 0) return;

    set({ isLoading: true });
    try {
      await service.deleteQuotes(ids);

      const deviceId = replicaDeviceId();
      const storeState = get();
      let nextHLC: Hlc | undefined = lastOutboxHLC(storeState.replicaOutbox);
      const tombstoneRows: ReplicaRow[] = [];
      for (const delId of ids) {
        const row = createReplicaRow({
          kind: 'quote' as SyncCategory,
          item: { id: delId, fields: {}, deletedAt: new Date() },
          deviceId,
          lastHLC: nextHLC,
        });
        tombstoneRows.push(row);
        nextHLC = row.updated_at_ts;
      }

      useCitasStore.getState().removeQuotesFromState(ids);
      set((state) => ({
        isLoading: false,
        replicaOutbox: [...state.replicaOutbox, ...tombstoneRows],
      }));
    } catch {
      set({ isLoading: false });
    }
  },

  async deleteSelectedQuotes(service) {
    const ids = useCitasStore.getState().selectedQuoteIds;
    try {
      await useCitasStore.getState().deleteQuotes(ids, service);
      if (ids.length > 0) {
        set({ selectedQuoteIds: [], isSelectMode: false });
      }
    } catch {
      // Preserve the historical selected-delete contract: failures only clear loading.
    }
  },

  removeQuotesFromState(ids) {
    if (ids.length === 0) return;
    const deletedIds = new Set(ids);
    set((state) => ({
      quotes: state.quotes.filter((quote) => !deletedIds.has(quote.id)),
      quote: state.quote && deletedIds.has(state.quote.id) ? null : state.quote,
      selectedQuoteIds: state.selectedQuoteIds.filter((id) => !deletedIds.has(id)),
    }));
  },

  applyRemoteQuote(row: ReplicaRow) {
    const itemId = parseReplicaItemId(row);
    if (!itemId) return;

    if (row.deleted_at_ts) {
      set((state) => {
        const existing = state.quotes.find((q) => q.id === itemId);
        if (!existing) return state;
        return {
          quotes: state.quotes.map((q) => (q.id === itemId ? { ...q, deletedAt: Date.now() } : q)),
        };
      });
      return;
    }

    const remoteTimestamps: Record<string, string> = {};
    for (const [key, env] of Object.entries(row.fields_jsonb)) {
      remoteTimestamps[key] = (env as FieldEnvelope).t as string;
    }

    set((state) => {
      const existingIdx = state.quotes.findIndex((q) => q.id === itemId);

      if (existingIdx < 0) {
        const remoteVals: Record<string, unknown> = {};
        for (const [key, env] of Object.entries(row.fields_jsonb)) {
          remoteVals[key] = (env as FieldEnvelope).v;
        }
        const newQuote: Cite = {
          id: itemId,
          bookHash: (remoteVals['bookHash'] as string) || '',
          bookTitle: (remoteVals['bookTitle'] as string) || null,
          bookAuthor: (remoteVals['bookAuthor'] as string) || null,
          cfi: (remoteVals['cfi'] as string) || null,
          sectionHref: (remoteVals['sectionHref'] as string) || null,
          page: (remoteVals['page'] as number) ?? null,
          text: (remoteVals['text'] as string) || '',
          contextBefore: (remoteVals['contextBefore'] as string) || null,
          contextAfter: (remoteVals['contextAfter'] as string) || null,
          contentHash: (remoteVals['contentHash'] as string) || '',
          createdAt: Date.now(),
          updatedAt: null,
          _replicaTimestamps: remoteTimestamps,
        };
        return { quotes: [...state.quotes, newQuote] };
      }

      const local = state.quotes[existingIdx]!;
      const merged = { ...local } as Record<string, unknown>;
      const mergedTimestamps = { ...local._replicaTimestamps };
      let changed = false;

      for (const [key, env] of Object.entries(row.fields_jsonb)) {
        const fe = env as FieldEnvelope;
        const remoteHlc = fe.t as string;
        const localHlc = mergedTimestamps[key];

        if (!localHlc || remoteHlc > localHlc) {
          merged[key] = fe.v;
          mergedTimestamps[key] = remoteHlc;
          changed = true;
        }
      }

      if (!changed) return state;

      merged['_replicaTimestamps'] = mergedTimestamps;
      merged['updatedAt'] = Date.now();

      return {
        quotes: state.quotes.map((q, i) => (i === existingIdx ? (merged as unknown as Cite) : q)),
      };
    });
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
      replicaOutbox: [],
    });
  },
}));
