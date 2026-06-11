import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ReplicaRow, FieldEnvelope, Hlc } from '@/types/replica';
import type { AnotacionesService } from '@/services/annotations/AnotacionesService';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DEVICE_ID = 'test-device-aaaa';
const OLD_HLC = '0000000000001-00000001-test-device-aaaa' as Hlc;
const NEW_HLC = '0000000000002-00000001-test-device-aaaa' as Hlc;

/**
 * Build a synthetic ReplicaRow for testing applyRemoteAnnotation.
 */
function makeAnnotationRow(params: {
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
    kind: 'annotation',
    replica_id: `annotation:${params.id}`,
    fields_jsonb,
    manifest_jsonb: null,
    deleted_at_ts: params.deleted ? params.hlc : null,
    reincarnation: null,
    updated_at_ts: params.hlc,
    schema_version: 1,
  };
}

function asAnotacionesService(service: Partial<AnotacionesService>): AnotacionesService {
  return service as AnotacionesService;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('annotacionesStore — replica applyRemoteAnnotation', () => {
  beforeEach(() => {
    // Ensure settings store carries a replicaDeviceId so the store can mint HLCs.
    const cur = useSettingsStore.getState().settings;
    useSettingsStore.getState().setSettings({
      ...cur,
      replicaDeviceId: DEVICE_ID,
    });
  });

  afterEach(() => {
    useAnotacionesStore.getState().reset();
  });

  // ---------------------------------------------------------------------------
  // applyRemoteAnnotation — insert / merge / delete
  // ---------------------------------------------------------------------------

  it('applyRemoteAnnotation inserts a NEW annotation from a ReplicaRow', () => {
    const row = makeAnnotationRow({
      id: 'annot-remote-1',
      hlc: NEW_HLC,
      fields: {
        bookHash: 'hash-remote',
        bookTitle: 'Remote Book',
        bookAuthor: 'Remote Author',
        cfi: '/6/4',
        page: 42,
        text: 'Remote text content',
        note: 'Remote note',
        style: 'underline',
        color: 'red',
      },
    });

    useAnotacionesStore.getState().applyRemoteAnnotation(row);

    const state = useAnotacionesStore.getState();
    expect(state.annotations).toHaveLength(1);

    const ann = state.annotations[0]!;
    expect(ann.id).toBe('annot-remote-1');
    expect(ann.bookHash).toBe('hash-remote');
    expect(ann.text).toBe('Remote text content');
    expect(ann.note).toBe('Remote note');
    expect(ann.style).toBe('underline');
    expect(ann.color).toBe('red');
    expect(ann.deletedAt).toBeUndefined();
  });

  it('applyRemoteAnnotation merges fields with NEWER HLC into an existing annotation', () => {
    // Seed a local annotation with an older HLC
    const localRow = makeAnnotationRow({
      id: 'annot-exist',
      hlc: OLD_HLC,
      fields: { text: 'old text', note: 'old note', bookHash: 'hash-a' },
    });
    useAnotacionesStore.getState().applyRemoteAnnotation(localRow);

    // Remote has a newer HLC and changed the note field
    const remoteRow = makeAnnotationRow({
      id: 'annot-exist',
      hlc: NEW_HLC,
      fields: { text: 'old text', note: 'NEW note', bookHash: 'hash-a' },
    });
    useAnotacionesStore.getState().applyRemoteAnnotation(remoteRow);

    const ann = useAnotacionesStore.getState().annotations[0]!;
    // note was updated (newer HLC wins)
    expect(ann.note).toBe('NEW note');
    // text is unchanged (same value but newer HLC — still imported)
    expect(ann.text).toBe('old text');
    // still only one annotation
    expect(useAnotacionesStore.getState().annotations).toHaveLength(1);
  });

  it('applyRemoteAnnotation with OLDER HLC does NOT overwrite newer local fields', () => {
    // Seed a local annotation with a NEWER HLC
    const localRow = makeAnnotationRow({
      id: 'annot-exist',
      hlc: NEW_HLC,
      fields: { text: 'newer text', note: 'newer note' },
    });
    useAnotacionesStore.getState().applyRemoteAnnotation(localRow);

    // Remote sends an OLDER HLC with a stale note
    const remoteRow = makeAnnotationRow({
      id: 'annot-exist',
      hlc: OLD_HLC,
      fields: { text: 'newer text', note: 'STALE note' },
    });
    useAnotacionesStore.getState().applyRemoteAnnotation(remoteRow);

    const ann = useAnotacionesStore.getState().annotations[0]!;
    // Local note survives because its HLC is newer
    expect(ann.note).toBe('newer note');
  });

  it('applyRemoteAnnotation with deleted_at_ts soft-deletes the matching annotation', () => {
    // Seed a local annotation
    const localRow = makeAnnotationRow({
      id: 'annot-to-del',
      hlc: OLD_HLC,
      fields: { text: 'will be deleted' },
    });
    useAnotacionesStore.getState().applyRemoteAnnotation(localRow);

    // Remote tombstone
    const tombstoneRow = makeAnnotationRow({
      id: 'annot-to-del',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });

    useAnotacionesStore.getState().applyRemoteAnnotation(tombstoneRow);

    const ann = useAnotacionesStore.getState().annotations[0]!;
    expect(ann.deletedAt).toBeDefined();
    expect(typeof ann.deletedAt).toBe('number');
  });

  it('applyRemoteAnnotation with deleted_at_ts on a NON-EXISTENT id does not crash', () => {
    const tombstoneRow = makeAnnotationRow({
      id: 'annot-never-existed',
      hlc: NEW_HLC,
      fields: {},
      deleted: true,
    });

    // Should not throw
    expect(() => useAnotacionesStore.getState().applyRemoteAnnotation(tombstoneRow)).not.toThrow();

    // Nothing was added
    expect(useAnotacionesStore.getState().annotations).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // applyRemoteAnnotation — per-field HLC (independent fields)
  // ---------------------------------------------------------------------------

  it('applyRemoteAnnotation updates ONLY fields whose remote HLC is newer (per-field LWW)', () => {
    // Seed a local annotation where field 'note' has OLD_HLC and 'text' has NEW_HLC
    // We simulate this by applying two rows sequentially: first a base, then a
    // partial update for just text with NEW_HLC.
    const baseRow = makeAnnotationRow({
      id: 'annot-fields',
      hlc: OLD_HLC,
      fields: { text: 'text-v1', note: 'note-v1', color: 'yellow' },
    });
    useAnotacionesStore.getState().applyRemoteAnnotation(baseRow);

    // Now apply a remote row where 'note' has a DIFFERENT (newer) HLC than local,
    // but 'text' has an OLDER one. 'color' is also newer.
    // We craft a row manually with per-field HLCs.
    const mixedRow: ReplicaRow = {
      user_id: '',
      kind: 'annotation',
      replica_id: 'annotation:annot-fields',
      fields_jsonb: {
        text: { v: 'text-v1', t: OLD_HLC, s: DEVICE_ID },
        note: { v: 'note-V2', t: '0000000000003-00000001-test-device-aaaa' as Hlc, s: DEVICE_ID },
        color: { v: 'blue', t: '0000000000003-00000001-test-device-aaaa' as Hlc, s: DEVICE_ID },
      },
      manifest_jsonb: null,
      deleted_at_ts: null,
      reincarnation: null,
      updated_at_ts: '0000000000003-00000001-test-device-aaaa' as Hlc,
      schema_version: 1,
    };
    useAnotacionesStore.getState().applyRemoteAnnotation(mixedRow);

    const ann = useAnotacionesStore.getState().annotations[0]!;
    // text HLC is OLD (same as local) → no change
    expect(ann.text).toBe('text-v1');
    // note HLC is NEWER → should update
    expect(ann.note).toBe('note-V2');
    // color HLC is NEWER → should update
    expect(ann.color).toBe('blue');
  });

  // ---------------------------------------------------------------------------
  // replicaOutbox — populated on mutations
  // ---------------------------------------------------------------------------

  it('replicaOutbox starts empty', () => {
    expect(useAnotacionesStore.getState().replicaOutbox).toEqual([]);
  });

  it('createAnnotation pushes a ReplicaRow to the outbox', async () => {
    const created = {
      id: 'annot-outbox-1',
      bookHash: 'hash-1',
      bookTitle: 'Test',
      bookAuthor: 'Author',
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'outbox test',
      note: 'test note',
      style: 'highlight',
      color: 'yellow',
      createdAt: 100,
      updatedAt: null,
    };
    const service = {
      createAnnotation: vi.fn().mockResolvedValue(created),
    };

    await useAnotacionesStore.getState().createAnnotation(
      {
        bookHash: 'hash-1',
        bookTitle: 'Test',
        bookAuthor: 'Author',
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'outbox test',
        note: 'test note',
        style: 'highlight',
        color: 'yellow',
      },
      asAnotacionesService(service),
    );

    const outbox = useAnotacionesStore.getState().replicaOutbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.kind).toBe('annotation');
    expect(outbox[0]!.replica_id).toBe('annotation:annot-outbox-1');
    expect(outbox[0]!.deleted_at_ts).toBeNull();
    expect(outbox[0]!.schema_version).toBe(1);
  });

  it('updateAnnotation pushes a ReplicaRow to the outbox', async () => {
    // Seed a local annotation
    useAnotacionesStore.setState({
      annotations: [
        {
          id: 'annot-update-1',
          bookHash: 'hash-1',
          bookTitle: 'Test',
          bookAuthor: null,
          cfi: null,
          sectionHref: null,
          page: null,
          text: 'original text',
          note: 'original note',
          style: 'highlight',
          color: 'yellow',
          createdAt: 100,
          updatedAt: null,
        },
      ],
    });

    const updated = {
      id: 'annot-update-1',
      bookHash: 'hash-1',
      bookTitle: 'Test',
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'original text',
      note: 'updated note',
      style: 'highlight',
      color: 'yellow',
      createdAt: 100,
      updatedAt: 200,
    };
    const service = {
      updateAnnotation: vi.fn().mockResolvedValue(updated),
    };

    const result = await useAnotacionesStore
      .getState()
      .updateAnnotation('annot-update-1', 'updated note', asAnotacionesService(service));

    expect(result).toEqual(updated);

    const outbox = useAnotacionesStore.getState().replicaOutbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.kind).toBe('annotation');
    expect(outbox[0]!.replica_id).toBe('annotation:annot-update-1');
    expect(outbox[0]!.deleted_at_ts).toBeNull();
  });

  it('deleteAnnotations pushes a tombstone ReplicaRow to the outbox', async () => {
    useAnotacionesStore.setState({
      annotations: [
        {
          id: 'annot-del-1',
          bookHash: 'hash-1',
          bookTitle: 'Test',
          bookAuthor: null,
          cfi: null,
          sectionHref: null,
          page: null,
          text: 'to delete',
          note: '',
          style: 'highlight',
          color: 'yellow',
          createdAt: 100,
          updatedAt: null,
        },
      ],
    });

    const service = {
      deleteAnnotations: vi.fn().mockResolvedValue(undefined),
    };

    await useAnotacionesStore
      .getState()
      .deleteAnnotations(['annot-del-1'], asAnotacionesService(service));

    const outbox = useAnotacionesStore.getState().replicaOutbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.kind).toBe('annotation');
    expect(outbox[0]!.replica_id).toBe('annotation:annot-del-1');
    // Tombstone has deleted_at_ts set
    expect(outbox[0]!.deleted_at_ts).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // R5: Merge CRDT idempotente — aplicar la misma réplica dos veces no duplica
  // ---------------------------------------------------------------------------

  it('aplicar la misma réplica dos veces no duplica la entrada (R5)', () => {
    const row = makeAnnotationRow({
      id: 'annot-idem-1',
      hlc: NEW_HLC,
      fields: {
        bookHash: 'hash-idem',
        bookTitle: 'Idempotent Book',
        bookAuthor: 'Idempotent Author',
        cfi: '/6/4',
        page: 7,
        text: 'Texto que no debe duplicarse',
        note: 'Nota idempotente',
        style: 'highlight',
        color: 'blue',
      },
    });

    useAnotacionesStore.getState().applyRemoteAnnotation(row);
    useAnotacionesStore.getState().applyRemoteAnnotation(row);

    const state = useAnotacionesStore.getState();
    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0]!.text).toBe('Texto que no debe duplicarse');
    expect(state.annotations[0]!.note).toBe('Nota idempotente');
  });

  it('aplicar la misma réplica tras merge no modifica los datos ni duplica (R5, triangulación)', () => {
    const row = makeAnnotationRow({
      id: 'annot-idem-2',
      hlc: NEW_HLC,
      fields: {
        bookHash: 'hash-idem2',
        bookTitle: 'Triangulation Book',
        text: 'original text',
        note: 'original note',
        style: 'underline',
        color: 'green',
      },
    });

    // Primera aplicación: inserta
    useAnotacionesStore.getState().applyRemoteAnnotation(row);

    // Segunda aplicación con misma fila: no debe cambiar nada
    useAnotacionesStore.getState().applyRemoteAnnotation(row);

    const state = useAnotacionesStore.getState();
    expect(state.annotations).toHaveLength(1);
    const ann = state.annotations[0]!;
    expect(ann.text).toBe('original text');
    expect(ann.note).toBe('original note');
    expect(ann.style).toBe('underline');
    expect(ann.color).toBe('green');
  });

  it('outbox entries have monotonic HLCs across multiple mutations', async () => {
    const service = {
      createAnnotation: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
        ...input,
        id: `annot-hlc-seq-${input['text']}`,
        createdAt: Date.now(),
        updatedAt: null,
      })),
      updateAnnotation: vi
        .fn()
        .mockImplementation(async (params: { id: string; note: string }) => ({
          id: params.id,
          bookHash: 'hash-1',
          bookTitle: 'Test',
          bookAuthor: null,
          cfi: null,
          sectionHref: null,
          page: null,
          text: 'text',
          note: params.note,
          style: 'highlight',
          color: 'yellow',
          createdAt: 100,
          updatedAt: 200,
        })),
      deleteAnnotations: vi.fn().mockResolvedValue(undefined),
    };

    // 1. Create
    await useAnotacionesStore.getState().createAnnotation(
      {
        bookHash: 'hash-1',
        bookTitle: 'Test',
        bookAuthor: 'Author',
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'a',
        note: '',
        style: 'highlight',
        color: 'yellow',
      },
      asAnotacionesService(service),
    );

    // 2. Update
    useAnotacionesStore.setState({
      annotations: [
        {
          ...useAnotacionesStore.getState().annotations[0]!,
          id: 'annot-hlc-seq-b',
        },
      ],
    });
    await useAnotacionesStore
      .getState()
      .updateAnnotation('annot-hlc-seq-b', 'v2', asAnotacionesService(service));

    // 3. Delete
    useAnotacionesStore.setState({
      annotations: [
        {
          id: 'annot-hlc-seq-c',
          bookHash: 'hash-1',
          bookTitle: 'Test',
          bookAuthor: null,
          cfi: null,
          sectionHref: null,
          page: null,
          text: 'to delete',
          note: '',
          style: 'highlight',
          color: 'yellow',
          createdAt: 100,
          updatedAt: null,
        },
      ],
    });
    await useAnotacionesStore
      .getState()
      .deleteAnnotations(['annot-hlc-seq-c'], asAnotacionesService(service));

    const outbox = useAnotacionesStore.getState().replicaOutbox;
    expect(outbox).toHaveLength(3);

    // All three HLCs must be lexicographically increasing
    const hlc1 = outbox[0]!.updated_at_ts as string;
    const hlc2 = outbox[1]!.updated_at_ts as string;
    const hlc3 = outbox[2]!.updated_at_ts as string;
    expect(hlc1 < hlc2).toBe(true);
    expect(hlc2 < hlc3).toBe(true);
  });
});
