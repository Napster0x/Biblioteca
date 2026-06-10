/**
 * WebDAV SyncTransport — reads and writes per-kind replicas.json files on a
 * WebDAV remote.
 *
 * Layout:
 *   <rootPath>/Readest/replicas/<kind>.json
 *
 * Each file is a JSON array of ReplicaRow objects. The transport is
 * append-only: existing rows on the remote are never deleted; new rows
 * are merged in by replica_id with HLC ordering (newer HLC wins).
 *
 * Pull supports an HLC cursor (`since`) so callers only fetch rows they
 * haven't applied yet. Rows with unknown `schema_version` are silently
 * skipped.
 */
import type { ReplicaRow, Hlc } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';
import type { WebDAVConfig } from '@/services/webdav/WebDAVClient';
import type { SyncTransport } from '@/services/sync/SyncTransport';
import {
  getFile,
  putFile,
  ensureDirectory,
  getFileBinary,
  putFileBinary,
  headFile,
} from '@/services/webdav/WebDAVClient';
import {
  buildBasePath,
  ancestorsOf,
  buildDictionaryImagePath,
} from '@/services/webdav/WebDAVPaths';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Build the remote path for a replica kind's replicas.json file.
 *
 * @example
 *   buildReplicasPath('/books', 'annotation')
 *   // → '/books/Readest/replicas/annotation.json'
 */
function buildReplicasPath(rootPath: string, kind: SyncCategory | string): string {
  return `${buildBasePath(rootPath)}/replicas/${kind}.json`;
}

// ---------------------------------------------------------------------------
// WebDAVTransport
// ---------------------------------------------------------------------------

export class WebDAVTransport implements SyncTransport {
  readonly kind = 'webdav' as const;

  constructor(
    private readonly config: WebDAVConfig,
    private readonly rootPath: string,
  ) {}

  // ---------------------------------------------------------------------------
  // Pull
  // ---------------------------------------------------------------------------

  /**
   * Pull ReplicaRows for a given kind from the WebDAV remote.
   *
   * Fetches `<rootPath>/Readest/replicas/<kind>.json`, parses the JSON
   * array, and filters:
   *   - Rows whose `schema_version !== 1` are silently skipped (forward compat).
   *   - If `since` is provided, only rows where `updated_at_ts > since` are
   *     returned.
   *
   * Returns an empty array when the remote file does not exist (404), the
   * payload is malformed, or no rows pass the filters.
   */
  async pull(kind: SyncCategory | string, since?: Hlc): Promise<ReplicaRow[]> {
    const path = buildReplicasPath(this.rootPath, kind);

    let raw: string | null;
    try {
      raw = await getFile(this.config, path);
    } catch {
      return [];
    }

    if (!raw) return [];

    let allRows: unknown;
    try {
      allRows = JSON.parse(raw);
    } catch {
      return [];
    }

    if (!Array.isArray(allRows)) return [];

    // Cast and filter by schema_version
    const valid = allRows.filter(
      (row): row is ReplicaRow =>
        typeof row === 'object' && row !== null && (row as ReplicaRow).schema_version === 1,
    );

    if (!since) return valid;

    // Filter by cursor: only rows with updated_at_ts > since
    return valid.filter((row) => row.updated_at_ts > since);
  }

  // ---------------------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------------------

  /**
   * Push ReplicaRows for a given kind to the WebDAV remote.
   *
   * Reads the existing file (if any), merges the new rows by `replica_id`:
   *   - New ids are appended.
   *   - Existing ids are replaced when the new row has a strictly higher
   *     `updated_at_ts` HLC; otherwise the existing row is kept.
   *
   * The merged result is written back via PUT. Parent directories (including
   * the `replicas/` directory) are created idempotently.
   *
   * When `rows` is an empty array, this method is a no-op — no network
   * request is made.
   */
  async push(kind: SyncCategory | string, rows: ReplicaRow[]): Promise<void> {
    if (rows.length === 0) return;

    const path = buildReplicasPath(this.rootPath, kind);

    // Read existing replicas from the remote (best-effort).
    let existing: ReplicaRow[] = [];
    try {
      const raw = await getFile(this.config, path);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            existing = parsed.filter(
              (r): r is ReplicaRow =>
                typeof r === 'object' && r !== null && (r as ReplicaRow).schema_version === 1,
            );
          }
        } catch {
          // Malformed JSON → treat as empty, will be overwritten.
        }
      }
    } catch {
      // 404 or network error → treat as empty.
    }

    // Merge: index existing rows by replica_id.
    const merged = [...existing];
    const idxByReplicaId = new Map<string, number>();
    for (let i = 0; i < merged.length; i++) {
      idxByReplicaId.set(merged[i]!.replica_id, i);
    }

    for (const row of rows) {
      const existingIdx = idxByReplicaId.get(row.replica_id);
      if (existingIdx === undefined) {
        merged.push(row);
        idxByReplicaId.set(row.replica_id, merged.length - 1);
      } else {
        const existingRow = merged[existingIdx]!;
        if (row.updated_at_ts > existingRow.updated_at_ts) {
          merged[existingIdx] = row;
        }
      }
    }

    // Ensure parent directories exist.
    const dirs = ancestorsOf(path);
    await ensureDirectory(this.config, dirs);

    await putFile(this.config, path, JSON.stringify(merged));
  }

  // ---------------------------------------------------------------------------
  // Dictionary image binary sync
  // ---------------------------------------------------------------------------

  /**
   * Push a dictionary entry's image to the WebDAV remote.
   *
   * HEAD-probes the remote path first to skip uploads when the remote
   * already has a blob of the same size (bytes-identical optimisation).
   * When the HEAD probe fails (404 or network error), the upload proceeds.
   *
   * Parent directories are created idempotently before the PUT.
   */
  async pushDictionaryImage(
    entryId: string,
    imageBytes: ArrayBuffer,
  ): Promise<{ uploaded: boolean }> {
    const path = buildDictionaryImagePath(this.rootPath, entryId);

    // HEAD probe — skip upload when remote blob already matches.
    try {
      const head = await headFile(this.config, path);
      if (head && head.size === imageBytes.byteLength) {
        return { uploaded: false };
      }
    } catch {
      // HEAD failure (likely 404) — proceed with the upload.
    }

    const dirs = ancestorsOf(path);
    await ensureDirectory(this.config, dirs);

    await putFileBinary(this.config, path, imageBytes, 'image/png');
    return { uploaded: true };
  }

  /**
   * Pull a dictionary entry's image from the WebDAV remote.
   *
   * GETs the binary blob. Returns `null` when the remote file doesn't
   * exist (404) — callers treat this as a normal "no image yet" case.
   */
  async pullDictionaryImage(entryId: string): Promise<ArrayBuffer | null> {
    const path = buildDictionaryImagePath(this.rootPath, entryId);
    return getFileBinary(this.config, path);
  }
}
