import { create } from 'zustand';
import type { CitasService } from '@/services/citas/CitasService';
import type { Cite, CiteInput, CiteUpdate } from '@/types/citas';
import type { ReplicaRow, Hlc, FieldEnvelope } from '@/types/replica';
import { createReplicaRow, timestampsFromReplicaRow } from '@/libs/replica/factory';
import { compareHLC } from '@/libs/replica/hlc';
import { useSettingsStore } from './settingsStore';
import type { SyncCategory } from '@/types/settings';
import { getCitasService } from '@/services/citas/citasServiceCache';
import environmentConfig from '@/services/environment';

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

function maxFieldHlc(timestamps: Record<string, string | undefined>): Hlc | undefined {
  let max: Hlc | undefined;
  for (const [key, value] of Object.entries(timestamps)) {
    if (key === '__deleted' || !value) continue;
    if (!max || compareHLC(value as Hlc, max) > 0) max = value as Hlc;
  }
  return max;
}

function shouldApplyDelete(
  timestamps: Record<string, string | undefined>,
  deleteHlc: Hlc,
): boolean {
  const liveHlc = maxFieldHlc(timestamps);
  return !liveHlc || compareHLC(deleteHlc, liveHlc) >= 0;
}

function makeDeletedQuote(id: string, deleteHlc: Hlc): Cite {
  return {
    id,
    bookHash: '',
    bookTitle: null,
    bookAuthor: null,
    cfi: null,
    sectionHref: null,
    page: null,
    text: '',
    contextBefore: null,
    contextAfter: null,
    contentHash: '',
    createdAt: Date.now(),
    updatedAt: null,
    deletedAt: Date.now(),
    _replicaTimestamps: { __deleted: deleteHlc },
  };
}

// ---------------------------------------------------------------------------
// Fire-and-forget persistence helper
// ---------------------------------------------------------------------------

