import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDictionaryStore } from '@/store/dictionaryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ReplicaRow, FieldEnvelope, Hlc } from '@/types/replica';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DEVICE_ID = 'test-device-cccc';
const OLD_HLC = '0000000000001-00000001-test-device-cccc' as Hlc;
const NEW_HLC = '0000000000002-00000001-test-device-cccc' as Hlc;

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

  it('applyRemoteDictionaryEntry tombstone on non-existent id does not crash', () => {
    const tombstoneRow = makeEntryRow({
      id: 'entry-ghost',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });

    expect(() =>
      useDictionaryStore.getState().applyRemoteDictionaryEntry(tombstoneRow),
    ).not.toThrow();

    expect(useDictionaryStore.getState().entries).toHaveLength(0);
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

  it('applyRemoteDictionaryOccurrence with deleted_at_ts removes the occurrence', () => {
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

    // Occurrence is removed from the map
    const occs = useDictionaryStore.getState().occurrencesByEntryId['entry-1'];
    expect(occs).toHaveLength(0);
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
});
