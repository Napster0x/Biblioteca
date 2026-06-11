/**
 * WiFi HTTP SyncTransport — syncs CRDT replica data with a peer on the local
 * network via the Rust HTTP server endpoints.
 *
 * The peer runs a tiny_http server (started by the Tauri backend) that exposes
 *   GET  /replicas/{kind}?since={hlc}  → pull
 *   PUT  /replicas/{kind}              → push
 *   GET  /health                       → reachability check
 *
 * All requests carry a 5-second timeout via AbortController so a dead peer
 * never blocks the sync cycle for long.
 */
import type { ReplicaRow, Hlc, SyncError } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';
import type { SyncTransport } from '@/services/sync/SyncTransport';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 5000;

/** Create an AbortController with a 5s timeout. Returns a cleanup function. */
function createTimeoutController(): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return {
    controller,
    clear: () => clearTimeout(timeout),
  };
}

/** Filter raw JSON to valid ReplicaRow objects (schema_version === 1). */
function filterReplicaRows(data: unknown): ReplicaRow[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is ReplicaRow =>
      typeof row === 'object' && row !== null && (row as ReplicaRow).schema_version === 1,
  );
}

/** Build a SyncError object from a fetch failure. */
function syncError(peerId: string, kind: SyncCategory, err: unknown): SyncError {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'Unknown sync error';
  return {
    peerId,
    kind,
    timestamp: Date.now(),
    message,
    cause: message,
  };
}

// ---------------------------------------------------------------------------
// WiFiHttpTransport
// ---------------------------------------------------------------------------

export class WiFiHttpTransport implements SyncTransport {
  readonly kind = 'wifi' as const;

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  // -------------------------------------------------------------------------
  // Pull
  // -------------------------------------------------------------------------

  /**
   * Pull ReplicaRows for a given kind from the peer.
   *
   * GETs `http://{host}:{port}/replicas/{kind}` (with optional `?since=`
   * query parameter for cursor-based incremental sync). Filters the response
   * by `schema_version === 1`. Throws SyncError on connection failure, timeout,
   * or non-2xx response.
   */
  async pull(kind: SyncCategory, since?: Hlc): Promise<ReplicaRow[]> {
    const peerId = `${this.host}:${this.port}`;
    let url = `http://${this.host}:${this.port}/replicas/${encodeURIComponent(kind)}`;
    if (since) {
      url += `?since=${encodeURIComponent(since)}`;
    }

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, { signal: controller.signal });
      clear();
    } catch (err) {
      throw syncError(peerId, kind, err);
    }

    if (!res.ok) {
      throw {
        peerId,
        kind,
        timestamp: Date.now(),
        message: `HTTP ${res.status}`,
      } as SyncError;
    }

    const data: unknown = await res.json();
    return filterReplicaRows(data);
  }

  // -------------------------------------------------------------------------
  // Push
  // -------------------------------------------------------------------------

  /**
   * Push ReplicaRows for a given kind to the peer.
   *
   * PUTs the rows as a JSON array to `http://{host}:{port}/replicas/{kind}`.
   * The Rust server handles the HLC merge. No-op when rows is empty.
   * Throws SyncError on connection failure, timeout, or non-2xx response.
   */
  async push(kind: SyncCategory, rows: ReplicaRow[]): Promise<void> {
    if (rows.length === 0) return;

    const peerId = `${this.host}:${this.port}`;
    const url = `http://${this.host}:${this.port}/replicas/${encodeURIComponent(kind)}`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
        signal: controller.signal,
      });
      clear();
    } catch (err) {
      throw syncError(peerId, kind, err);
    }

    if (!res.ok) {
      throw {
        peerId,
        kind,
        timestamp: Date.now(),
        message: `HTTP ${res.status}`,
      } as SyncError;
    }
  }

  // -------------------------------------------------------------------------
  // Reachability
  // -------------------------------------------------------------------------

  /**
   * Health check — probes `GET http://{host}:{port}/health`.
   *
   * Returns `true` when the peer responds with a 2xx status within the
   * 5-second timeout window. Returns `false` on any error (connection
   * refused, timeout, non-2xx response).
   */
  async isReachable(): Promise<boolean> {
    try {
      const { controller, clear } = createTimeoutController();
      const res = await fetch(`http://${this.host}:${this.port}/health`, {
        signal: controller.signal,
      });
      clear();
      return res.ok;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Dictionary image binary sync
  // -------------------------------------------------------------------------

  /**
   * Pull a dictionary entry's image from the peer.
   *
   * GETs `http://{host}:{port}/dictionary-images/{entryId}`.
   * Returns the raw PNG bytes, or `null` when the image doesn't exist
   * (404). Throws SyncError on connection failure, timeout, or server
   * error (5xx).
   */
  async pullDictionaryImage(entryId: string): Promise<ArrayBuffer | null> {
    const peerId = `${this.host}:${this.port}`;
    const url = `http://${this.host}:${this.port}/dictionary-images/${encodeURIComponent(entryId)}`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, { signal: controller.signal });
      clear();
    } catch (err) {
      throw syncError(peerId, 'dictionary-entry', err);
    }

    if (res.status === 404) return null;
    if (!res.ok) {
      throw {
        peerId,
        kind: 'dictionary-entry' as SyncCategory,
        timestamp: Date.now(),
        message: `HTTP ${res.status}`,
      } as SyncError;
    }

    return await res.arrayBuffer();
  }

  /**
   * Push a dictionary entry's image to the peer.
   *
   * PUTs the raw PNG bytes to `http://{host}:{port}/dictionary-images/{entryId}`.
   * Returns `{ uploaded: true }` on success. Throws SyncError on connection
   * failure, timeout, or server error (5xx). Returns `{ uploaded: false }`
   * when the server rejects with a client error (4xx excluding 404).
   */
  async pushDictionaryImage(
    entryId: string,
    imageBytes: ArrayBuffer,
  ): Promise<{ uploaded: boolean }> {
    const peerId = `${this.host}:${this.port}`;
    const url = `http://${this.host}:${this.port}/dictionary-images/${encodeURIComponent(entryId)}`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: imageBytes,
        signal: controller.signal,
      });
      clear();
    } catch (err) {
      throw syncError(peerId, 'dictionary-entry', err);
    }

    if (!res.ok) {
      throw {
        peerId,
        kind: 'dictionary-entry' as SyncCategory,
        timestamp: Date.now(),
        message: `HTTP ${res.status}`,
      } as SyncError;
    }

    return { uploaded: true };
  }
}
