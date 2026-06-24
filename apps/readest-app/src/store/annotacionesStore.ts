import { create } from 'zustand';
import type { AnotacionesService } from '@/services/annotations/AnotacionesService';
import type { Annotacion, AnnotacionInput } from '@/types/annotaciones';
import type { ReplicaRow, Hlc, FieldEnvelope } from '@/types/replica';
import { createReplicaRow, timestampsFromReplicaRow } from '@/libs/replica/factory';
import { compareHLC } from '@/libs/replica/hlc';
import { useSettingsStore } from './settingsStore';
import type { SyncCategory } from '@/types/settings';
import { getAnotacionesService } from '@/services/annotations/annotacionesServiceCache';
import environmentConfig from '@/services/environment';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Fields to include in a ReplicaRow for an annotation. */
const ANNOTATION_REPLICA_FIELDS = [
  'bookHash',
  'bookTitle',
  'bookAuthor',
  'cfi',
  'sectionHref',
  'page',
  'text',
  'note',
  'style',
  'color',
] as const;

function pickReplicaFields(ann: Annotacion): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of ANNOTATION_REPLICA_FIELDS) {
    fields[key] = (ann as unknown as Record<string, unknown>)[key];
  }
  return fields;
}

/** Get the device ID used for HLC minting (from settings). */
function replicaDeviceId(): string {
  return useSettingsStore.getState().settings?.replicaDeviceId ?? 'unknown-device';
}

/** Grab the last HLC from the outbox. */
function lastOutboxHLC(outbox: ReplicaRow[]): Hlc | undefined {
  if (outbox.length === 0) return undefined;
  return outbox[outbox.length - 1]!.updated_at_ts;
}