function persistQuotes(quotes: Cite[]): void {
  environmentConfig
    .getAppService()
    .then((appService) => getCitasService(appService))
    .then((service) => service.bulkUpsertQuotes(quotes))
    .catch((err) => {
      console.error('[citasStore] persistQuotes failed:', err);
    });
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
  /**
   * Return quotes that are NOT soft-deleted. Used by UI display
   * selectors to hide tombstones from visible lists.
   */
  getVisibleQuotes(): Cite[];
  applyRemoteQuote(row: ReplicaRow): void;
  /**
   * Build ReplicaRows for ALL local quotes (not just the outbox).
   * Used during seed sync (first sync with a new peer).
   * Deleted quotes produce tombstone rows.
   */
  getAllReplicas(deviceId: string): ReplicaRow[];
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
    } catch (err) {
      console.error('[citasStore] loadQuotes failed:', err);
      set({ isLoading: false });
    }
  },

  async searchQuotes(query, service) {
    set({ isLoading: true });
    try {
      const quotes = await service.searchQuotes(query);
      set({ quotes, searchQuery: query, isLoading: false });
    } catch (err) {
      console.error('[citasStore] searchQuotes failed:', err);
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
        const quoteWithTimestamps = {
          ...quote,
          _replicaTimestamps: timestampsFromReplicaRow(row),
        };
        return {
          quotes: [quoteWithTimestamps, ...state.quotes],
          quote: quoteWithTimestamps,
          isLoading: false,
          replicaOutbox: [...state.replicaOutbox, row],
        };
      });
      return quote;
    } catch (err) {
      console.error('[citasStore] createQuote failed:', err);
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
        const quoteWithTimestamps = {
          ...quote,
          _replicaTimestamps: timestampsFromReplicaRow(row),
        };
        return {
          quotes: state.quotes.map((candidate) =>
            candidate.id === quote.id ? quoteWithTimestamps : candidate,
          ),
          quote: state.quote && state.quote.id === quote.id ? quoteWithTimestamps : state.quote,
          isLoading: false,
          replicaOutbox: [...state.replicaOutbox, row],
        };
      });
      return quote;
    } catch (err) {
      console.error('[citasStore] updateQuote failed:', err);
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

      const tombstonesById = new Map(
        tombstoneRows.map((row) => [parseReplicaItemId(row), row.deleted_at_ts]),
      );
      const deletedIds = new Set(ids);
      set((state) => ({
        quotes: state.quotes.map((quote) => {
          if (!deletedIds.has(quote.id)) return quote;
          const deletedHlc = tombstonesById.get(quote.id);
          return {
            ...quote,
            deletedAt: Date.now(),
            _replicaTimestamps: {
              ...quote._replicaTimestamps,
              ...(deletedHlc ? { __deleted: deletedHlc } : {}),
            },
          };
        }),
        quote: state.quote && deletedIds.has(state.quote.id) ? null : state.quote,
        isLoading: false,
        replicaOutbox: [...state.replicaOutbox, ...tombstoneRows],
      }));
    } catch (err) {
      console.error('[citasStore] deleteQuotes failed:', err);
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
    } catch (err) {
      console.error('[citasStore] deleteSelectedQuotes failed:', err);
      // Preserve the historical selected-delete contract: failures only clear loading.
    }
  },

  removeQuotesFromState(ids) {
    if (ids.length === 0) return;
    const deletedIds = new Set(ids);
    set((state) => ({
      quotes: state.quotes.map((quote) =>
        deletedIds.has(quote.id) ? { ...quote, deletedAt: Date.now() } : quote,
      ),
      quote: state.quote && deletedIds.has(state.quote.id) ? null : state.quote,
      selectedQuoteIds: state.selectedQuoteIds.filter((id) => !deletedIds.has(id)),
    }));
  },

  getVisibleQuotes() {
    return get().quotes.filter((q) => !q.deletedAt);
  },

  applyRemoteQuote(row: ReplicaRow) {
    const itemId = parseReplicaItemId(row);
    if (!itemId) return;

    const deleteHlc = row.deleted_at_ts;
    if (deleteHlc) {
      let deletedQuote: Cite | undefined;
      set((state) => {
        const existing = state.quotes.find((q) => q.id === itemId);
        if (!existing) {
          deletedQuote = makeDeletedQuote(itemId, deleteHlc);
          return { quotes: [...state.quotes, deletedQuote] };
        }
        if (!shouldApplyDelete(existing._replicaTimestamps ?? {}, deleteHlc)) return state;
        deletedQuote = {
          ...existing,
          deletedAt: Date.now(),
          _replicaTimestamps: {
            ...existing._replicaTimestamps,
            __deleted: deleteHlc,
          },
        };
        return {
          quotes: state.quotes.map((q) => (q.id === itemId ? deletedQuote! : q)),
        };
      });
      if (deletedQuote) persistQuotes([deletedQuote]);
      return;
    }

    const remoteTimestamps: Record<string, string> = {};
    for (const [key, env] of Object.entries(row.fields_jsonb)) {
      remoteTimestamps[key] = (env as FieldEnvelope).t as string;
    }

    let mergedQuote: Cite | undefined;
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
        mergedQuote = newQuote;
        return { quotes: [...state.quotes, newQuote] };
      }

      const local = state.quotes[existingIdx]!;
      const merged = { ...local } as Record<string, unknown>;
      const mergedTimestamps = { ...local._replicaTimestamps };
      let changed = false;
      const deleteHlc = mergedTimestamps['__deleted'] as Hlc | undefined;
      let liveWinsDelete = false;

      for (const [key, env] of Object.entries(row.fields_jsonb)) {
        const fe = env as FieldEnvelope;
        const remoteHlc = fe.t as string;
        const localHlc = mergedTimestamps[key];

        const newerThanLocal = !localHlc || compareHLC(remoteHlc as Hlc, localHlc as Hlc) > 0;
        const newerThanDelete = !deleteHlc || compareHLC(remoteHlc as Hlc, deleteHlc) > 0;

        if (newerThanLocal && newerThanDelete) {
          merged[key] = fe.v;
          mergedTimestamps[key] = remoteHlc;
          changed = true;
          if (deleteHlc) liveWinsDelete = true;
        }
      }

      if (liveWinsDelete) {
        delete merged['deletedAt'];
        delete mergedTimestamps['__deleted'];
      }

      if (!changed) return state;

      merged['_replicaTimestamps'] = mergedTimestamps;
      merged['updatedAt'] = Date.now();
      mergedQuote = merged as unknown as Cite;

      return {
        quotes: state.quotes.map((q, i) => (i === existingIdx ? (merged as unknown as Cite) : q)),
      };
    });

    if (mergedQuote) persistQuotes([mergedQuote]);
  },

  getAllReplicas(deviceId: string): ReplicaRow[] {
    const state = get();
    const rows: ReplicaRow[] = [];
    let lastHLC: Hlc | undefined;
    for (const quote of state.quotes) {
      const row = createReplicaRow({
        kind: 'quote',
        item: {
          id: quote.id,
          fields: pickReplicaFields(quote),
          deletedAt: quote.deletedAt ? new Date(quote.deletedAt) : undefined,
        },
        deviceId,
        lastHLC,
      });
      lastHLC = row.updated_at_ts;
      rows.push(row);
    }
    return rows;
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
