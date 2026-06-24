import { createReplicaRow } from '@/libs/replica/factory';
import { AnotacionesService } from '@/services/annotations/AnotacionesService';
import { CitasService } from '@/services/citas/CitasService';
import { DictionaryService } from '@/services/dictionary/DictionaryService';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import { useCitasStore } from '@/store/citasStore';
import { useDictionaryStore } from '@/store/dictionaryStore';
import environmentConfig from '@/services/environment';
import type { Annotacion } from '@/types/annotaciones';
import type { Cite } from '@/types/citas';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';
import type { ReplicaRow, Hlc } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';

const DELETED_TIMESTAMP_KEY = '__deleted';

type ReplicaTimestampedItem = {
  id: string;
  deletedAt?: number;
  _replicaTimestamps?: Record<string, string>;
};

type VisibleAnnotationsService = Pick<AnotacionesService, 'listAllAnnotations'>;
type VisibleCitasService = Pick<CitasService, 'listAllQuotes'>;
type VisibleDictionaryService = Pick<DictionaryService, 'listAllEntries' | 'listAllOccurrences'>;

export type VisibleSeedProvider = (kind: SyncCategory, deviceId: string) => Promise<ReplicaRow[]>;

export interface VisibleSeedRepository {
  getSeedRows(kind: SyncCategory, deviceId: string): Promise<ReplicaRow[]>;
}

export interface VisibleSeedRepositoryDependencies {
  annotationsService: VisibleAnnotationsService;
  citasService: VisibleCitasService;
  dictionaryService: VisibleDictionaryService;
}

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

const ENTRY_REPLICA_FIELDS = [
  'term',
  'displayTerm',
  'language',
  'definition',
  'imagePath',
  'curiosity',
  'enrichmentStatus',
] as const;

const OCCURRENCE_REPLICA_FIELDS = [
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
] as const;

export function createVisibleSeedRepository(
  dependencies: VisibleSeedRepositoryDependencies,
): VisibleSeedRepository {
  return {
    async getSeedRows(kind, deviceId) {
      switch (kind) {
        case 'annotation': {
          const annotations = await dependencies.annotationsService.listAllAnnotations();
          return annotationsToReplicaRows(annotations, deviceId);
        }
        case 'quote': {
          const quotes = await dependencies.citasService.listAllQuotes();
          return quotesToReplicaRows(quotes, deviceId);
        }
        case 'dictionary-entry': {
          const entries = await dependencies.dictionaryService.listAllEntries();
          return dictionaryToReplicaRows(entries, [], deviceId);
        }
        case 'dictionary-occurrence': {
          const occurrences = await dependencies.dictionaryService.listAllOccurrences();
          return dictionaryToReplicaRows([], occurrences, deviceId);
        }
        default:
          return [];
      }
    },
  };
}

export const defaultVisibleSeedProvider: VisibleSeedProvider = async (kind, deviceId) => {
  // Prefer direct DB reads so the seed works even when Zustand stores
  // haven't been loaded yet (e.g. after a cold app start). Fall back to
  // stores when the app is running in a web context without DB access.
  switch (kind) {
    case 'annotation': {
      try {
        const appService = await environmentConfig.getAppService();
        const annService = await AnotacionesService.open(appService);
        const annotations = await annService.listAllAnnotations();
        return annotationsToReplicaRows(annotations, deviceId);
      } catch {
        return useAnotacionesStore.getState().getAllReplicas(deviceId);
      }
    }
    case 'quote': {
      try {
        const appService = await environmentConfig.getAppService();
        const citasService = await CitasService.open(appService);
        const quotes = await citasService.listAllQuotes();
        return quotesToReplicaRows(quotes, deviceId);
      } catch {
        return useCitasStore.getState().getAllReplicas(deviceId);
      }
    }
    case 'dictionary-entry': {
      try {
        const appService = await environmentConfig.getAppService();
        const dictService = await DictionaryService.open(appService);
        const entries = await dictService.listAllEntries();
        return dictionaryToReplicaRows(entries, [], deviceId);
      } catch {
        return useDictionaryStore
          .getState()
          .getAllReplicas(deviceId)
          .filter((row) => row.kind === 'dictionary-entry');
      }
    }
    case 'dictionary-occurrence': {
      try {
        const appService = await environmentConfig.getAppService();
        const dictService = await DictionaryService.open(appService);
        const occurrences = await dictService.listAllOccurrences();
        return dictionaryToReplicaRows([], occurrences, deviceId);
      } catch {
        return useDictionaryStore
          .getState()
          .getAllReplicas(deviceId)
          .filter((row) => row.kind === 'dictionary-occurrence');
      }
    }
    default:
      return [];
  }
};

