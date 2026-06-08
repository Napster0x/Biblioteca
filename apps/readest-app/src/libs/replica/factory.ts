/**
 * ReplicaRow factory.
 *
 * Creates a ReplicaRow from a domain item by wrapping each field in a
 * FieldEnvelope, minting a fresh HLC, and assembling the full row.
 */

import type { ReplicaRow, FieldsObject, Hlc } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';
import { mintHLC } from './hlc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateReplicaRowItem {
  id: string;
  fields: Record<string, unknown>;
  deletedAt?: Date;
}

export interface CreateReplicaRowInput {
  kind: SyncCategory;
  item: CreateReplicaRowItem;
  deviceId: string;
  lastHLC?: Hlc;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ReplicaRow from a domain item.
 *
 * Mints a fresh HLC (monotonic if `lastHLC` is provided), wraps each
 * domain field in a `FieldEnvelope{V, t: HLC, s: deviceId}`, and
 * assembles the full row.
 */
export function createReplicaRow(input: CreateReplicaRowInput): ReplicaRow {
  const { kind, item, deviceId, lastHLC } = input;

  const hlc = mintHLC(deviceId, lastHLC);

  // Wrap each field in a FieldEnvelope.
  const fields: FieldsObject = {};
  for (const [key, value] of Object.entries(item.fields)) {
    fields[key] = {
      v: value,
      t: hlc,
      s: deviceId,
    };
  }

  const deleted = item.deletedAt ? hlc : null;

  return {
    user_id: '',
    kind,
    replica_id: `${kind}:${item.id}`,
    fields_jsonb: fields,
    manifest_jsonb: null,
    deleted_at_ts: deleted,
    reincarnation: null,
    updated_at_ts: hlc,
    schema_version: 1,
  };
}
