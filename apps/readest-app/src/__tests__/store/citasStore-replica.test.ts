import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCitasStore } from '@/store/citasStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ReplicaRow, FieldEnvelope, Hlc } from '@/types/replica';
import type { CitasService } from '@/services/citas/CitasService';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DEVICE_ID = 'test-device-bbbb';
const OLD_HLC = '0000000000001-00000001-test-device-bbbb' as Hlc;
const NEW_HLC = '0000000000002-00000001-test-device-bbbb' as Hlc;

function makeQuoteRow(params: {
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
    kind: 'quote',
    replica_id: `quote:${params.id}`,
    fields_jsonb,
    manifest_jsonb: null,
    deleted_at_ts: params.deleted ? params.hlc : null,
    reincarnation: null,
    updated_at_ts: params.hlc,
    schema_version: 1,
  };
}

function asCitasService(service: Partial<CitasService>): CitasService {
  return service as CitasService;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('citasStore — replica applyRemoteQuote', () => {
  beforeEach(() => {
    const cur = useSettingsStore.getState().settings;
    useSettingsStore.getState().setSettings({
      ...cur,
      replicaDeviceId: DEVICE_ID,
    });
  });

  afterEach(() => {
    useCitasStore.getState().reset();
  });

  // ---- applyRemoteQuote — insert / merge / delete ----

  it('applyRemoteQuote inserts a NEW quote from a ReplicaRow', () => {
    const row = makeQuoteRow({
      id: 'cite-remote-1',
      hlc: NEW_HLC,
      fields: {
        bookHash: 'hash-q1',
        bookTitle: 'Remote Book',
        bookAuthor: 'Remote Author',
        cfi: '/6/4',
        page: 10,
        text: 'A beautiful passage',
        contextBefore: 'Once upon a time,',
        contextAfter: 'and they lived happily.',
        contentHash: 'abc123',
      },
    });

    useCitasStore.getState().applyRemoteQuote(row);

    const state = useCitasStore.getState();
    expect(state.quotes).toHaveLength(1);
    const q = state.quotes[0]!;
    expect(q.id).toBe('cite-remote-1');
    expect(q.text).toBe('A beautiful passage');
    expect(q.bookHash).toBe('hash-q1');
    expect(q.deletedAt).toBeUndefined();
  });

  it('applyRemoteQuote merges fields with NEWER HLC into an existing quote', () => {
    const localRow = makeQuoteRow({
      id: 'cite-exist',
      hlc: OLD_HLC,
      fields: { text: 'old text', bookHash: 'hash-a', contextBefore: null },
    });
    useCitasStore.getState().applyRemoteQuote(localRow);

    const remoteRow = makeQuoteRow({
      id: 'cite-exist',
      hlc: NEW_HLC,
      fields: { text: 'old text', bookHash: 'hash-a', contextBefore: 'Now with context' },
    });
    useCitasStore.getState().applyRemoteQuote(remoteRow);

    const q = useCitasStore.getState().quotes[0]!;
    expect(q.contextBefore).toBe('Now with context');
    expect(q.text).toBe('old text');
    expect(useCitasStore.getState().quotes).toHaveLength(1);
  });

  it('applyRemoteQuote with OLDER HLC does NOT overwrite newer local fields', () => {
    const localRow = makeQuoteRow({
      id: 'cite-exist',
      hlc: NEW_HLC,
      fields: { text: 'newer text', bookHash: 'hash-a' },
    });
    useCitasStore.getState().applyRemoteQuote(localRow);

    const remoteRow = makeQuoteRow({
      id: 'cite-exist',
      hlc: OLD_HLC,
      fields: { text: 'STALE text', bookHash: 'hash-a' },
    });
    useCitasStore.getState().applyRemoteQuote(remoteRow);

    const q = useCitasStore.getState().quotes[0]!;
    expect(q.text).toBe('newer text');
  });

  it('applyRemoteQuote with deleted_at_ts soft-deletes the matching quote', () => {
    const localRow = makeQuoteRow({
      id: 'cite-to-del',
      hlc: OLD_HLC,
      fields: { text: 'will be deleted' },
    });
    useCitasStore.getState().applyRemoteQuote(localRow);

    const tombstoneRow = makeQuoteRow({
      id: 'cite-to-del',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });

    useCitasStore.getState().applyRemoteQuote(tombstoneRow);

    const q = useCitasStore.getState().quotes[0]!;
    expect(q.deletedAt).toBeDefined();
    expect(typeof q.deletedAt).toBe('number');
  });

  it('applyRemoteQuote with deleted_at_ts on a NON-EXISTENT id does not crash', () => {
    const tombstoneRow = makeQuoteRow({
      id: 'cite-never-existed',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });

    expect(() => useCitasStore.getState().applyRemoteQuote(tombstoneRow)).not.toThrow();

    expect(useCitasStore.getState().quotes).toHaveLength(0);
  });

  // ---- per-field HLC ----

  it('applyRemoteQuote updates ONLY fields whose remote HLC is newer (per-field LWW)', () => {
    const baseRow = makeQuoteRow({
      id: 'cite-fields',
      hlc: OLD_HLC,
      fields: { text: 'text-v1', contextBefore: 'ctx-v1', page: 5 },
    });
    useCitasStore.getState().applyRemoteQuote(baseRow);

    const mixedRow: ReplicaRow = {
      user_id: '',
      kind: 'quote',
      replica_id: 'quote:cite-fields',
      fields_jsonb: {
        text: { v: 'text-v1', t: OLD_HLC, s: DEVICE_ID },
        contextBefore: {
          v: 'ctx-V2',
          t: '0000000000003-00000001-test-device-bbbb' as Hlc,
          s: DEVICE_ID,
        },
        page: { v: 42, t: '0000000000003-00000001-test-device-bbbb' as Hlc, s: DEVICE_ID },
      },
      manifest_jsonb: null,
      deleted_at_ts: null,
      reincarnation: null,
      updated_at_ts: '0000000000003-00000001-test-device-bbbb' as Hlc,
      schema_version: 1,
    };
    useCitasStore.getState().applyRemoteQuote(mixedRow);

    const q = useCitasStore.getState().quotes[0]!;
    expect(q.text).toBe('text-v1'); // OLD HLC → no change
    expect(q.contextBefore).toBe('ctx-V2'); // NEWER → updated
    expect(q.page).toBe(42); // NEWER → updated
  });

  // ---- replicaOutbox ----

  it('replicaOutbox starts empty', () => {
    expect(useCitasStore.getState().replicaOutbox).toEqual([]);
  });

  it('createQuote pushes a ReplicaRow to the outbox', async () => {
    const created = {
      id: 'cite-outbox-1',
      bookHash: 'hash-1',
      bookTitle: 'Test',
      bookAuthor: 'Author',
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'outbox test',
      contextBefore: null,
      contextAfter: null,
      contentHash: 'hash-abc',
      createdAt: 100,
      updatedAt: null,
    };
    const service = { createQuote: vi.fn().mockResolvedValue(created) };

    await useCitasStore.getState().createQuote(
      {
        bookHash: 'hash-1',
        bookTitle: 'Test',
        bookAuthor: 'Author',
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'outbox test',
        contextBefore: null,
        contextAfter: null,
      },
      asCitasService(service),
    );

    const outbox = useCitasStore.getState().replicaOutbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.kind).toBe('quote');
    expect(outbox[0]!.replica_id).toBe('quote:cite-outbox-1');
    expect(outbox[0]!.deleted_at_ts).toBeNull();
  });

  it('deleteQuotes pushes a tombstone ReplicaRow to the outbox', async () => {
    useCitasStore.getState().setQuotes([
      {
        id: 'cite-del-1',
        bookHash: 'hash-1',
        bookTitle: 'Test',
        bookAuthor: null,
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'to delete',
        contextBefore: null,
        contextAfter: null,
        contentHash: 'hash-abc',
        createdAt: 100,
        updatedAt: null,
      },
    ]);

    const service = { deleteQuotes: vi.fn().mockResolvedValue(undefined) };

    await useCitasStore.getState().deleteQuotes(['cite-del-1'], asCitasService(service));

    const outbox = useCitasStore.getState().replicaOutbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.kind).toBe('quote');
    expect(outbox[0]!.replica_id).toBe('quote:cite-del-1');
    expect(outbox[0]!.deleted_at_ts).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // R5: Merge CRDT idempotente — aplicar la misma réplica dos veces no duplica
  // ---------------------------------------------------------------------------

  it('aplicar la misma réplica dos veces no duplica la entrada (R5)', () => {
    const row = makeQuoteRow({
      id: 'cite-idem-1',
      hlc: NEW_HLC,
      fields: {
        bookHash: 'hash-idem',
        bookTitle: 'Idempotent Book',
        bookAuthor: 'Idempotent Author',
        cfi: '/6/4',
        page: 12,
        text: 'Cita que no debe duplicarse',
        contextBefore: 'Érase una vez,',
        contextAfter: 'en un lugar lejano.',
        contentHash: 'abc123',
      },
    });

    useCitasStore.getState().applyRemoteQuote(row);
    useCitasStore.getState().applyRemoteQuote(row);

    const state = useCitasStore.getState();
    expect(state.quotes).toHaveLength(1);
    expect(state.quotes[0]!.text).toBe('Cita que no debe duplicarse');
  });

  it('aplicar la misma réplica tras merge no modifica los datos ni duplica (R5, triangulación)', () => {
    const row = makeQuoteRow({
      id: 'cite-idem-2',
      hlc: NEW_HLC,
      fields: {
        bookHash: 'hash-idem2',
        bookTitle: 'Triangulation Book',
        text: 'original quote text',
        contextBefore: null,
        contextAfter: null,
        contentHash: 'def456',
      },
    });

    useCitasStore.getState().applyRemoteQuote(row);
    useCitasStore.getState().applyRemoteQuote(row);

    const state = useCitasStore.getState();
    expect(state.quotes).toHaveLength(1);
    const q = state.quotes[0]!;
    expect(q.text).toBe('original quote text');
    expect(q.bookHash).toBe('hash-idem2');
  });

  it('outbox entries have monotonic HLCs across multiple mutations', async () => {
    const created1 = {
      id: 'cite-hlc-1',
      bookHash: 'hash-1',
      bookTitle: 'Test',
      bookAuthor: 'Author',
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'first',
      contextBefore: null,
      contextAfter: null,
      contentHash: 'h1',
      createdAt: 100,
      updatedAt: null,
    };
    const created2 = {
      id: 'cite-hlc-2',
      bookHash: 'hash-1',
      bookTitle: 'Test',
      bookAuthor: 'Author',
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'second',
      contextBefore: null,
      contextAfter: null,
      contentHash: 'h2',
      createdAt: 101,
      updatedAt: null,
    };
    const service = {
      createQuote: vi.fn().mockResolvedValueOnce(created1).mockResolvedValueOnce(created2),
    };

    await useCitasStore.getState().createQuote(
      {
        bookHash: 'hash-1',
        bookTitle: 'Test',
        bookAuthor: 'Author',
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'first',
        contextBefore: null,
        contextAfter: null,
      },
      asCitasService(service),
    );

    await useCitasStore.getState().createQuote(
      {
        bookHash: 'hash-1',
        bookTitle: 'Test',
        bookAuthor: 'Author',
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'second',
        contextBefore: null,
        contextAfter: null,
      },
      asCitasService(service),
    );

    const outbox = useCitasStore.getState().replicaOutbox;
    expect(outbox).toHaveLength(2);

    const hlc1 = outbox[0]!.updated_at_ts as string;
    const hlc2 = outbox[1]!.updated_at_ts as string;
    expect(hlc1 < hlc2).toBe(true);
  });
});
