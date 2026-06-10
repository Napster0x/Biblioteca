/**
 * SyncTransport — abstraction for syncing CRDT replica data between devices.
 *
 * Each transport implementation handles pull and push of ReplicaRows for a
 * specific transport mechanism (WebDAV, WiFi peer-to-peer, USB tunnel).
 * The interface is deliberately narrow: pull, push, and optional binary
 * (dictionary image) sync.
 */
import type { ReplicaRow, Hlc } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';

export interface SyncTransport {
  /** Discriminant identifying the transport mechanism. */
  readonly kind: 'webdav' | 'wifi' | 'usb';

  /**
   * Pull ReplicaRows for a given kind from the transport backend.
   *
   * @param kind  - Sync category (e.g. 'annotation', 'quote', 'dictionary-entry').
   * @param since - Optional HLC cursor; only rows with `updated_at_ts > since`
   *                are returned. Omit to fetch all rows.
   * @returns Filtered ReplicaRow array. Never null.
   */
  pull(kind: SyncCategory, since?: Hlc): Promise<ReplicaRow[]>;

  /**
   * Push ReplicaRows for a given kind to the transport backend.
   *
   * Implementations should merge rows by `replica_id` with HLC ordering
   * (newer HLC wins). When `rows` is empty, this is a no-op.
   *
   * @param kind - Sync category.
   * @param rows - ReplicaRows to merge and push.
   */
  push(kind: SyncCategory, rows: ReplicaRow[]): Promise<void>;

  /**
   * Pull a dictionary entry's image from the transport backend.
   *
   * @param entryId - The entry identifier (path-safe).
   * @returns Image bytes, or `null` when the image doesn't exist (404 / missing).
   */
  pullDictionaryImage?(entryId: string): Promise<ArrayBuffer | null>;

  /**
   * Push a dictionary entry's image to the transport backend.
   *
   * Implementations should skip the upload when the remote already holds
   * identical content (size match) to avoid unnecessary transfers.
   *
   * @param entryId    - The entry identifier.
   * @param imageBytes - Raw PNG bytes to upload.
   * @returns `{ uploaded: true }` when bytes were sent; `{ uploaded: false }`
   *          when the remote already matched.
   */
  pushDictionaryImage?(entryId: string, imageBytes: ArrayBuffer): Promise<{ uploaded: boolean }>;

  /**
   * Health check — verify the transport backend is reachable.
   *
   * WebDAV should return true when configured. WiFi/USB transports should
   * probe the remote `/health` endpoint.
   */
  isReachable?(): Promise<boolean>;
}