function annotationsToReplicaRows(annotations: Annotacion[], deviceId: string): ReplicaRow[] {
  let lastHLC: Hlc | undefined;
  return annotations.map((annotation) => {
    const row = durableItemToReplicaRow({
      kind: 'annotation',
      item: annotation,
      fields: pickReplicaFields(annotation, ANNOTATION_REPLICA_FIELDS),
      deviceId,
      lastHLC,
    });
    lastHLC = row.updated_at_ts;
    return row;
  });
}

function quotesToReplicaRows(quotes: Cite[], deviceId: string): ReplicaRow[] {
  let lastHLC: Hlc | undefined;
  return quotes.map((quote) => {
    const row = durableItemToReplicaRow({
      kind: 'quote',
      item: quote,
      fields: pickReplicaFields(quote, QUOTE_REPLICA_FIELDS),
      deviceId,
      lastHLC,
    });
    lastHLC = row.updated_at_ts;
    return row;
  });
}

function dictionaryToReplicaRows(
  entries: DictionaryEntry[],
  occurrences: DictionaryOccurrence[],
  deviceId: string,
): ReplicaRow[] {
  const rows: ReplicaRow[] = [];
  let lastHLC: Hlc | undefined;

  for (const entry of entries) {
    const row = durableItemToReplicaRow({
      kind: 'dictionary-entry',
      item: entry,
      fields: pickReplicaFields(entry, ENTRY_REPLICA_FIELDS),
      deviceId,
      lastHLC,
    });
    lastHLC = row.updated_at_ts;
    rows.push(row);
  }

  for (const occurrence of occurrences) {
    const row = durableItemToReplicaRow({
      kind: 'dictionary-occurrence',
      item: occurrence,
      fields: pickReplicaFields(occurrence, OCCURRENCE_REPLICA_FIELDS),
      deviceId,
      lastHLC,
    });
    lastHLC = row.updated_at_ts;
    rows.push(row);
  }

  return rows;
}

function durableItemToReplicaRow(input: {
  kind: SyncCategory;
  item: ReplicaTimestampedItem;
  fields: Record<string, unknown>;
  deviceId: string;
  lastHLC?: Hlc;
}): ReplicaRow {
  const row = createReplicaRow({
    kind: input.kind,
    item: {
      id: input.item.id,
      fields: input.fields,
      deletedAt: input.item.deletedAt ? new Date(input.item.deletedAt) : undefined,
    },
    deviceId: input.deviceId,
    lastHLC: input.lastHLC,
  });

  const timestamps = input.item._replicaTimestamps;
  if (!timestamps) return row;

  for (const [key, timestamp] of Object.entries(timestamps)) {
    if (key === DELETED_TIMESTAMP_KEY) continue;
    const field = row.fields_jsonb[key];
    if (!field) continue;
    row.fields_jsonb[key] = { ...field, t: timestamp as Hlc };
  }

  const deleteTimestamp = timestamps[DELETED_TIMESTAMP_KEY] as Hlc | undefined;
  if (deleteTimestamp && row.deleted_at_ts) {
    row.deleted_at_ts = deleteTimestamp;
  }

  const durableMax = maxHlc(Object.values(timestamps).map((timestamp) => timestamp as Hlc));
  if (durableMax) row.updated_at_ts = durableMax;

  return row;
}

function maxHlc(values: readonly (Hlc | undefined)[]): Hlc | undefined {
  let max: Hlc | undefined;
  for (const value of values) {
    if (value && (!max || value > max)) max = value;
  }
  return max;
}

function pickReplicaFields<T extends object>(
  item: T,
  fieldList: readonly (keyof T & string)[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of fieldList) {
    fields[key] = item[key];
  }
  return fields;
}
