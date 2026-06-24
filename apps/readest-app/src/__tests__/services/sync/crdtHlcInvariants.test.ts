import { describe, expect, it } from 'vitest';
import { mergeReplicaRows } from '@/services/sync/crdtMerge';
import type { FieldEnvelope, Hlc, ReplicaRow } from '@/types/replica';

const DEVICE_A = 'device-a';
const DEVICE_B = 'device-b';

const HLC_1 = '0000000000001-00000001-device-a' as Hlc;
const HLC_2 = '0000000000002-00000001-device-b' as Hlc;
const HLC_3 = '0000000000003-00000001-device-a' as Hlc;

function envelope(value: unknown, hlc: Hlc, deviceId = DEVICE_A): FieldEnvelope {
  return { v: value, t: hlc, s: deviceId };
}

function row(input: {
  kind?: string;
  id?: string;
  fields: Record<string, FieldEnvelope>;
  deletedAt?: Hlc | null;
  updatedAt?: Hlc;
}): ReplicaRow {
  const updatedAt =
    input.updatedAt ??
    maxHlc([input.deletedAt ?? undefined, ...Object.values(input.fields).map((field) => field.t)]);

  return {
    user_id: '',
    kind: input.kind ?? 'quote',
    replica_id: `${input.kind ?? 'quote'}:${input.id ?? 'same-id'}`,
    fields_jsonb: input.fields,
    manifest_jsonb: null,
    deleted_at_ts: input.deletedAt ?? null,
    reincarnation: null,
    updated_at_ts: updatedAt,
    schema_version: 1,
  };
}

function maxHlc(values: readonly (Hlc | undefined)[]): Hlc {
  const sorted = values.filter((value): value is Hlc => Boolean(value)).sort();
  const latest = sorted.at(-1);
  if (!latest) throw new Error('test row requires at least one HLC');
  return latest;
}

describe('CRDT/HLC deterministic invariants', () => {
  it('resolves same-field conflicts by greater HLC regardless of merge order', () => {
    const local = row({ fields: { text: envelope('older text', HLC_1, DEVICE_A) } });
    const remote = row({ fields: { text: envelope('newer text', HLC_2, DEVICE_B) } });

    const localThenRemote = mergeReplicaRows(local, remote);
    const remoteThenLocal = mergeReplicaRows(remote, local);

    expect(localThenRemote.fields_jsonb.text).toEqual(envelope('newer text', HLC_2, DEVICE_B));
    expect(remoteThenLocal.fields_jsonb.text).toEqual(envelope('newer text', HLC_2, DEVICE_B));
    expect(mergeReplicaRows(localThenRemote, remote)).toEqual(localThenRemote);
  });

  it('preserves independent per-field edits instead of overwriting the whole row', () => {
    const local = row({
      fields: {
        text: envelope('shared text', HLC_1, DEVICE_A),
        note: envelope('local note', HLC_3, DEVICE_A),
      },
    });
    const remote = row({
      fields: {
        text: envelope('remote text', HLC_2, DEVICE_B),
        note: envelope('old note', HLC_1, DEVICE_B),
      },
    });

    const merged = mergeReplicaRows(local, remote);

    expect(merged.fields_jsonb.text).toEqual(envelope('remote text', HLC_2, DEVICE_B));
    expect(merged.fields_jsonb.note).toEqual(envelope('local note', HLC_3, DEVICE_A));
    expect(merged.updated_at_ts).toBe(HLC_3);
  });

  it('keeps a newer tombstone when stale live data arrives later', () => {
    const tombstone = row({
      fields: { text: envelope('deleted text snapshot', HLC_1, DEVICE_A) },
      deletedAt: HLC_3,
      updatedAt: HLC_3,
    });
    const staleLive = row({ fields: { text: envelope('stale resurrection', HLC_2, DEVICE_B) } });

    const merged = mergeReplicaRows(tombstone, staleLive);

    expect(merged.deleted_at_ts).toBe(HLC_3);
    expect(merged.fields_jsonb.text).toEqual(envelope('deleted text snapshot', HLC_1, DEVICE_A));
    expect(mergeReplicaRows(merged, staleLive)).toEqual(merged);
  });

  it('converges and stays idempotent for replayed bidirectional payloads', () => {
    const replicaA = row({
      fields: {
        text: envelope('A text', HLC_2, DEVICE_A),
        contextBefore: envelope('shared context', HLC_1, DEVICE_A),
      },
    });
    const replicaB = row({
      fields: {
        text: envelope('old text', HLC_1, DEVICE_B),
        contextBefore: envelope('B context', HLC_3, DEVICE_B),
      },
    });

    const aAfterB = mergeReplicaRows(replicaA, replicaB);
    const bAfterA = mergeReplicaRows(replicaB, replicaA);

    expect(aAfterB).toEqual(bAfterA);
    expect(aAfterB.fields_jsonb.text).toEqual(envelope('A text', HLC_2, DEVICE_A));
    expect(aAfterB.fields_jsonb.contextBefore).toEqual(envelope('B context', HLC_3, DEVICE_B));
    expect(mergeReplicaRows(aAfterB, replicaB)).toEqual(aAfterB);
  });
});
