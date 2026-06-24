import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDictionaryStore } from '@/store/dictionaryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ReplicaRow, FieldEnvelope, Hlc } from '@/types/replica';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';

// ---------------------------------------------------------------------------
// Mocks for fire-and-forget persistence
// ---------------------------------------------------------------------------

const mockBulkUpsertEntries = vi.fn().mockResolvedValue(undefined);
const mockBulkUpsertOccurrences = vi.fn().mockResolvedValue(undefined);
const mockGetDictionaryService = vi.fn().mockResolvedValue({
  bulkUpsertEntries: mockBulkUpsertEntries,
  bulkUpsertOccurrences: mockBulkUpsertOccurrences,
});

vi.mock('@/services/dictionary/dictionaryServiceCache', () => ({
  getDictionaryService: (...args: unknown[]) => mockGetDictionaryService(...args),
}));

const mockGetAppService = vi.fn().mockResolvedValue('mock-app-service');
vi.mock('@/services/environment', () => ({
  default: { getAppService: (...args: unknown[]) => mockGetAppService(...args) },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DEVICE_ID = 'test-device-cccc';
const OLD_HLC = '0000000000001-00000001-test-device-cccc' as Hlc;
const NEW_HLC = '0000000000002-00000001-test-device-cccc' as Hlc;
const NEWER_HLC = '0000000000003-00000001-test-device-cccc' as Hlc;

function makeEntryRow(params: {
  id: string;
  hlc: Hlc;
  fields: Record<string, unknown>;
  deleted?: boolean;
}): ReplicaRow {
  const fields_jsonb: Record<string, FieldEnvelope> = {};
  for (const [key, value] of Object.entries(params.fields)) {
    fields_jsonb[key] = { v: value, t: params.hlc, s: DEVICE_ID };
  }
  return {
    user_id: '',
    kind: 'dictionary-entry',
    replica_id: `dictionary-entry:${params.id}`,
    fields_jsonb,
    manifest_jsonb: null,
    deleted_at_ts: params.deleted ? params.hlc : null,
    reincarnation: null,
    updated_at_ts: params.hlc,
    schema_version: 1,
  };
}

function makeOccurrenceRow(params: {
  id: string;
  hlc: Hlc;
  fields: Record<string, unknown>;
  deleted?: boolean;
}): ReplicaRow {
  const fields_jsonb: Record<string, FieldEnvelope> = {};
  for (const [key, value] of Object.entries(params.fields)) {
    fields_jsonb[key] = { v: value, t: params.hlc, s: DEVICE_ID };
  }
  return {
    user_id: '',
    kind: 'dictionary-entry',
    replica_id: `dictionary-occurrence:${params.id}`,
    fields_jsonb,
    manifest_jsonb: null,
    deleted_at_ts: params.deleted ? params.hlc : null,
    reincarnation: null,
    updated_at_ts: params.hlc,
    schema_version: 1,
  };
}

function asDictionaryService(service: Partial<DictionaryService>): DictionaryService {
  return service as DictionaryService;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('dictionaryStore — replica applyRemoteDictionaryEntry', () => {
  beforeEach(() => {
    const cur = useSettingsStore.getState().settings;
    useSettingsStore.getState().setSettings({
      ...cur,
      replicaDeviceId: DEVICE_ID,
    });
  });

  afterEach(() => {
    useDictionaryStore.getState().reset();
  });

  // ---- applyRemoteDictionaryEntry ----

  it('applyRemoteDictionaryEntry inserts a NEW entry from a ReplicaRow', () => {
    const row = makeEntryRow({
      id: 'entry-remote-1',
      hlc: NEW_HLC,
      fields: {
        term: 'serendipia',
        displayTerm: 'serendipia',
        language: 'es',
        definition: 'Un hallazgo afortunado.',
        curiosity: 'Acuñada por Horace Walpole.',
        enrichmentStatus: 'ready',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryEntry(row);

    const entries = useDictionaryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe('entry-remote-1');
    expect(entries[0]!.term).toBe('serendipia');
    expect(entries[0]!.definition).toBe('Un hallazgo afortunado.');
    expect(entries[0]!.deletedAt).toBeUndefined();
  });

  it('applyRemoteDictionaryEntry merges fields with NEWER HLC into an existing entry', () => {
    const localRow = makeEntryRow({
      id: 'entry-exist',
      hlc: OLD_HLC,
      fields: { term: 'ephemeral', definition: 'short-lived' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(localRow);

    const remoteRow = makeEntryRow({
      id: 'entry-exist',
      hlc: NEW_HLC,
      fields: { term: 'ephemeral', definition: 'Lasting for a very short time' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(remoteRow);

    const e = useDictionaryStore.getState().entries[0]!;
    expect(e.definition).toBe('Lasting for a very short time');
    expect(useDictionaryStore.getState().entries).toHaveLength(1);
  });

  it('applyRemoteDictionaryEntry with OLDER HLC does NOT overwrite newer fields', () => {
    const localRow = makeEntryRow({
      id: 'entry-exist',
      hlc: NEW_HLC,
      fields: { term: 'ephemeral', definition: 'correct def' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(localRow);

    const remoteRow = makeEntryRow({
      id: 'entry-exist',
      hlc: OLD_HLC,
      fields: { term: 'ephemeral', definition: 'STALE def' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(remoteRow);

    const e = useDictionaryStore.getState().entries[0]!;
    expect(e.definition).toBe('correct def');
  });

  it('applyRemoteDictionaryEntry with deleted_at_ts soft-deletes the entry', () => {
    const localRow = makeEntryRow({
      id: 'entry-to-del',
      hlc: OLD_HLC,
      fields: { term: 'to delete' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(localRow);

    const tombstoneRow = makeEntryRow({
      id: 'entry-to-del',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(tombstoneRow);

    const e = useDictionaryStore.getState().entries[0]!;
    expect(e.deletedAt).toBeDefined();
  });

  it('applyRemoteDictionaryEntry tombstone on non-existent id retains a tombstone', () => {
    const tombstoneRow = makeEntryRow({
      id: 'entry-ghost',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });

    expect(() =>
      useDictionaryStore.getState().applyRemoteDictionaryEntry(tombstoneRow),
    ).not.toThrow();

    const entries = useDictionaryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('entry-ghost');
    expect(entries[0]?.deletedAt).toBeDefined();
    expect(entries[0]?._replicaTimestamps?.['__deleted']).toBe(NEW_HLC);
  });

  it('applyRemoteDictionaryEntry keeps a newer tombstone when a stale live row arrives', () => {
    useDictionaryStore
      .getState()
      .applyRemoteDictionaryEntry(
        makeEntryRow({ id: 'entry-delete-wins', hlc: NEW_HLC, fields: {}, deleted: true }),
      );

    useDictionaryStore.getState().applyRemoteDictionaryEntry(
      makeEntryRow({
        id: 'entry-delete-wins',
        hlc: OLD_HLC,
        fields: { term: 'stale', definition: 'stale definition' },
      }),
    );

    const entry = useDictionaryStore.getState().entries[0]!;
    expect(entry.deletedAt).toBeDefined();
    expect(entry.term).toBe('');
    expect(entry.definition).toBeUndefined();
  });

  it('applyRemoteDictionaryEntry ignores an older tombstone when newer live fields exist', () => {
    useDictionaryStore.getState().applyRemoteDictionaryEntry(
      makeEntryRow({
        id: 'entry-live-wins',
        hlc: NEWER_HLC,
        fields: { term: 'fresh', definition: 'fresh definition' },
      }),
    );

    useDictionaryStore
      .getState()
      .applyRemoteDictionaryEntry(
        makeEntryRow({ id: 'entry-live-wins', hlc: NEW_HLC, fields: {}, deleted: true }),
      );

    const entry = useDictionaryStore.getState().entries[0]!;
    expect(entry.deletedAt).toBeUndefined();
    expect(entry.term).toBe('fresh');
    expect(entry.definition).toBe('fresh definition');
  });

  it('applyRemoteDictionaryOccurrence retains an unknown tombstone for future seeds', () => {
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(
      makeOccurrenceRow({
        id: 'occ-ghost',
        hlc: NEW_HLC,
        fields: { entryId: 'entry-ghost', bookHash: 'hash-ghost' },
        deleted: true,
      }),
    );

    const occurrences = useDictionaryStore.getState().occurrencesByEntryId['entry-ghost'];
    expect(occurrences).toHaveLength(1);
    expect(occurrences?.[0]?.id).toBe('occ-ghost');
    expect(occurrences?.[0]?.deletedAt).toBeDefined();
    expect(occurrences?.[0]?._replicaTimestamps?.['__deleted']).toBe(NEW_HLC);
  });

  // ---- applyRemoteDictionaryOccurrence ----

  it('applyRemoteDictionaryOccurrence inserts a NEW occurrence from a ReplicaRow', () => {
    useDictionaryStore.getState().setOccurrences('entry-1', []);

    const row = makeOccurrenceRow({
      id: 'occ-remote-1',
      hlc: NEW_HLC,
      fields: {
        entryId: 'entry-1',
        bookHash: 'hash-occ',
        bookTitle: 'Some Book',
        cfi: '/6/2',
        selectedText: 'serendipia',
        contextBefore: 'I found a',
        contextAfter: 'in the library',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(row);

    const occurrences = useDictionaryStore.getState().occurrencesByEntryId['entry-1'];
    expect(occurrences).toBeDefined();
    expect(occurrences!).toHaveLength(1);
    expect(occurrences![0]!.id).toBe('occ-remote-1');
    expect(occurrences![0]!.selectedText).toBe('serendipia');
  });

  it('applyRemoteDictionaryOccurrence merges newer fields into an existing occurrence', () => {
    // Seed an occurrence
    const seedRow = makeOccurrenceRow({
      id: 'occ-exist',
      hlc: OLD_HLC,
      fields: { entryId: 'entry-1', selectedText: 'old text', bookHash: 'h1' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(seedRow);

    // Remote updates with newer HLC
    const remoteRow = makeOccurrenceRow({
      id: 'occ-exist',
      hlc: NEW_HLC,
      fields: { entryId: 'entry-1', selectedText: 'newer text', bookHash: 'h1' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(remoteRow);

    const occs = useDictionaryStore.getState().occurrencesByEntryId['entry-1'];
    expect(occs).toHaveLength(1);
    expect(occs![0]!.selectedText).toBe('newer text');
  });

  it('applyRemoteDictionaryOccurrence with deleted_at_ts soft-deletes the occurrence', () => {
    const seedRow = makeOccurrenceRow({
      id: 'occ-to-del',
      hlc: OLD_HLC,
      fields: { entryId: 'entry-1', selectedText: 'will delete' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(seedRow);

    const tombstone = makeOccurrenceRow({
      id: 'occ-to-del',
      hlc: NEW_HLC,
      fields: { entryId: 'entry-1' },
      deleted: true,
    });
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(tombstone);

    // D4: Occurrence is soft-deleted (kept in array with deletedAt set)
    const occs = useDictionaryStore.getState().occurrencesByEntryId['entry-1'] ?? [];
    expect(occs).toHaveLength(1);
    expect(occs[0]?.id).toBe('occ-to-del');
    expect(occs[0]?.deletedAt).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // R5: Merge CRDT idempotente — aplicar la misma réplica dos veces no duplica
  // ---------------------------------------------------------------------------

  it('aplicar la misma entry dos veces no duplica (R5)', () => {
    const row = makeEntryRow({
      id: 'entry-idem-1',
      hlc: NEW_HLC,
      fields: {
        term: 'idempotencia',
        displayTerm: 'idempotencia',
        language: 'es',
        definition:
          'Propiedad de una operación que puede aplicarse múltiples veces sin cambiar el resultado más allá de la primera aplicación.',
        curiosity: 'Del latín idem (lo mismo) + potens (poder).',
        enrichmentStatus: 'ready',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryEntry(row);
    useDictionaryStore.getState().applyRemoteDictionaryEntry(row);

    const entries = useDictionaryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.term).toBe('idempotencia');
    expect(entries[0]!.definition).toBe(
      'Propiedad de una operación que puede aplicarse múltiples veces sin cambiar el resultado más allá de la primera aplicación.',
    );
  });

  it('aplicar la misma entry tras merge no modifica ni duplica (R5, triangulación)', () => {
    const row = makeEntryRow({
      id: 'entry-idem-2',
      hlc: NEW_HLC,
      fields: {
        term: 'triangulación',
        definition: 'Técnica de TDD para forzar lógica real desde una implementación fake.',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryEntry(row);
    useDictionaryStore.getState().applyRemoteDictionaryEntry(row);

    const entries = useDictionaryStore.getState().entries;
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.term).toBe('triangulación');
    expect(e.definition).toBe(
      'Técnica de TDD para forzar lógica real desde una implementación fake.',
    );
  });

  it('aplicar la misma occurrence dos veces no duplica (R5)', () => {
    useDictionaryStore.getState().setOccurrences('entry-idem', []);

    const row = makeOccurrenceRow({
      id: 'occ-idem-1',
      hlc: NEW_HLC,
      fields: {
        entryId: 'entry-idem',
        bookHash: 'hash-idem',
        bookTitle: 'Idempotent Book',
        cfi: '/6/2',
        selectedText: 'idempotencia',
        contextBefore: 'La',
        contextAfter: 'es clave en CRDTs.',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(row);
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(row);

    const occurrences = useDictionaryStore.getState().occurrencesByEntryId['entry-idem'];
    expect(occurrences).toBeDefined();
    expect(occurrences!).toHaveLength(1);
    expect(occurrences![0]!.selectedText).toBe('idempotencia');
  });

  it('aplicar la misma occurrence tras merge no duplica (R5, triangulación)', () => {
    useDictionaryStore.getState().setOccurrences('entry-idem2', []);

    const row = makeOccurrenceRow({
      id: 'occ-idem-2',
      hlc: NEW_HLC,
      fields: {
        entryId: 'entry-idem2',
        bookHash: 'hash-idem2',
        selectedText: 'triangulación',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(row);
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(row);

    const occurrences = useDictionaryStore.getState().occurrencesByEntryId['entry-idem2'];
    expect(occurrences).toBeDefined();
    expect(occurrences!).toHaveLength(1);
    expect(occurrences![0]!.selectedText).toBe('triangulación');
  });

  // ---- highlightNoteId round-trip ----

  it('applyRemoteDictionaryOccurrence maps highlightNoteId from remote row', () => {
    useDictionaryStore.getState().setOccurrences('entry-hl', []);

    const row = makeOccurrenceRow({
      id: 'occ-hl-1',
      hlc: NEW_HLC,
      fields: {
        entryId: 'entry-hl',
        bookHash: 'hash-hl',
        bookTitle: 'Highlight Book',
        cfi: '/6/2',
        selectedText: 'serendipity',
        highlightNoteId: 'note-abc',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(row);

    const occurrences = useDictionaryStore.getState().occurrencesByEntryId['entry-hl'];
    expect(occurrences).toBeDefined();
    expect(occurrences!).toHaveLength(1);
    expect(occurrences![0]!.highlightNoteId).toBe('note-abc');
  });

  it('applyRemoteDictionaryOccurrence maps empty highlightNoteId when not in remote row', () => {
    useDictionaryStore.getState().setOccurrences('entry-no-hl', []);

    const row = makeOccurrenceRow({
      id: 'occ-no-hl-1',
      hlc: NEW_HLC,
      fields: {
        entryId: 'entry-no-hl',
        bookHash: 'hash-no-hl',
        selectedText: 'no highlight',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(row);

    const occurrences = useDictionaryStore.getState().occurrencesByEntryId['entry-no-hl'];
    expect(occurrences!).toHaveLength(1);
    expect(occurrences![0]!.highlightNoteId).toBeFalsy();
  });

  // ---------------------------------------------------------------------------
  // D2: persist-after-apply wiring — entries
  // ---------------------------------------------------------------------------

  it('applyRemoteDictionaryEntry persists NEW entry to SQLite via bulkUpsertEntries', async () => {
    mockBulkUpsertEntries.mockClear();
    mockGetAppService.mockClear();
    mockGetDictionaryService.mockClear();

    const row = makeEntryRow({
      id: 'entry-persist-1',
      hlc: NEW_HLC,
      fields: {
        term: 'serendipia',
        displayTerm: 'serendipia',
        language: 'es',
        definition: 'Un hallazgo afortunado.',
        curiosity: 'Acuñada por Horace Walpole.',
        enrichmentStatus: 'ready',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryEntry(row);

    await vi.waitFor(() => expect(mockBulkUpsertEntries).toHaveBeenCalledTimes(1));

    expect(mockGetAppService).toHaveBeenCalledTimes(1);
    expect(mockGetDictionaryService).toHaveBeenCalledWith('mock-app-service');

    const persistedEntries = mockBulkUpsertEntries.mock.calls[0]![0];
    expect(persistedEntries).toHaveLength(1);
    expect(persistedEntries[0].id).toBe('entry-persist-1');
    expect(persistedEntries[0].term).toBe('serendipia');
  });

  it('applyRemoteDictionaryEntry persists MERGED entry to SQLite', async () => {
    mockBulkUpsertEntries.mockClear();

    const localRow = makeEntryRow({
      id: 'entry-merge-persist',
      hlc: OLD_HLC,
      fields: { term: 'ephemeral', definition: 'short-lived' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(localRow);
    // Wait for seed's fire-and-forget to complete, then clear
    await vi.waitFor(() => expect(mockBulkUpsertEntries).toHaveBeenCalledTimes(1));
    mockBulkUpsertEntries.mockClear();

    const remoteRow = makeEntryRow({
      id: 'entry-merge-persist',
      hlc: NEW_HLC,
      fields: { term: 'ephemeral', definition: 'Lasting for a very short time' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(remoteRow);

    await vi.waitFor(() => expect(mockBulkUpsertEntries).toHaveBeenCalledTimes(1));

    const persistedEntries = mockBulkUpsertEntries.mock.calls[0]![0];
    expect(persistedEntries).toHaveLength(1);
    expect(persistedEntries[0].id).toBe('entry-merge-persist');
    expect(persistedEntries[0].definition).toBe('Lasting for a very short time');
  });

  it('applyRemoteDictionaryEntry persists SOFT-DELETED entry to SQLite', async () => {
    mockBulkUpsertEntries.mockClear();

    const localRow = makeEntryRow({
      id: 'entry-del-persist',
      hlc: OLD_HLC,
      fields: { term: 'to delete' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(localRow);
    // Wait for seed's fire-and-forget to complete, then clear
    await vi.waitFor(() => expect(mockBulkUpsertEntries).toHaveBeenCalledTimes(1));
    mockBulkUpsertEntries.mockClear();

    const tombstoneRow = makeEntryRow({
      id: 'entry-del-persist',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(tombstoneRow);

    await vi.waitFor(() => expect(mockBulkUpsertEntries).toHaveBeenCalledTimes(1));

    const persistedEntries = mockBulkUpsertEntries.mock.calls[0]![0];
    expect(persistedEntries).toHaveLength(1);
    expect(persistedEntries[0].id).toBe('entry-del-persist');
    expect(persistedEntries[0].deletedAt).toBeDefined();
  });

  it('applyRemoteDictionaryEntry does NOT persist when no change (older HLC)', async () => {
    mockBulkUpsertEntries.mockClear();

    const localRow = makeEntryRow({
      id: 'entry-nochange',
      hlc: NEW_HLC,
      fields: { term: 'ephemeral', definition: 'correct def' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(localRow);
    // Wait for seed's fire-and-forget to complete, then clear
    await vi.waitFor(() => expect(mockBulkUpsertEntries).toHaveBeenCalledTimes(1));
    mockBulkUpsertEntries.mockClear();

    const remoteRow = makeEntryRow({
      id: 'entry-nochange',
      hlc: OLD_HLC,
      fields: { term: 'ephemeral', definition: 'STALE def' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(remoteRow);

    await new Promise((r) => setTimeout(r, 50));
    expect(mockBulkUpsertEntries).not.toHaveBeenCalled();
  });

  it('applyRemoteDictionaryEntry persists tombstone for non-existent id', async () => {
    mockBulkUpsertEntries.mockClear();

    const tombstoneRow = makeEntryRow({
      id: 'entry-ghost-persist',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });
    useDictionaryStore.getState().applyRemoteDictionaryEntry(tombstoneRow);

    await vi.waitFor(() => expect(mockBulkUpsertEntries).toHaveBeenCalledTimes(1));
    const persistedEntries = mockBulkUpsertEntries.mock.calls[0]![0];
    expect(persistedEntries).toHaveLength(1);
    expect(persistedEntries[0].id).toBe('entry-ghost-persist');
    expect(persistedEntries[0].deletedAt).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // D2: persist-after-apply wiring — occurrences
  // ---------------------------------------------------------------------------

  it('applyRemoteDictionaryOccurrence persists NEW occurrence to SQLite via bulkUpsertOccurrences', async () => {
    mockBulkUpsertOccurrences.mockClear();
    mockGetAppService.mockClear();
    mockGetDictionaryService.mockClear();

    useDictionaryStore.getState().setOccurrences('entry-1', []);

    const row = makeOccurrenceRow({
      id: 'occ-persist-1',
      hlc: NEW_HLC,
      fields: {
        entryId: 'entry-1',
        bookHash: 'hash-occ',
        bookTitle: 'Some Book',
        cfi: '/6/2',
        selectedText: 'serendipia',
        contextBefore: 'I found a',
        contextAfter: 'in the library',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(row);

    await vi.waitFor(() => expect(mockBulkUpsertOccurrences).toHaveBeenCalledTimes(1));

    const persistedOccurrences = mockBulkUpsertOccurrences.mock.calls[0]![0];
    expect(persistedOccurrences).toHaveLength(1);
    expect(persistedOccurrences[0].id).toBe('occ-persist-1');
    expect(persistedOccurrences[0].selectedText).toBe('serendipia');
  });

  it('applyRemoteDictionaryOccurrence persists MERGED occurrence to SQLite', async () => {
    mockBulkUpsertOccurrences.mockClear();

    const seedRow = makeOccurrenceRow({
      id: 'occ-merge-persist',
      hlc: OLD_HLC,
      fields: { entryId: 'entry-1', selectedText: 'old text', bookHash: 'h1' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(seedRow);
    // Wait for seed's fire-and-forget to complete, then clear
    await vi.waitFor(() => expect(mockBulkUpsertOccurrences).toHaveBeenCalledTimes(1));
    mockBulkUpsertOccurrences.mockClear();

    const remoteRow = makeOccurrenceRow({
      id: 'occ-merge-persist',
      hlc: NEW_HLC,
      fields: { entryId: 'entry-1', selectedText: 'newer text', bookHash: 'h1' },
    });
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(remoteRow);

    await vi.waitFor(() => expect(mockBulkUpsertOccurrences).toHaveBeenCalledTimes(1));

    const persistedOccurrences = mockBulkUpsertOccurrences.mock.calls[0]![0];
    expect(persistedOccurrences).toHaveLength(1);
    expect(persistedOccurrences[0].id).toBe('occ-merge-persist');
    expect(persistedOccurrences[0].selectedText).toBe('newer text');
  });

  // ---- entry guard: rows without term are no-ops ----

  it('applyRemoteDictionaryEntry skips row without term field (phantom entry guard)', () => {
    const row = makeEntryRow({
      id: 'occurrence-as-entry',
      hlc: NEW_HLC,
      fields: {
        entryId: 'some-entry',
        bookHash: 'hash-phantom',
        selectedText: 'should not become an entry',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryEntry(row);

    const entries = useDictionaryStore.getState().entries;
    expect(entries).toHaveLength(0);
  });

  it('applyRemoteDictionaryEntry inserts row with term field normally', () => {
    const row = makeEntryRow({
      id: 'entry-with-term',
      hlc: NEW_HLC,
      fields: {
        term: 'hello',
        displayTerm: 'hello',
      },
    });

    useDictionaryStore.getState().applyRemoteDictionaryEntry(row);

    const entries = useDictionaryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.term).toBe('hello');
  });

  // ---- replicaOutbox on entry CRUD ----

  it('replicaOutbox starts empty', () => {
    expect(useDictionaryStore.getState().replicaOutbox).toEqual([]);
  });

  it('addEntry pushes a ReplicaRow to the outbox', async () => {
    const created = {
      id: 'entry-outbox-1',
      term: 'hello',
      displayTerm: 'hello',
      language: 'en',
      enrichmentStatus: 'none' as const,
      definition: 'a greeting',
      createdAt: 100,
      updatedAt: 200,
    };
    const service = {
      upsertEntry: vi.fn().mockResolvedValue(created),
      updateEntry: vi.fn().mockResolvedValue(created),
    };

    await useDictionaryStore
      .getState()
      .addEntry(
        { term: 'hello', definition: 'a greeting', language: 'en' },
        asDictionaryService(service),
      );

    const outbox = useDictionaryStore.getState().replicaOutbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.kind).toBe('dictionary-entry');
    expect(outbox[0]!.replica_id).toBe('dictionary-entry:entry-outbox-1');
    expect(outbox[0]!.deleted_at_ts).toBeNull();

    const stored = useDictionaryStore.getState().entries[0]!;
    expect(stored._replicaTimestamps).toEqual({
      term: outbox[0]!.fields_jsonb['term']!.t,
      displayTerm: outbox[0]!.fields_jsonb['displayTerm']!.t,
      language: outbox[0]!.fields_jsonb['language']!.t,
      definition: outbox[0]!.fields_jsonb['definition']!.t,
      imagePath: outbox[0]!.fields_jsonb['imagePath']!.t,
      curiosity: outbox[0]!.fields_jsonb['curiosity']!.t,
      enrichmentStatus: outbox[0]!.fields_jsonb['enrichmentStatus']!.t,
    });
  });

  it('updateEntry stores per-field replica timestamps from the minted ReplicaRow', async () => {
    useDictionaryStore.getState().setEntries([
      {
        id: 'entry-update-1',
        term: 'hello',
        displayTerm: 'hello',
        enrichmentStatus: 'none',
        createdAt: 100,
        updatedAt: 100,
      },
    ]);
    const updated = {
      ...useDictionaryStore.getState().entries[0]!,
      definition: 'updated definition',
      updatedAt: 200,
    };
    const service = { updateEntry: vi.fn().mockResolvedValue(updated) };

    await useDictionaryStore
      .getState()
      .updateEntry(
        { id: 'entry-update-1', definition: 'updated definition' },
        asDictionaryService(service),
      );

    const outbox = useDictionaryStore.getState().replicaOutbox;
    const stored = useDictionaryStore.getState().entry!;
    expect(stored._replicaTimestamps?.['definition']).toBe(
      outbox[0]!.fields_jsonb['definition']!.t,
    );
    expect(stored._replicaTimestamps?.['term']).toBe(outbox[0]!.fields_jsonb['term']!.t);
  });

  it('deleteSelectedEntries pushes tombstone ReplicaRows to the outbox', async () => {
    useDictionaryStore.getState().setEntries([
      {
        id: 'entry-del-1',
        term: 'will delete',
        displayTerm: 'will delete',
        enrichmentStatus: 'none',
        createdAt: 100,
        updatedAt: 200,
      },
    ]);

    const service = { deleteEntries: vi.fn().mockResolvedValue(undefined) };
    useDictionaryStore.getState().enterSelectMode();
    useDictionaryStore.getState().toggleSelectedEntry('entry-del-1');

    await useDictionaryStore.getState().deleteSelectedEntries(asDictionaryService(service));

    const outbox = useDictionaryStore.getState().replicaOutbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.kind).toBe('dictionary-entry');
    expect(outbox[0]!.replica_id).toBe('dictionary-entry:entry-del-1');
    expect(outbox[0]!.deleted_at_ts).not.toBeNull();
  });

  // ---- addEntry double-write race ----

  it('addEntry does NOT call updateEntry when upsertEntry already set the definition', async () => {
    const upserted = {
      id: 'entry-no-race',
      term: 'hello',
      displayTerm: 'hello',
      language: 'en',
      enrichmentStatus: 'none' as const,
      definition: 'a greeting',
      createdAt: 100,
      updatedAt: 200,
    };
    const updateEntry = vi.fn();
    const service = {
      upsertEntry: vi.fn().mockResolvedValue(upserted),
      updateEntry,
    };

    await useDictionaryStore
      .getState()
      .addEntry(
        { term: 'hello', definition: 'a greeting', language: 'en' },
        asDictionaryService(service),
      );

    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('addEntry DOES call updateEntry when upsertEntry does NOT return the definition', async () => {
    const upserted = {
      id: 'entry-needs-update',
      term: 'hello',
      displayTerm: 'hello',
      language: 'en',
      enrichmentStatus: 'none' as const,
      definition: undefined,
      createdAt: 100,
      updatedAt: 200,
    };
    const updateEntry = vi.fn().mockResolvedValue({
      ...upserted,
      definition: 'a greeting',
    });
    const service = {
      upsertEntry: vi.fn().mockResolvedValue(upserted),
      updateEntry,
    };

    await useDictionaryStore
      .getState()
      .addEntry(
        { term: 'hello', definition: 'a greeting', language: 'en' },
        asDictionaryService(service),
      );

    expect(updateEntry).toHaveBeenCalledTimes(1);
    expect(updateEntry).toHaveBeenCalledWith({
      id: 'entry-needs-update',
      definition: 'a greeting',
    });
  });

  // ---- console.error on failure ----

  it('loadEntries logs error via console.error with [dictionaryStore] prefix', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('DB connection lost');
    const service = { listEntries: vi.fn().mockRejectedValue(err) };

    await useDictionaryStore.getState().loadEntries(asDictionaryService(service));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const callArg = errorSpy.mock.calls[0]!;
    expect(callArg[0]).toContain('[dictionaryStore]');
    expect(callArg[1]).toBe(err);
    errorSpy.mockRestore();
  });

  it('searchEntries logs error via console.error with [dictionaryStore] prefix', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('Query failure');
    const service = { searchEntries: vi.fn().mockRejectedValue(err) };

    await useDictionaryStore.getState().searchEntries('test', asDictionaryService(service));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toContain('[dictionaryStore]');
    errorSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // D4: Tombstone consistency — state includes deleted, visible hides them
  // ---------------------------------------------------------------------------

  it('loadEntries includes soft-deleted entries in state', async () => {
    const mockService = {
      listEntries: vi.fn().mockResolvedValue([
        {
          id: 'entry-active',
          term: 'active',
          displayTerm: 'active',
          language: 'en',
          definition: undefined,
          enrichmentStatus: 'none',
          imagePath: undefined,
          curiosity: undefined,
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: 'entry-deleted',
          term: 'deleted',
          displayTerm: 'deleted',
          language: 'en',
          definition: undefined,
          enrichmentStatus: 'none',
          imagePath: undefined,
          curiosity: undefined,
          createdAt: 200,
          updatedAt: 200,
          deletedAt: 300,
        },
      ]),
    };

    await useDictionaryStore.getState().loadEntries(asDictionaryService(mockService));

    const state = useDictionaryStore.getState();
    expect(state.entries).toHaveLength(2);
    const deleted = state.entries.find((e) => e.id === 'entry-deleted');
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBe(300);
  });

  it('getAllReplicas includes tombstone entries and occurrences', () => {
    useDictionaryStore.setState({
      entries: [
        {
          id: 'entry-active',
          term: 'active',
          displayTerm: 'active',
          language: 'en',
          enrichmentStatus: 'none',
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: 'entry-deleted',
          term: 'deleted',
          displayTerm: 'deleted',
          language: 'en',
          enrichmentStatus: 'none',
          createdAt: 200,
          updatedAt: 200,
          deletedAt: 300,
        },
      ],
      occurrencesByEntryId: {
        'entry-active': [
          {
            id: 'occ-active',
            entryId: 'entry-active',
            bookHash: 'hash-1',
            cfi: '/6/2',
            selectedText: 'active occ',
            createdAt: 150,
          },
        ],
        'entry-deleted': [
          {
            id: 'occ-deleted',
            entryId: 'entry-deleted',
            bookHash: 'hash-1',
            cfi: '/6/3',
            selectedText: 'deleted occ',
            createdAt: 250,
            deletedAt: 350,
          },
        ],
      },
    });

    const replicas = useDictionaryStore.getState().getAllReplicas(DEVICE_ID);
    // 2 entries + 2 occurrences = 4 rows
    expect(replicas).toHaveLength(4);
    const entryTombstone = replicas.find((r) => r.replica_id === 'dictionary-entry:entry-deleted');
    expect(entryTombstone).toBeDefined();
    expect(entryTombstone?.deleted_at_ts).not.toBeNull();
    const occTombstone = replicas.find((r) => r.replica_id === 'dictionary-occurrence:occ-deleted');
    expect(occTombstone).toBeDefined();
    expect(occTombstone?.deleted_at_ts).not.toBeNull();
  });

  it('getVisibleDictionaryEntries excludes soft-deleted entries', () => {
    useDictionaryStore.setState({
      entries: [
        {
          id: 'entry-active',
          term: 'active',
          displayTerm: 'active',
          language: 'en',
          enrichmentStatus: 'none',
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: 'entry-deleted',
          term: 'deleted',
          displayTerm: 'deleted',
          language: 'en',
          enrichmentStatus: 'none',
          createdAt: 200,
          updatedAt: 200,
          deletedAt: 300,
        },
      ],
    });

    const visible = useDictionaryStore.getState().getVisibleDictionaryEntries();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe('entry-active');
  });

  it('getVisibleOccurrences excludes soft-deleted occurrences', () => {
    useDictionaryStore.setState({
      entries: [],
      occurrencesByEntryId: {
        'entry-1': [
          {
            id: 'occ-active',
            entryId: 'entry-1',
            bookHash: 'hash-1',
            cfi: '/6/2',
            selectedText: 'active',
            createdAt: 100,
          },
          {
            id: 'occ-deleted',
            entryId: 'entry-1',
            bookHash: 'hash-1',
            cfi: '/6/3',
            selectedText: 'deleted',
            createdAt: 200,
            deletedAt: 300,
          },
        ],
      },
    });

    const visible = useDictionaryStore.getState().getVisibleOccurrences('entry-1');
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe('occ-active');
  });

  it('applyRemoteDictionaryOccurrence tombstone sets deletedAt instead of hard-removing', () => {
    // Seed an occurrence
    const seedRow: ReplicaRow = {
      user_id: '',
      kind: 'dictionary-occurrence',
      replica_id: 'dictionary-occurrence:occ-tomb',
      fields_jsonb: {
        entryId: { v: 'entry-1', t: NEW_HLC, s: DEVICE_ID },
        bookHash: { v: 'hash-1', t: NEW_HLC, s: DEVICE_ID },
        cfi: { v: '/6/2', t: NEW_HLC, s: DEVICE_ID },
        selectedText: { v: 'test', t: NEW_HLC, s: DEVICE_ID },
      },
      manifest_jsonb: null,
      deleted_at_ts: null,
      reincarnation: null,
      updated_at_ts: NEW_HLC,
      schema_version: 1,
    };
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(seedRow);

    // Tombstone
    const tombRow: ReplicaRow = {
      ...seedRow,
      deleted_at_ts: NEW_HLC,
      fields_jsonb: {
        entryId: { v: 'entry-1', t: NEW_HLC, s: DEVICE_ID },
      },
    };
    useDictionaryStore.getState().applyRemoteDictionaryOccurrence(tombRow);

    const state = useDictionaryStore.getState();
    const occs = state.occurrencesByEntryId['entry-1'] ?? [];
    // Should still be in the array (not hard-removed)
    expect(occs).toHaveLength(1);
    expect(occs[0]?.id).toBe('occ-tomb');
    expect(occs[0]?.deletedAt).toBeDefined();
  });
});