/** Parse the item id from replica_id (format: "kind:itemId"). */
function parseReplicaItemId(row: ReplicaRow): string | null {
  const parts = row.replica_id.split(':');
  // Skip the kind part, join the rest in case the id itself contains colons
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

function makeDeletedAnnotation(id: string, deleteHlc: Hlc): Annotacion {
  return {
    id,
    bookHash: '',
    bookTitle: null,
    bookAuthor: null,
    cfi: null,
    sectionHref: null,
    page: null,
    text: '',
    note: '',
    style: 'highlight',
    color: 'yellow',
    createdAt: Date.now(),
    updatedAt: null,
    deletedAt: Date.now(),
    _replicaTimestamps: { __deleted: deleteHlc },
  };
}

// ---------------------------------------------------------------------------
// Fire-and-forget persistence helper
// ---------------------------------------------------------------------------

function persistAnnotations(annotations: Annotacion[]): void {
  environmentConfig
    .getAppService()
    .then((appService) => getAnotacionesService(appService))
    .then((service) => service.bulkUpsertAnnotations(annotations))
    .catch((err) => {
      console.error('[annotacionesStore] persistAnnotations failed:', err);
    });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface AnotacionesState {
  annotations: Annotacion[];
  isLoading: boolean;
  isSelectMode: boolean;
  selectedAnnotationIds: string[];
  searchQuery: string;
  error: string | null;
  replicaOutbox: ReplicaRow[];
}

export interface AnotacionesActions {
  loadAnnotations(service: AnotacionesService): Promise<void>;
  searchAnnotations(query: string, service: AnotacionesService): Promise<void>;
  createAnnotation(input: AnnotacionInput, service: AnotacionesService): Promise<Annotacion>;
  updateAnnotation(id: string, note: string, service: AnotacionesService): Promise<Annotacion>;
  deleteAnnotations(ids: readonly string[], service: AnotacionesService): Promise<void>;
  removeAnnotationsFromState(ids: readonly string[]): void;
  setSearchQuery(query: string): void;
  toggleSelect(id: string): void;
  selectAll(): void;
  enterSelectMode(): void;
  exitSelectMode(): void;
  /**
   * Return annotations that are NOT soft-deleted. Used by UI display
   * selectors to hide tombstones from visible lists.
   */
  getVisibleAnnotations(): Annotacion[];
  /**
   * Apply a remote ReplicaRow to the local annotation state. Merges fields
   * per-field by HLC comparison — newer HLC wins. Soft-deletes the local
   * annotation when `deleted_at_ts` is set on the row.
   */
  applyRemoteAnnotation(row: ReplicaRow): void;
  /**
   * Build ReplicaRows for ALL local annotations (not just the outbox).
   * Used during seed sync (first sync with a new peer) to push the
   * complete dataset. Deleted annotations produce tombstone rows.
   */
  getAllReplicas(deviceId: string): ReplicaRow[];
  reset(): void;
}

export type AnotacionesStore = AnotacionesState & AnotacionesActions;

export const useAnotacionesStore = create<AnotacionesStore>((set, get) => ({
  annotations: [],
  isLoading: false,
  isSelectMode: false,
  selectedAnnotationIds: [],
  searchQuery: '',
  error: null,
  replicaOutbox: [],

  async loadAnnotations(service) {
    set({ isLoading: true });
    try {
      const annotations = await service.listAnnotations();
      set({ annotations, isLoading: false });
    } catch (err) {
      console.error('[annotacionesStore] loadAnnotations failed:', err);
      set({ isLoading: false });
    }
  },

  async searchAnnotations(query, service) {
    set({ isLoading: true });
    try {
      const annotations = await service.searchAnnotations(query);
      set({ annotations, searchQuery: query, isLoading: false });
    } catch (err) {
      console.error('[annotacionesStore] searchAnnotations failed:', err);
      set({ isLoading: false });
    }
  },

  async createAnnotation(input, service) {
    set({ isLoading: true });
    try {
      const annotation = await service.createAnnotation(input);
      set((state) => {
        // Mint a ReplicaRow and push to outbox
        const deviceId = replicaDeviceId();
        const kind: SyncCategory = 'annotation';
        const lastHLC = lastOutboxHLC(state.replicaOutbox);
        const row = createReplicaRow({
          kind,
          item: { id: annotation.id, fields: pickReplicaFields(annotation) },
          deviceId,
          lastHLC,
        });
        const annotationWithTimestamps = {
          ...annotation,
          _replicaTimestamps: timestampsFromReplicaRow(row),
        };
        return {
          annotations: [annotationWithTimestamps, ...state.annotations],
          isLoading: false,
          replicaOutbox: [...state.replicaOutbox, row],
        };
      });
      return annotation;
    } catch (err) {
      console.error('[annotacionesStore] createAnnotation failed:', err);
      set({ isLoading: false });
      throw err;
    }
  },

  async updateAnnotation(id, note, service) {
    set({ isLoading: true });
    try {
      const annotation = await service.updateAnnotation({ id, note });
      set((state) => {
        const deviceId = replicaDeviceId();
        const kind: SyncCategory = 'annotation';
        const lastHLC = lastOutboxHLC(state.replicaOutbox);
        const row = createReplicaRow({
          kind,
          item: { id: annotation.id, fields: pickReplicaFields(annotation) },
          deviceId,
          lastHLC,
        });
        const annotationWithTimestamps = {
          ...annotation,
          _replicaTimestamps: timestampsFromReplicaRow(row),
        };
        return {
          annotations: state.annotations.map((item) =>
            item.id === id ? annotationWithTimestamps : item,
          ),
          isLoading: false,
          replicaOutbox: [...state.replicaOutbox, row],
        };
      });
      return annotation;
    } catch (err) {
      console.error('[annotacionesStore] updateAnnotation failed:', err);
      set({ isLoading: false });
      throw err;
    }
  },

  async deleteAnnotations(ids, service) {
    if (ids.length === 0) return;

    set({ isLoading: true });
    try {
      await service.deleteAnnotations(ids);
      // Push tombstone ReplicaRows for every deleted id
      const deviceId = replicaDeviceId();
      const kind: SyncCategory = 'annotation';
      const storeState = get();
      const lastHLC = lastOutboxHLC(storeState.replicaOutbox);

      // We need to build rows sequentially to keep HLCs monotonic
      let nextHLC: Hlc | undefined = lastHLC;
      const tombstoneRows: ReplicaRow[] = [];
      for (const delId of ids) {
        const row = createReplicaRow({
          kind,
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
        annotations: state.annotations.map((annotation) => {
          if (!deletedIds.has(annotation.id)) return annotation;
          const deletedHlc = tombstonesById.get(annotation.id);
          return {
            ...annotation,
            deletedAt: Date.now(),
            _replicaTimestamps: {
              ...annotation._replicaTimestamps,
              ...(deletedHlc ? { __deleted: deletedHlc } : {}),
            },
          };
        }),
        isLoading: false,
        replicaOutbox: [...state.replicaOutbox, ...tombstoneRows],
      }));
    } catch (err) {
      console.error('[annotacionesStore] deleteAnnotations failed:', err);
      set({ isLoading: false });
    }
  },

  removeAnnotationsFromState(ids) {
    if (ids.length === 0) return;
    const deletedIds = new Set(ids);
    set((state) => ({
      annotations: state.annotations.map((a) =>
        deletedIds.has(a.id) ? { ...a, deletedAt: Date.now() } : a,
      ),
      selectedAnnotationIds: state.selectedAnnotationIds.filter((id) => !deletedIds.has(id)),
    }));
  },

  applyRemoteAnnotation(row: ReplicaRow) {
    const itemId = parseReplicaItemId(row);
    if (!itemId) return;

    // Deletion tombstone
    const deleteHlc = row.deleted_at_ts;
    if (deleteHlc) {
      let deletedAnn: Annotacion | undefined;
      set((state) => {
        const existing = state.annotations.find((a) => a.id === itemId);
        if (!existing) {
          deletedAnn = makeDeletedAnnotation(itemId, deleteHlc);
          return { annotations: [...state.annotations, deletedAnn] };
        }
        if (!shouldApplyDelete(existing._replicaTimestamps ?? {}, deleteHlc)) return state;
        deletedAnn = {
          ...existing,
          deletedAt: Date.now(),
          _replicaTimestamps: {
            ...existing._replicaTimestamps,
            __deleted: deleteHlc,
          },
        };
        return {
          annotations: state.annotations.map((a) => (a.id === itemId ? deletedAnn! : a)),
        };
      });
      if (deletedAnn) persistAnnotations([deletedAnn]);
      return;
    }

    // Build a lookup of the latest per-field HLCs from the remote row
    const remoteTimestamps: Record<string, string> = {};
    for (const [key, env] of Object.entries(row.fields_jsonb)) {
      remoteTimestamps[key] = (env as FieldEnvelope).t as string;
    }

    let mergedAnnotation: Annotacion | undefined;
    set((state) => {
      const existingIdx = state.annotations.findIndex((a) => a.id === itemId);

      if (existingIdx < 0) {
        // Insert new annotation from remote fields
        const remoteVals: Record<string, unknown> = {};
        for (const [key, env] of Object.entries(row.fields_jsonb)) {
          remoteVals[key] = (env as FieldEnvelope).v;
        }
        const newAnn: Annotacion = {
          id: itemId,
          bookHash: (remoteVals['bookHash'] as string) || '',
          bookTitle: (remoteVals['bookTitle'] as string) || null,
          bookAuthor: (remoteVals['bookAuthor'] as string) || null,
          cfi: (remoteVals['cfi'] as string) || null,
          sectionHref: (remoteVals['sectionHref'] as string) || null,
          page: (remoteVals['page'] as number) ?? null,
          text: (remoteVals['text'] as string) || '',
          note: (remoteVals['note'] as string) || '',
          style: (remoteVals['style'] as string) || 'highlight',
          color: (remoteVals['color'] as string) || 'yellow',
          createdAt: Date.now(),
          updatedAt: null,
          _replicaTimestamps: remoteTimestamps,
        };
        mergedAnnotation = newAnn;
        return {
          annotations: [...state.annotations, newAnn],
        };
      }

      // Merge per-field: remote HLC > local HLC → update
      const local = state.annotations[existingIdx]!;
      let changed = false;
      const merged = { ...local } as Record<string, unknown>;
      const mergedTimestamps = { ...local._replicaTimestamps };
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
      mergedAnnotation = merged as unknown as Annotacion;

      return {
        annotations: state.annotations.map((a, i) =>
          i === existingIdx ? (merged as unknown as Annotacion) : a,
        ),
      };
    });

    if (mergedAnnotation) persistAnnotations([mergedAnnotation]);
  },

  setSearchQuery(query) {
    set({ searchQuery: query });
  },

  toggleSelect(id) {
    set((state) => ({
      selectedAnnotationIds: state.selectedAnnotationIds.includes(id)
        ? state.selectedAnnotationIds.filter((selectedId) => selectedId !== id)
        : [...state.selectedAnnotationIds, id],
    }));
  },

  selectAll() {
    set((state) => ({
      selectedAnnotationIds: state.annotations.filter((a) => !a.deletedAt).map((a) => a.id),
    }));
  },

  getVisibleAnnotations() {
    return get().annotations.filter((a) => !a.deletedAt);
  },

  enterSelectMode() {
    set({ isSelectMode: true });
  },

  exitSelectMode() {
    set({ isSelectMode: false, selectedAnnotationIds: [] });
  },

  getAllReplicas(deviceId: string): ReplicaRow[] {
    const state = get();
    const rows: ReplicaRow[] = [];
    let lastHLC: Hlc | undefined;
    for (const ann of state.annotations) {
      const row = createReplicaRow({
        kind: 'annotation',
        item: {
          id: ann.id,
          fields: pickReplicaFields(ann),
          deletedAt: ann.deletedAt ? new Date(ann.deletedAt) : undefined,
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
      annotations: [],
      isLoading: false,
      isSelectMode: false,
      selectedAnnotationIds: [],
      searchQuery: '',
      error: null,
      replicaOutbox: [],
    });
  },
}));
