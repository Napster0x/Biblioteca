import { compareHLC } from '@/libs/replica/hlc';
import type { FieldEnvelope, Hlc, ReplicaRow } from '@/types/replica';

function maxHlc(values: readonly (Hlc | null | undefined)[]): Hlc | undefined {
  let max: Hlc | undefined;
  for (const value of values) {
    if (!value) continue;
    if (!max || compareHLC(value, max) > 0) max = value;
  }
  return max;
}

function cloneFields(fields: ReplicaRow['fields_jsonb']): ReplicaRow['fields_jsonb'] {
  const cloned: ReplicaRow['fields_jsonb'] = {};
  for (const [key, field] of Object.entries(fields)) {
    cloned[key] = { ...field };
  }
  return cloned;
}

function isNewerField(candidate: FieldEnvelope, current: FieldEnvelope | undefined): boolean {
  return !current || compareHLC(candidate.t, current.t) > 0;
}

/**
 * Deterministic harness helper for Slice 1 CRDT/HLC invariant tests.
 *
 * This function documents the expected per-field HLC merge semantics without
 * changing the existing production sync path. Wiring those semantics into
 * `runSyncCycle` / repository merge flows is a separate work unit and must be
 * justified by its own failing production-path test.
 */
export function mergeReplicaRows(local: ReplicaRow, remote: ReplicaRow): ReplicaRow {
  const fields = cloneFields(local.fields_jsonb);
  const deleteHlc = maxHlc([local.deleted_at_ts, remote.deleted_at_ts]);

  for (const [key, remoteField] of Object.entries(remote.fields_jsonb)) {
    if (deleteHlc && compareHLC(remoteField.t, deleteHlc) <= 0) continue;
    if (isNewerField(remoteField, fields[key])) fields[key] = { ...remoteField };
  }

  const updatedAt = maxHlc([deleteHlc, ...Object.values(fields).map((field) => field.t)]);

  return {
    ...local,
    fields_jsonb: fields,
    deleted_at_ts: deleteHlc ?? null,
    updated_at_ts: updatedAt ?? local.updated_at_ts,
  };
}
