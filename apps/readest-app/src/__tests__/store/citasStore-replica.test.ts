import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCitasStore } from '@/store/citasStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ReplicaRow, FieldEnvelope, Hlc } from '@/types/replica';
import type { CitasService } from '@/services/citas/CitasService';

// ---------------------------------------------------------------------------
// Mocks for fire-and-forget persistence
// ---------------------------------------------------------------------------

const mockBulkUpsertQuotes = vi.fn().mockResolvedValue(undefined);
const mockGetCitasService = vi.fn().mockResolvedValue({
  bulkUpsertQuotes: mockBulkUpsertQuotes,
});

vi.mock('@/services/citas/citasServiceCache', () => ({
  getCitasService: (...args: unknown[]) => mockGetCitasService(...args),
}));

const mockGetAppService = vi.fn().mockResolvedValue('mock-app-service');
vi.mock('@/services/environment', () => ({
  default: { getAppService: (...args: unknown[]) => mockGetAppService(...args) },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DEVICE_ID = 'test-device-bbbb';
const OLD_HLC = '0000000000001-00000001-test-device-bbbb' as Hlc;
const NEW_HLC = '0000000000002-00000001-test-device-bbbb' as Hlc;
const NEWER_HLC = '0000000000003-00000001-test-device-bbbb' as Hlc;

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

  it('applyRemoteQuote with deleted_at_ts on a NON-EXISTENT id retains a tombstone', () => {
    const tombstoneRow = makeQuoteRow({
      id: 'cite-never-existed',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });

    expect(() => useCitasStore.getState().applyRemoteQuote(tombstoneRow)).not.toThrow();

    const quotes = useCitasStore.getState().quotes;
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.id).toBe('cite-never-existed');
    expect(quotes[0]?.deletedAt).toBeDefined();
    expect(quotes[0]?._replicaTimestamps?.['__deleted']).toBe(NEW_HLC);
  });

  it('applyRemoteQuote keeps a newer tombstone when a stale live row arrives', () => {
    useCitasStore
      .getState()
      .applyRemoteQuote(
        makeQuoteRow({ id: 'cite-delete-wins', hlc: NEW_HLC, fields: {}, deleted: true }),
      );

    useCitasStore.getState().applyRemoteQuote(
      makeQuoteRow({
        id: 'cite-delete-wins',
        hlc: OLD_HLC,
        fields: { text: 'stale quote', contextBefore: 'stale context', bookHash: 'stale-hash' },
      }),
    );

    const quote = useCitasStore.getState().quotes[0]!;
    expect(quote.deletedAt).toBeDefined();
    expect(quote.text).toBe('');
    expect(quote.contextBefore).toBeNull();
    expect(quote.bookHash).toBe('');
  });

  it('applyRemoteQuote ignores an older tombstone when newer live fields exist', () => {
    useCitasStore.getState().applyRemoteQuote(
      makeQuoteRow({
        id: 'cite-live-wins',
        hlc: NEWER_HLC,
        fields: { text: 'newer quote', contextBefore: 'newer context', bookHash: 'hash-live' },
      }),
    );

    useCitasStore
      .getState()
      .applyRemoteQuote(
        makeQuoteRow({ id: 'cite-live-wins', hlc: NEW_HLC, fields: {}, deleted: true }),
      );

    const quote = useCitasStore.getState().quotes[0]!;
    expect(quote.deletedAt).toBeUndefined();
    expect(quote.text).toBe('newer quote');
    expect(quote.contextBefore).toBe('newer context');
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

  // ---------------------------------------------------------------------------
  // D2: persist-after-apply wiring
  // ---------------------------------------------------------------------------

  it('applyRemoteQuote persists NEW quote to SQLite via bulkUpsertQuotes', async () => {
    mockBulkUpsertQuotes.mockClear();
    mockGetAppService.mockClear();
    mockGetCitasService.mockClear();

    const row = makeQuoteRow({
      id: 'cite-persist-1',
      hlc: NEW_HLC,
      fields: {
        bookHash: 'hash-q1',
        bookTitle: 'Persist Book',
        bookAuthor: 'Persist Author',
        cfi: '/6/4',
        page: 10,
        text: 'A beautiful passage',
        contextBefore: 'Once upon a time,',
        contextAfter: 'and they lived happily.',
        contentHash: 'abc123',
      },
    });

    useCitasStore.getState().applyRemoteQuote(row);

    await vi.waitFor(() => expect(mockBulkUpsertQuotes).toHaveBeenCalledTimes(1));

    expect(mockGetAppService).toHaveBeenCalledTimes(1);
    expect(mockGetCitasService).toHaveBeenCalledWith('mock-app-service');

    const persistedQuotes = mockBulkUpsertQuotes.mock.calls[0]![0];
    expect(persistedQuotes).toHaveLength(1);
    expect(persistedQuotes[0].id).toBe('cite-persist-1');
    expect(persistedQuotes[0].text).toBe('A beautiful passage');
  });

  it('applyRemoteQuote persists MERGED quote to SQLite', async () => {
    mockBulkUpsertQuotes.mockClear();

    const localRow = makeQuoteRow({
      id: 'cite-merge-persist',
      hlc: OLD_HLC,
      fields: { text: 'old text', bookHash: 'hash-a', contextBefore: null },
    });
    useCitasStore.getState().applyRemoteQuote(localRow);
    // Wait for seed's fire-and-forget to complete, then clear
    await vi.waitFor(() => expect(mockBulkUpsertQuotes).toHaveBeenCalledTimes(1));
    mockBulkUpsertQuotes.mockClear();

    const remoteRow = makeQuoteRow({
      id: 'cite-merge-persist',
      hlc: NEW_HLC,
      fields: { text: 'old text', bookHash: 'hash-a', contextBefore: 'Now with context' },
    });
    useCitasStore.getState().applyRemoteQuote(remoteRow);

    await vi.waitFor(() => expect(mockBulkUpsertQuotes).toHaveBeenCalledTimes(1));

    const persistedQuotes = mockBulkUpsertQuotes.mock.calls[0]![0];
    expect(persistedQuotes).toHaveLength(1);
    expect(persistedQuotes[0].id).toBe('cite-merge-persist');
    expect(persistedQuotes[0].contextBefore).toBe('Now with context');
  });

  it('applyRemoteQuote persists SOFT-DELETED quote to SQLite', async () => {
    mockBulkUpsertQuotes.mockClear();

    const localRow = makeQuoteRow({
      id: 'cite-del-persist',
      hlc: OLD_HLC,
      fields: { text: 'will be deleted', bookHash: 'hash-d' },
    });
    useCitasStore.getState().applyRemoteQuote(localRow);
    // Wait for seed's fire-and-forget to complete, then clear
    await vi.waitFor(() => expect(mockBulkUpsertQuotes).toHaveBeenCalledTimes(1));
    mockBulkUpsertQuotes.mockClear();

    const tombstoneRow = makeQuoteRow({
      id: 'cite-del-persist',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });
    useCitasStore.getState().applyRemoteQuote(tombstoneRow);

    await vi.waitFor(() => expect(mockBulkUpsertQuotes).toHaveBeenCalledTimes(1));

    const persistedQuotes = mockBulkUpsertQuotes.mock.calls[0]![0];
    expect(persistedQuotes).toHaveLength(1);
    expect(persistedQuotes[0].id).toBe('cite-del-persist');
    expect(persistedQuotes[0].deletedAt).toBeDefined();
  });

  it('applyRemoteQuote does NOT persist when no change (older HLC)', async () => {
    mockBulkUpsertQuotes.mockClear();

    const localRow = makeQuoteRow({
      id: 'cite-nochange',
      hlc: NEW_HLC,
      fields: { text: 'newer text', bookHash: 'hash-a' },
    });
    useCitasStore.getState().applyRemoteQuote(localRow);
    // Wait for seed's fire-and-forget to complete, then clear
    await vi.waitFor(() => expect(mockBulkUpsertQuotes).toHaveBeenCalledTimes(1));
    mockBulkUpsertQuotes.mockClear();

    const remoteRow = makeQuoteRow({
      id: 'cite-nochange',
      hlc: OLD_HLC,
      fields: { text: 'STALE text', bookHash: 'hash-a' },
    });
    useCitasStore.getState().applyRemoteQuote(remoteRow);

    await new Promise((r) => setTimeout(r, 50));
    expect(mockBulkUpsertQuotes).not.toHaveBeenCalled();
  });

  it('applyRemoteQuote persists tombstone for non-existent id', async () => {
    mockBulkUpsertQuotes.mockClear();

    const tombstoneRow = makeQuoteRow({
      id: 'cite-ghost-persist',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });
    useCitasStore.getState().applyRemoteQuote(tombstoneRow);

    await vi.waitFor(() => expect(mockBulkUpsertQuotes).toHaveBeenCalledTimes(1));
    const persistedQuotes = mockBulkUpsertQuotes.mock.calls[0]![0];
    expect(persistedQuotes).toHaveLength(1);
    expect(persistedQuotes[0].id).toBe('cite-ghost-persist');
    expect(persistedQuotes[0].deletedAt).toBeDefined();
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

    const stored = useCitasStore.getState().quotes[0]!;
    expect(stored._replicaTimestamps).toEqual({
      bookHash: outbox[0]!.fields_jsonb['bookHash']!.t,
      bookTitle: outbox[0]!.fields_jsonb['bookTitle']!.t,
      bookAuthor: outbox[0]!.fields_jsonb['bookAuthor']!.t,
      cfi: outbox[0]!.fields_jsonb['cfi']!.t,
      sectionHref: outbox[0]!.fields_jsonb['sectionHref']!.t,
      page: outbox[0]!.fields_jsonb['page']!.t,
      text: outbox[0]!.fields_jsonb['text']!.t,
      contextBefore: outbox[0]!.fields_jsonb['contextBefore']!.t,
      contextAfter: outbox[0]!.fields_jsonb['contextAfter']!.t,
      contentHash: outbox[0]!.fields_jsonb['contentHash']!.t,
    });
  });

  it('updateQuote stores per-field replica timestamps from the minted ReplicaRow', async () => {
    useCitasStore.getState().setQuotes([
      {
        id: 'cite-update-1',
        bookHash: 'hash-1',
        bookTitle: 'Test',
        bookAuthor: null,
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'before',
        contextBefore: null,
        contextAfter: null,
        contentHash: 'hash-before',
        createdAt: 100,
        updatedAt: null,
      },
    ]);
    const updated = {
      ...useCitasStore.getState().quotes[0]!,
      text: 'after',
      contentHash: 'hash-after',
      updatedAt: 200,
    };
    const service = { updateQuote: vi.fn().mockResolvedValue(updated) };

    await useCitasStore
      .getState()
      .updateQuote({ id: 'cite-update-1', text: 'after' }, asCitasService(service));

    const outbox = useCitasStore.getState().replicaOutbox;
    const stored = useCitasStore.getState().quotes[0]!;
    expect(stored._replicaTimestamps?.['text']).toBe(outbox[0]!.fields_jsonb['text']!.t);
    expect(stored._replicaTimestamps?.['contentHash']).toBe(
      outbox[0]!.fields_jsonb['contentHash']!.t,
    );
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

  // ---------------------------------------------------------------------------
  // D4: Tombstone consistency — state includes deleted, visible hides them
  // ---------------------------------------------------------------------------

  it('loadQuotes includes soft-deleted quotes in state', async () => {
    const mockService = {
      listQuotes: vi.fn().mockResolvedValue([
        {
          id: 'quote-active',
          bookHash: 'hash-1',
          bookTitle: null,
          bookAuthor: null,
          cfi: null,
          sectionHref: null,
          page: null,
          text: 'active quote',
          contextBefore: null,
          contextAfter: null,
          contentHash: 'hash-a',
          createdAt: 100,
          updatedAt: null,
        },
        {
          id: 'quote-deleted',
          bookHash: 'hash-1',
          bookTitle: null,
          bookAuthor: null,
          cfi: null,
          sectionHref: null,
          page: null,
          text: 'deleted quote',
          contextBefore: null,
          contextAfter: null,
          contentHash: 'hash-b',
          createdAt: 200,
          updatedAt: null,
          deletedAt: 300,
        },
      ]),
    };

    await useCitasStore.getState().loadQuotes(asCitasService(mockService));

    const state = useCitasStore.getState();
    expect(state.quotes).toHaveLength(2);
    const deleted = state.quotes.find((q) => q.id === 'quote-deleted');
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBe(300);
  });

  it('getAllReplicas includes tombstone quotes', () => {
    useCitasStore.setState({
      quotes: [
        {
          id: 'quote-active',
          bookHash: 'hash-1',
          bookTitle: null,
          bookAuthor: null,
          cfi: null,
          sectionHref: null,
          page: null,
          text: 'active',
          contextBefore: null,
          contextAfter: null,
          contentHash: 'hash-a',
          createdAt: 100,
          updatedAt: null,
        },
        {
          id: 'quote-deleted',
          bookHash: 'hash-1',
          bookTitle: null,
          bookAuthor: null,
          cfi: null,
          sectionHref: null,
          page: null,
          text: 'deleted',
          contextBefore: null,
          contextAfter: null,
          contentHash: 'hash-b',
          createdAt: 200,
          updatedAt: null,
          deletedAt: 300,
        },
      ],
    });

    const replicas = useCitasStore.getState().getAllReplicas(DEVICE_ID);
    expect(replicas).toHaveLength(2);
    const tombstone = replicas.find((r) => r.replica_id === 'quote:quote-deleted');
    expect(tombstone).toBeDefined();
    expect(tombstone?.deleted_at_ts).not.toBeNull();
  });

  it('getVisibleQuotes excludes soft-deleted quotes', () => {
    useCitasStore.setState({
      quotes: [
        {
          id: 'quote-active',
          bookHash: 'hash-1',
          bookTitle: null,
          bookAuthor: null,
          cfi: null,
          sectionHref: null,
          page: null,
          text: 'active',
          contextBefore: null,
          contextAfter: null,
          contentHash: 'hash-a',
          createdAt: 100,
          updatedAt: null,
        },
        {
          id: 'quote-deleted',
          bookHash: 'hash-1',
          bookTitle: null,
          bookAuthor: null,
          cfi: null,
          sectionHref: null,
          page: null,
          text: 'deleted',
          contextBefore: null,
          contextAfter: null,
          contentHash: 'hash-b',
          createdAt: 200,
          updatedAt: null,
          deletedAt: 300,
        },
      ],
    });

    const visible = useCitasStore.getState().getVisibleQuotes();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe('quote-active');
  });

  // ---------------------------------------------------------------------------
  // Post-PR5: tombstone coverage gaps
  // ---------------------------------------------------------------------------

  it('unknown tombstone for a never-seen quote id creates a tombstone entity with template defaults', () => {
    const tombstone = makeQuoteRow({
      id: 'never-seen',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });

    useCitasStore.getState().applyRemoteQuote(tombstone);

    const state = useCitasStore.getState();
    expect(state.quotes).toHaveLength(1);
    const q = state.quotes[0]!;
    expect(q.id).toBe('never-seen');
    expect(q.deletedAt).toBeDefined();
    // Verify tombstone template defaults are empty/cleared
    expect(q.text).toBe('');
    expect(q.bookHash).toBe('');
    expect(q.contextBefore).toBeNull();
    expect(q.contextAfter).toBeNull();
    expect(q._replicaTimestamps?.['__deleted']).toBe(NEW_HLC);
  });

  it('stale live quote loses to a newer tombstone and is marked deleted (fields preserved by tombstone spread)', () => {
    // Apply live quote first
    useCitasStore.getState().applyRemoteQuote(
      makeQuoteRow({
        id: 'stale-live',
        hlc: OLD_HLC,
        fields: {
          text: 'old passage',
          bookHash: 'hash-old',
          contextBefore: 'old context',
        },
      }),
    );

    // Then apply a newer tombstone — production code does {...existing, deletedAt}
    useCitasStore.getState().applyRemoteQuote(
      makeQuoteRow({
        id: 'stale-live',
        hlc: NEW_HLC,
        fields: {},
        deleted: true,
      }),
    );

    const q = useCitasStore.getState().quotes[0]!;
    expect(q.deletedAt).toBeDefined();
    // Tombstone spreads existing fields (does NOT clear them on an existing quote)
    expect(q.text).toBe('old passage');
    expect(q._replicaTimestamps?.['__deleted']).toBe(NEW_HLC);
  });

  it('newer live row resurrects a previously deleted quote', () => {
    // First apply a tombstone
    useCitasStore.getState().applyRemoteQuote(
      makeQuoteRow({
        id: 'resurrect-me',
        hlc: OLD_HLC,
        fields: {},
        deleted: true,
      }),
    );

    // Then apply a newer live row
    useCitasStore.getState().applyRemoteQuote(
      makeQuoteRow({
        id: 'resurrect-me',
        hlc: NEWER_HLC,
        fields: {
          text: 'resurrected text',
          bookHash: 'hash-new',
          contextBefore: 'new context',
        },
      }),
    );

    const q = useCitasStore.getState().quotes[0]!;
    expect(q.deletedAt).toBeUndefined();
    expect(q.text).toBe('resurrected text');
    expect(q.bookHash).toBe('hash-new');
    expect(q._replicaTimestamps?.['__deleted']).toBeUndefined();
  });

  it('re-applying the same unknown tombstone persists twice without duplication', async () => {
    mockBulkUpsertQuotes.mockClear();

    const tombstone = makeQuoteRow({
      id: 'double-persist',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });

    // First apply — creates tombstone + persists
    useCitasStore.getState().applyRemoteQuote(tombstone);
    await vi.waitFor(() => expect(mockBulkUpsertQuotes).toHaveBeenCalledTimes(1));

    expect(useCitasStore.getState().quotes).toHaveLength(1);

    mockBulkUpsertQuotes.mockClear();

    // Second apply — same tombstone, no state duplication, still persists
    useCitasStore.getState().applyRemoteQuote(tombstone);
    await vi.waitFor(() => expect(mockBulkUpsertQuotes).toHaveBeenCalledTimes(1));

    const state = useCitasStore.getState();
    expect(state.quotes).toHaveLength(1); // No duplication
    expect(state.quotes[0]!.deletedAt).toBeDefined();
  });
});
