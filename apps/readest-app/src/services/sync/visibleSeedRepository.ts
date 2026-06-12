import { createReplicaRow } from '@/libs/replica/factory';
import { AnotacionesService } from '@/services/annotations/AnotacionesService';
import { CitasService } from '@/services/citas/CitasService';
import { DictionaryService } from '@/services/dictionary/DictionaryService';
import environmentConfig from '@/services/environment';
import type { Annotacion } from '@/types/annotaciones';
import type { Cite } from '@/types/citas';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';
import type { ReplicaRow, Hlc } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';

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
          const [entries, occurrences] = await Promise.all([
            dependencies.dictionaryService.listAllEntries(),
            dependencies.dictionaryService.listAllOccurrences(),
          ]);
          return dictionaryToReplicaRows(entries, occurrences, deviceId);
        }
      }
    },
  };
}

export const defaultVisibleSeedProvider: VisibleSeedProvider = async (kind, deviceId) => {
  const appService = await environmentConfig.getAppService();

  switch (kind) {
    case 'annotation': {
      const service = await AnotacionesService.open(appService);
      try {
        return annotationsToReplicaRows(await service.listAllAnnotations(), deviceId);
      } finally {
        await service.close();
      }
    }
    case 'quote': {
      const service = await CitasService.open(appService);
      try {
        return quotesToReplicaRows(await service.listAllQuotes(), deviceId);
      } finally {
        await service.close();
      }
    }
    case 'dictionary-entry': {
      const service = await DictionaryService.open(appService);
      try {
        const [entries, occurrences] = await Promise.all([
          service.listAllEntries(),
          service.listAllOccurrences(),
        ]);
        return dictionaryToReplicaRows(entries, occurrences, deviceId);
      } finally {
        await service.close();
      }
    }
  }
};

function annotationsToReplicaRows(annotations: Annotacion[], deviceId: string): ReplicaRow[] {
  let lastHLC: Hlc | undefined;
  return annotations.map((annotation) => {
    const row = createReplicaRow({
      kind: 'annotation',
      item: {
        id: annotation.id,
        fields: pickReplicaFields(annotation, ANNOTATION_REPLICA_FIELDS),
        deletedAt: annotation.deletedAt ? new Date(annotation.deletedAt) : undefined,
      },
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
    const row = createReplicaRow({
      kind: 'quote',
      item: {
        id: quote.id,
        fields: pickReplicaFields(quote, QUOTE_REPLICA_FIELDS),
        deletedAt: quote.deletedAt ? new Date(quote.deletedAt) : undefined,
      },
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
    const row = createReplicaRow({
      kind: 'dictionary-entry',
      item: {
        id: entry.id,
        fields: pickReplicaFields(entry, ENTRY_REPLICA_FIELDS),
        deletedAt: entry.deletedAt ? new Date(entry.deletedAt) : undefined,
      },
      deviceId,
      lastHLC,
    });
    lastHLC = row.updated_at_ts;
    rows.push(row);
  }

  for (const occurrence of occurrences) {
    const row = createReplicaRow({
      kind: 'dictionary-entry',
      item: {
        id: occurrence.id,
        fields: pickReplicaFields(occurrence, OCCURRENCE_REPLICA_FIELDS),
        deletedAt: occurrence.deletedAt ? new Date(occurrence.deletedAt) : undefined,
      },
      deviceId,
      lastHLC,
    });
    lastHLC = row.updated_at_ts;
    rows.push(row);
  }

  return rows;
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
