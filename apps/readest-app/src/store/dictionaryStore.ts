import { create } from 'zustand';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import type { ReplicaRow, Hlc, FieldEnvelope } from '@/types/replica';
import { createReplicaRow, timestampsFromReplicaRow } from '@/libs/replica/factory';
import { compareHLC } from '@/libs/replica/hlc';
import { useSettingsStore } from './settingsStore';
import type { SyncCategory } from '@/types/settings';
import { getDictionaryService } from '@/services/dictionary/dictionaryServiceCache';
import environmentConfig from '@/services/environment';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ENTRY_REPLICA_FIELDS = [
  'term',
  'displayTerm',
  'language',
  'definition',
  'imagePath',
  'curiosity',
  'enrichmentStatus',
] as const;

function pickReplicaFields(
  obj: Record<string, unknown>,
  fieldList: readonly string[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of fieldList) {
    fields[key] = obj[key];
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
// Fire-and-forget persistence helpers
// ---------------------------------------------------------------------------

function persistEntries(entries: DictionaryEntry[]): void {
  environmentConfig
    .getAppService()
    .then((appService) => getDictionaryService(appService))
    .then((service) => service.bulkUpsertEntries(entries))
    .catch((err) => {
      console.error('[dictionaryStore] persistEntries failed:', err);
    });
}

function persistOccurrences(occurrences: DictionaryOccurrence[]): void {
  environmentConfig
    .getAppService()
    .then((appService) => getDictionaryService(appService))
    .then((service) => service.bulkUpsertOccurrences(occurrences))
    .catch((err) => {
      console.error('[dictionaryStore] persistOccurrences failed:', err);
    });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  replicaOutbox: ReplicaRow[];
  setEntries: (entries: DictionaryEntry[]) => void;
  setEntry: (entry: DictionaryEntry) => void;
  setOccurrences: (entryId: string, occurrences: DictionaryOccurrence[]) => void;
  setCaptureError: (message: string | null) => void;
  enterSelectMode: () => void;
  cancelSelectMode: () => void;
  toggleSelectedEntry: (id: string) => void;
  loadEntries: (service: DictionaryService) => Promise<void>;
  searchEntries: (query: string, service: DictionaryService) => Promise<void>;
  loadEntry: (id: string, service: DictionaryService) => Promise<void>;
  loadOccurrences: (entryId: string, service: DictionaryService) => Promise<void>;
  addEntry: (input: ManualDictionaryEntryInput, service: DictionaryService) => Promise<void>;
  deleteSelectedEntries: (service: DictionaryService) => Promise<void>;
  updateEntry: (input: UpdateEntryInput, service: DictionaryService) => Promise<void>;
  applyRemoteDictionaryEntry(row: ReplicaRow): void;
  applyRemoteDictionaryOccurrence(row: ReplicaRow): void;
  /**
   * Return dictionary entries that are NOT soft-deleted. Used by UI
   * display selectors to hide tombstones from visible lists.
   */
  getVisibleDictionaryEntries(): DictionaryEntry[];
  /**
   * Return occurrences for an entry that are NOT soft-deleted. Used by
   * UI display selectors to hide tombstones from visible lists.
   */
  getVisibleOccurrences(entryId: string): DictionaryOccurrence[];
  /**
   * Build ReplicaRows for ALL local dictionary entries AND occurrences
   * (not just the outbox). Used during seed sync (first sync with a
   * new peer). Deleted entries/occurrences produce tombstone rows.
   */
  getAllReplicas(deviceId: string): ReplicaRow[];
  reset: () => void;
}

export const useDictionaryStore = create<DictionaryStoreState>((set, get) => ({
  entries: [],
  entry: null,
  occurrencesByEntryId: {},
  captureError: null,
  isLoading: false,
  isSelectMode: false,
  selectedEntryIds: [],
  replicaOutbox: [],

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
    } catch (err) {
      console.error('[dictionaryStore] loadEntries failed:', err);
      set({ isLoading: false });
    }
  },

  async searchEntries(query, service) {
    set({ isLoading: true });
    try {
      const entries = query.trim()
        ? await service.searchEntries(query)
        : await service.listEntries();
      set({ entries, isLoading: false });
    } catch (err) {
      console.error('[dictionaryStore] searchEntries failed:', err);
      set({ isLoading: false });
    }
  },

  async loadEntry(id, service) {
    set({ isLoading: true });
    try {
      const entry = await service.getEntry(id);
      set({ entry, isLoading: false });
    } catch (err) {
      console.error('[dictionaryStore] loadEntry failed:', err);
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
    } catch (err) {
      console.error('[dictionaryStore] loadOccurrences failed:', err);
      set({ isLoading: false });
    }
  },

  async updateEntry(input, service) {
    set({ isLoading: true });
    try {
      const updated = await service.updateEntry(input);
      set((state) => {
        const deviceId = replicaDeviceId();
        const lastHLC = lastOutboxHLC(state.replicaOutbox);
        const row = createReplicaRow({
          kind: 'dictionary-entry' as SyncCategory,
          item: {
            id: updated.id,
            fields: pickReplicaFields(
              updated as unknown as Record<string, unknown>,
              ENTRY_REPLICA_FIELDS,
            ),
          },
          deviceId,
          lastHLC,
        });
        const updatedWithTimestamps = {
          ...updated,
          _replicaTimestamps: timestampsFromReplicaRow(row),
        };
        return {
          entry: updatedWithTimestamps,
          isLoading: false,
          replicaOutbox: [...state.replicaOutbox, row],
        };
      });
    } catch (err) {
      console.error('[dictionaryStore] updateEntry failed:', err);
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

      set((state) => {
        const deviceId = replicaDeviceId();
        const lastHLC = lastOutboxHLC(state.replicaOutbox);
        const row = createReplicaRow({
          kind: 'dictionary-entry' as SyncCategory,
          item: {
            id: savedEntry.id,
            fields: pickReplicaFields(
              savedEntry as unknown as Record<string, unknown>,
              ENTRY_REPLICA_FIELDS,
            ),
          },
          deviceId,
          lastHLC,
        });
        const savedEntryWithTimestamps = {
          ...savedEntry,
          _replicaTimestamps: timestampsFromReplicaRow(row),
        };
        return {
          entries: upsertEntryInList(state.entries, savedEntryWithTimestamps),
          entry: savedEntryWithTimestamps,
          isLoading: false,
          replicaOutbox: [...state.replicaOutbox, row],
        };
      });
    } catch (err) {
      console.error('[dictionaryStore] addEntry failed:', err);
      set({ isLoading: false });
    }
  },

  async deleteSelectedEntries(service) {
    const ids = useDictionaryStore.getState().selectedEntryIds;
    if (ids.length === 0) return;

    set({ isLoading: true });
    try {
      await service.deleteEntries(ids);

      const deviceId = replicaDeviceId();
      const storeState = get();
      let nextHLC: Hlc | undefined = lastOutboxHLC(storeState.replicaOutbox);
      const tombstoneRows: ReplicaRow[] = [];
      for (const delId of ids) {
        const row = createReplicaRow({
          kind: 'dictionary-entry' as SyncCategory,
          item: { id: delId, fields: {}, deletedAt: new Date() },
          deviceId,
          lastHLC: nextHLC,
        });
        tombstoneRows.push(row);
        nextHLC = row.updated_at_ts;
      }

      const deletedIds = new Set(ids);
      set((state) => ({
        entries: state.entries.filter((entry) => !deletedIds.has(entry.id)),
        entry: state.entry && deletedIds.has(state.entry.id) ? null : state.entry,
        occurrencesByEntryId: pruneOccurrencesByEntryId(state.occurrencesByEntryId, deletedIds),
        selectedEntryIds: [],
        isSelectMode: false,
        isLoading: false,
        replicaOutbox: [...state.replicaOutbox, ...tombstoneRows],
      }));
    } catch (err) {
      console.error('[dictionaryStore] deleteSelectedEntries failed:', err);
      set({ isLoading: false });
    }
  },

  applyRemoteDictionaryEntry(row: ReplicaRow) {
    const itemId = parseReplicaItemId(row);
    if (!itemId) return;

    if (row.deleted_at_ts) {
      let deletedEntry: DictionaryEntry | undefined;
      set((state) => {
        const existing = state.entries.find((e) => e.id === itemId);
        if (!existing) return state;
        deletedEntry = { ...existing, deletedAt: Date.now() };
        return {
          entries: state.entries.map((e) => (e.id === itemId ? deletedEntry! : e)),
        };
      });
      if (deletedEntry) persistEntries([deletedEntry]);
      return;
    }

    const remoteTimestamps: Record<string, string> = {};
    for (const [key, env] of Object.entries(row.fields_jsonb)) {
      remoteTimestamps[key] = (env as FieldEnvelope).t as string;
    }

    let mergedEntry: DictionaryEntry | undefined;
    set((state) => {
      const existingIdx = state.entries.findIndex((e) => e.id === itemId);

      if (existingIdx < 0) {
        const remoteVals: Record<string, unknown> = {};
        for (const [key, env] of Object.entries(row.fields_jsonb)) {
          remoteVals[key] = (env as FieldEnvelope).v;
        }
        // Guard: rows without a 'term' are occurrence rows — no-op
        if (!('term' in remoteVals)) return state;
        const newEntry: DictionaryEntry = {
          id: itemId,
          term: (remoteVals['term'] as string) || '',
          displayTerm:
            (remoteVals['displayTerm'] as string) || (remoteVals['term'] as string) || '',
          language: remoteVals['language'] as string | undefined,
          definition: remoteVals['definition'] as string | undefined,
          imagePath: remoteVals['imagePath'] as string | undefined,
          curiosity: remoteVals['curiosity'] as string | undefined,
          enrichmentStatus:
            (remoteVals['enrichmentStatus'] as DictionaryEntry['enrichmentStatus']) || 'none',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          _replicaTimestamps: remoteTimestamps,
        };
        mergedEntry = newEntry;
        return { entries: [...state.entries, newEntry] };
      }

      const local = state.entries[existingIdx]!;
      const merged = { ...local } as Record<string, unknown>;
      const mergedTimestamps = { ...local._replicaTimestamps };
      let changed = false;

      for (const [key, env] of Object.entries(row.fields_jsonb)) {
        const fe = env as FieldEnvelope;
        const remoteHlc = fe.t as string;
        const localHlc = mergedTimestamps[key];

        if (!localHlc || compareHLC(remoteHlc as Hlc, localHlc as Hlc) > 0) {
          merged[key] = fe.v;
          mergedTimestamps[key] = remoteHlc;
          changed = true;
        }
      }

      if (!changed) return state;

      merged['_replicaTimestamps'] = mergedTimestamps;
      merged['updatedAt'] = Date.now();
      mergedEntry = merged as unknown as DictionaryEntry;

      return {
        entries: state.entries.map((e, i) =>
          i === existingIdx ? (merged as unknown as DictionaryEntry) : e,
        ),
      };
    });

    if (mergedEntry) persistEntries([mergedEntry]);
  },

  applyRemoteDictionaryOccurrence(row: ReplicaRow) {
    const itemId = parseReplicaItemId(row);
    if (!itemId) return;

    // Extract entryId from fields for grouping
    const entryIdEnv = row.fields_jsonb['entryId'] as FieldEnvelope | undefined;
    const entryId = entryIdEnv ? (entryIdEnv.v as string) : undefined;
    if (!entryId) return;

    if (row.deleted_at_ts) {
      let deletedOcc: DictionaryOccurrence | undefined;
      // Soft-delete: set deletedAt instead of removing from array
      set((state) => {
        const current = state.occurrencesByEntryId[entryId] ?? [];
        const existingIdx = current.findIndex((o) => o.id === itemId);
        if (existingIdx < 0) return state;
        deletedOcc = { ...current[existingIdx]!, deletedAt: Date.now() };
        return {
          occurrencesByEntryId: {
            ...state.occurrencesByEntryId,
            [entryId]: current.map((o, i) => (i === existingIdx ? deletedOcc! : o)),
          },
        };
      });
      if (deletedOcc) persistOccurrences([deletedOcc]);
      return;
    }

    const remoteTimestamps: Record<string, string> = {};
    for (const [key, env] of Object.entries(row.fields_jsonb)) {
      remoteTimestamps[key] = (env as FieldEnvelope).t as string;
    }

    let mergedOcc: DictionaryOccurrence | undefined;
    set((state) => {
      const current = state.occurrencesByEntryId[entryId] ?? [];
      const existingIdx = current.findIndex((o) => o.id === itemId);

      if (existingIdx < 0) {
        const remoteVals: Record<string, unknown> = {};
        for (const [key, env] of Object.entries(row.fields_jsonb)) {
          remoteVals[key] = (env as FieldEnvelope).v;
        }
        const newOcc: DictionaryOccurrence = {
          id: itemId,
          entryId,
          bookHash: (remoteVals['bookHash'] as string) || '',
          bookTitle: remoteVals['bookTitle'] as string | undefined,
          bookAuthor: remoteVals['bookAuthor'] as string | undefined,
          cfi: (remoteVals['cfi'] as string) || '',
          sectionHref: remoteVals['sectionHref'] as string | undefined,
          page: remoteVals['page'] as number | undefined,
          selectedText: (remoteVals['selectedText'] as string) || '',
          contextBefore: remoteVals['contextBefore'] as string | undefined,
          contextAfter: remoteVals['contextAfter'] as string | undefined,
          highlightNoteId: (remoteVals['highlightNoteId'] as string) || undefined,
          createdAt: Date.now(),
          _replicaTimestamps: remoteTimestamps,
        };
        mergedOcc = newOcc;
        return {
          occurrencesByEntryId: {
            ...state.occurrencesByEntryId,
            [entryId]: [...current, newOcc],
          },
        };
      }

      const local = current[existingIdx]!;
      const merged = { ...local } as Record<string, unknown>;
      const mergedTimestamps = { ...local._replicaTimestamps };
      let changed = false;

      for (const [key, env] of Object.entries(row.fields_jsonb)) {
        const fe = env as FieldEnvelope;
        const remoteHlc = fe.t as string;
        const localHlc = mergedTimestamps[key];

        if (!localHlc || compareHLC(remoteHlc as Hlc, localHlc as Hlc) > 0) {
          merged[key] = fe.v;
          mergedTimestamps[key] = remoteHlc;
          changed = true;
        }
      }

      if (!changed) return state;

      merged['_replicaTimestamps'] = mergedTimestamps;
      mergedOcc = merged as unknown as DictionaryOccurrence;

      return {
        occurrencesByEntryId: {
          ...state.occurrencesByEntryId,
          [entryId]: current.map((o, i) =>
            i === existingIdx ? (merged as unknown as DictionaryOccurrence) : o,
          ),
        },
      };
    });

    if (mergedOcc) persistOccurrences([mergedOcc]);
  },

  getVisibleDictionaryEntries() {
    return get().entries.filter((e) => !e.deletedAt);
  },

  getVisibleOccurrences(entryId: string) {
    const occs = get().occurrencesByEntryId[entryId] ?? [];
    return occs.filter((o) => !o.deletedAt);
  },

  getAllReplicas(deviceId: string): ReplicaRow[] {
    const state = get();
    const rows: ReplicaRow[] = [];
    let lastHLC: Hlc | undefined;

    // Entries
    for (const entry of state.entries) {
      const row = createReplicaRow({
        kind: 'dictionary-entry',
        item: {
          id: entry.id,
          fields: pickReplicaFields(
            entry as unknown as Record<string, unknown>,
            ENTRY_REPLICA_FIELDS,
          ),
          deletedAt: entry.deletedAt ? new Date(entry.deletedAt) : undefined,
        },
        deviceId,
        lastHLC,
      });
      lastHLC = row.updated_at_ts;
      rows.push(row);
    }

    // Occurrences
    for (const [, occurrences] of Object.entries(state.occurrencesByEntryId)) {
      for (const occ of occurrences) {
        const row = createReplicaRow({
          kind: 'dictionary-occurrence',
          item: {
            id: occ.id,
            fields: pickReplicaFields(occ as unknown as Record<string, unknown>, [
              'entryId',
              'bookHash',
              'bookTitle',
              'bookAuthor',
              'cfi',
              'sectionHref',
              'page',
              'selectedText',
              'contextBefore',
              'contextAfter',
              'highlightNoteId',
            ]),
            deletedAt: occ.deletedAt ? new Date(occ.deletedAt) : undefined,
          },
          deviceId,
          lastHLC,
        });
        lastHLC = row.updated_at_ts;
        rows.push(row);
      }
    }

    return rows;
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
      replicaOutbox: [],
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
