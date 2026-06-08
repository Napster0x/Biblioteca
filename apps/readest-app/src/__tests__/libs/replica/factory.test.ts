import { describe, expect, it } from 'vitest';
import { createReplicaRow, type CreateReplicaRowInput } from '@/libs/replica/factory';
import type { FieldEnvelope } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';

describe('createReplicaRow', () => {
  const deviceId = 'test-device-uuid';

  it('creates a valid ReplicaRow with the correct replica_id format', () => {
    const input: CreateReplicaRowInput = {
      kind: 'annotation' as SyncCategory,
      item: { id: 'abc-123', fields: { text: 'hello' } },
      deviceId,
    };
    const row = createReplicaRow(input);
    expect(row.replica_id).toBe('annotation:abc-123');
    expect(row.kind).toBe('annotation');
    expect(row.user_id).toBe('');
    expect(row.schema_version).toBe(1);
    expect(row.deleted_at_ts).toBeNull();
    expect(row.reincarnation).toBeNull();
    expect(row.manifest_jsonb).toBeNull();
  });

  it('wraps each item field in a FieldEnvelope', () => {
    const input: CreateReplicaRowInput = {
      kind: 'annotation' as SyncCategory,
      item: { id: 'abc-123', fields: { text: 'hello', page: 42 } },
      deviceId,
    };
    const row = createReplicaRow(input);
    const fields = row.fields_jsonb;
    expect(Object.keys(fields)).toHaveLength(2);
    const textEnv = fields['text'] as FieldEnvelope;
    const pageEnv = fields['page'] as FieldEnvelope;
    expect(textEnv.v).toBe('hello');
    expect(pageEnv.v).toBe(42);
    // Each field envelope has t (HLC) and s (deviceId)
    expect(typeof textEnv.t).toBe('string');
    expect(textEnv.s).toBe(deviceId);
    expect(pageEnv.s).toBe(deviceId);
  });

  it('all fields in a row share the same HLC timestamp', () => {
    const input: CreateReplicaRowInput = {
      kind: 'annotation' as SyncCategory,
      item: { id: 'abc-123', fields: { a: 1, b: 2, c: 3 } },
      deviceId,
    };
    const row = createReplicaRow(input);
    const fields = row.fields_jsonb;
    const timestamps = Object.values(fields).map((f) => f.t);
    expect(timestamps[0]).toBe(timestamps[1]);
    expect(timestamps[0]).toBe(timestamps[2]);
    // updated_at_ts matches field timestamps
    expect(row.updated_at_ts).toBe(timestamps[0]);
  });

  it('sets deleted_at_ts to the HLC when item.deletedAt is provided', () => {
    const input: CreateReplicaRowInput = {
      kind: 'quote' as SyncCategory,
      item: { id: 'q-456', fields: { text: 'quote text' }, deletedAt: new Date('2026-06-08') },
      deviceId,
    };
    const row = createReplicaRow(input);
    expect(row.deleted_at_ts).not.toBeNull();
    expect(typeof row.deleted_at_ts).toBe('string');
    expect(row.updated_at_ts).toBe(row.deleted_at_ts);
  });

  it('leaves deleted_at_ts null when item.deletedAt is not provided', () => {
    const input: CreateReplicaRowInput = {
      kind: 'annotation' as SyncCategory,
      item: { id: 'abc-123', fields: { text: 'hello' } },
      deviceId,
    };
    const row = createReplicaRow(input);
    expect(row.deleted_at_ts).toBeNull();
  });

  it('uses dictionary-entry as the kind for dictionary items', () => {
    const input: CreateReplicaRowInput = {
      kind: 'dictionary-entry' as SyncCategory,
      item: { id: 'dict-1', fields: { term: 'hello', language: 'en' } },
      deviceId,
    };
    const row = createReplicaRow(input);
    expect(row.kind).toBe('dictionary-entry');
    expect(row.replica_id).toBe('dictionary-entry:dict-1');
  });

  it('produces monotonic HLCs when called with lastHLC', () => {
    const input: CreateReplicaRowInput = {
      kind: 'annotation' as SyncCategory,
      item: { id: '1', fields: {} },
      deviceId,
    };
    const row1 = createReplicaRow(input);
    const row2 = createReplicaRow({
      ...input,
      item: { id: '2', fields: {} },
      lastHLC: row1.updated_at_ts,
    });
    const row3 = createReplicaRow({
      ...input,
      item: { id: '3', fields: {} },
      lastHLC: row2.updated_at_ts,
    });
    // HLCs must be strictly increasing
    expect(row1.updated_at_ts < row2.updated_at_ts).toBe(true);
    expect(row2.updated_at_ts < row3.updated_at_ts).toBe(true);
  });

  it('produces unique replica_ids for different items of the same kind', () => {
    const input: CreateReplicaRowInput = {
      kind: 'quote' as SyncCategory,
      item: { id: 'q-1', fields: { text: 'a' } },
      deviceId,
    };
    const row1 = createReplicaRow(input);
    const row2 = createReplicaRow({ ...input, item: { id: 'q-2', fields: { text: 'b' } } });
    expect(row1.replica_id).not.toBe(row2.replica_id);
    expect(row1.replica_id).toBe('quote:q-1');
    expect(row2.replica_id).toBe('quote:q-2');
  });
});
