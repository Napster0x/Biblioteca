/**
 * Branded HLC string. Lexicographic comparison matches temporal order.
 * Format: `${physicalMs:13-hex}-${counter:8-hex}-${deviceId}`
 */
export type Hlc = string & { readonly __brand: 'Hlc' };

export interface FieldEnvelope<V = unknown> {
  v: V;
  t: Hlc;
  s: string;
}

export type FieldsObject = Record<string, FieldEnvelope>;

export interface ManifestFile {
  filename: string;
  byteSize: number;
  partialMd5: string;
  mtime?: number;
}

export interface Manifest {
  files: ManifestFile[];
  schemaVersion: number;
}

export interface ReplicaRow {
  user_id: string;
  kind: string;
  replica_id: string;
  fields_jsonb: FieldsObject;
  manifest_jsonb: Manifest | null;
  deleted_at_ts: Hlc | null;
  reincarnation: string | null;
  updated_at_ts: Hlc;
  schema_version: number;
}

export interface CipherEnvelope {
  c: string;
  i: string;
  s: string;
  alg: string;
  h: string;
}

export const isCipherEnvelope = (v: unknown): v is CipherEnvelope =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as CipherEnvelope).c === 'string' &&
  typeof (v as CipherEnvelope).i === 'string' &&
  typeof (v as CipherEnvelope).s === 'string' &&
  typeof (v as CipherEnvelope).alg === 'string' &&
  typeof (v as CipherEnvelope).h === 'string';

// ───────────────────────────────────────────────────────────────────
// sync-fix-crdt — new types for local sync progress, results, errors
// ───────────────────────────────────────────────────────────────────

import type { SyncCategory } from '@/types/settings';

export interface SyncKindResult {
  kind: SyncCategory;
  pulled: number;
  pushed: number;
  conflicts: number;
}

export interface SyncError {
  peerId: string;
  kind: SyncCategory;
  timestamp: number;
  message: string;
  cause?: string;
}

export interface SyncResult {
  peerId: string;
  kinds: Record<string, SyncKindResult>;
  errors: SyncError[];
  startedAt: number;
  finishedAt: number;
}

export type SyncPhase = 'connecting' | 'pulling' | 'merging' | 'pushing' | 'finalizing';

export interface SyncStep {
  phase: SyncPhase;
  kind?: SyncCategory;
  current?: number;
  total?: number;
  detail?: string;
}
