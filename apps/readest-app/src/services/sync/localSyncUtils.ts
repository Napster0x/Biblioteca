/**
 * localSyncUtils — sync utilities for local USB-only peer-to-peer sync.
 *
 * Provides standalone functions that replicate `useReplicaSync`'s sync cycle
 * logic but accept a transport directly, enabling per-peer progress tracking.
 */
import type {
  ReplicaRow,
  Hlc,
  FieldEnvelope,
  SyncResult,
  SyncKindResult,
  SyncError,
  SyncStep,
} from '@/types/replica';
import type { SyncCategory } from '@/types/settings';
import type { SyncTransport } from '@/services/sync/SyncTransport';
import type { PeerInfo } from '@/types/settings';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import { useCitasStore } from '@/store/citasStore';
import { useDictionaryStore } from '@/store/dictionaryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { peerKey, type PeerKey } from '@/store/localSyncStore';
import { USBHttpTransport, verifyImageManifest } from '@/services/sync/USBHttpTransport';
import environmentConfig from '@/services/environment';
import { type VisibleSeedProvider } from '@/services/sync/visibleSeedRepository';

// ---------------------------------------------------------------------------
// filterReachablePeers
// ---------------------------------------------------------------------------

/**
 * Filter peers to only those confirmed reachable via health-check.
 *
 * Peers with unknown health (no entry in peerHealth) are excluded — we only
 * sync with peers we know are reachable.
 */
export function filterReachablePeers(
  peers: PeerInfo[],
  peerHealth: Record<PeerKey, { reachable: boolean }>,
): PeerInfo[] {
  return peers.filter((p) => {
    if (p.kind !== 'usb') return false;

    const health = peerHealth[peerKey(p.host, p.port)];
    return health?.reachable === true;
  });
}

// ---------------------------------------------------------------------------
// createPeerTransport
// ---------------------------------------------------------------------------

/**
 * Create a SyncTransport for a given peer.
 *
 * Uses only USB peers. WiFi/mDNS peers are intentionally rejected from the
 * local sync flow so a USB failure cannot fall back to LAN discovery.
 */
export function createPeerTransport(peer: PeerInfo): SyncTransport {
  if (peer.kind === 'usb') {
    return new USBHttpTransport(peer.port);
  }
  throw new Error('USB-only local sync requires a USB peer');
}

// ---------------------------------------------------------------------------
// runSyncCycle
// ---------------------------------------------------------------------------

const ALL_KINDS: readonly SyncCategory[] = [
  'annotation',
  'quote',
  'dictionary-entry',
  'dictionary-occurrence',
];

function errorMessageFromUnknown(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Extract image manifest metadata ({ sha256, byteSize }) from a
 * ReplicaRow's manifest_jsonb, if present.
 *
 * The manifest can have two shapes:
 *   `{ sha256: string, byteSize: number }` — direct image manifest;
 *   `{ files: [{ filename, byteSize, partialMd5 }] }` — legacy book-file manifest
 *     where `partialMd5` stores the SHA-256 hex string for image files.
 *
 * Returns null when neither shape provides usable image validation data.
 */
function manifestFromRow(row: ReplicaRow): { sha256?: string; byteSize?: number } | null {
  if (!row.manifest_jsonb) return null;

  const m = row.manifest_jsonb as unknown as Record<string, unknown>;

  // Direct image manifest: { sha256, byteSize }
  if (typeof m['sha256'] === 'string' || typeof m['byteSize'] === 'number') {
    return {
      sha256: typeof m['sha256'] === 'string' ? m['sha256'] : undefined,
      byteSize: typeof m['byteSize'] === 'number' ? m['byteSize'] : undefined,
    };
  }

  // Legacy book-file manifest: { files: [{ filename, byteSize, partialMd5 }] }
  const files = m['files'];
  if (Array.isArray(files) && files.length > 0) {
    const imageFile = files.find(
      (f: Record<string, unknown>) =>
        f['filename'] === 'image.png' ||
        (typeof f['filename'] === 'string' && (f['filename'] as string).endsWith('.png')),
    ) as Record<string, unknown> | undefined;
    if (imageFile) {
      return {
        byteSize: typeof imageFile['byteSize'] === 'number' ? imageFile['byteSize'] : undefined,
        sha256: typeof imageFile['partialMd5'] === 'string' ? imageFile['partialMd5'] : undefined,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tauri bridge helpers
// ---------------------------------------------------------------------------

/**
 * Cache for the app data directory path.
 * Populated lazily on first call to `getDbPath()`.
 */
let _dbPathCache: string | undefined;

/** @internal Reset module-level state for test isolation. */
export function __resetSyncModuleState(): void {
  _dbPathCache = undefined;
}

/**
 * Try to get the app data directory path for Tauri invoke calls.
 * Returns empty string when Tauri is not available (web context).
 * Result is cached after first resolution to avoid repeated dynamic imports.
 */
async function getDbPath(): Promise<string> {
  if (_dbPathCache !== undefined) return _dbPathCache;
  try {
    const { appDataDir } = await import('@tauri-apps/api/path');
    _dbPathCache = await appDataDir();
  } catch {
    _dbPathCache = '';
  }
  return _dbPathCache;
}

/**
 * Filter rows through Tauri `filter_unchanged_replicas` if available.
 * Gracefully degrades to returning all rows when invoke is not available
 * or throws (web context / non-Tauri runtime).
 */
async function filterUnchangedViaInvoke(
  rows: ReplicaRow[],
  kind: SyncCategory,
  dbPath: string,
): Promise<ReplicaRow[]> {
  if (!dbPath || rows.length === 0) return rows;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke('filter_unchanged_replicas', {
      kind,
      rows_json: rows,
      db_path: dbPath,
    });
    // Defensive: if invoke returns undefined or non-array, fall back to all rows
    return Array.isArray(result) ? (result as ReplicaRow[]) : rows;
  } catch (err) {
    console.warn('[sync] filter_unchanged_replicas invoke failed, using all rows', err);
    return rows;
  }
}

function restoreOutboxRows(kind: SyncCategory, rows: ReplicaRow[]): void {
  if (rows.length === 0) return;

  switch (kind) {
    case 'annotation':
      useAnotacionesStore.setState({
        replicaOutbox: [...useAnotacionesStore.getState().replicaOutbox, ...rows],
      });
      break;
    case 'quote':
      useCitasStore.setState({
        replicaOutbox: [...useCitasStore.getState().replicaOutbox, ...rows],
      });
      break;
    case 'dictionary-entry':
    case 'dictionary-occurrence':
      useDictionaryStore.setState({
        replicaOutbox: [...useDictionaryStore.getState().replicaOutbox, ...rows],
      });
      break;
    default:
      break;
  }
}

function drainOutboxRows(kind: SyncCategory): ReplicaRow[] {
  switch (kind) {
    case 'annotation': {
      const outbox = [...useAnotacionesStore.getState().replicaOutbox];
      useAnotacionesStore.setState({ replicaOutbox: [] });
      return outbox;
    }
    case 'quote': {
      const outbox = [...useCitasStore.getState().replicaOutbox];
      useCitasStore.setState({ replicaOutbox: [] });
      return outbox;
    }
    case 'dictionary-entry': {
      const outbox = [...useDictionaryStore.getState().replicaOutbox];
      const entryRows = outbox.filter((row) => row.kind === 'dictionary-entry');
      const remaining = outbox.filter((row) => row.kind !== 'dictionary-entry');
      useDictionaryStore.setState({ replicaOutbox: remaining });
      return entryRows;
    }
    case 'dictionary-occurrence': {
      const outbox = [...useDictionaryStore.getState().replicaOutbox];
      const occRows = outbox.filter((row) => row.kind === 'dictionary-occurrence');
      const remaining = outbox.filter((row) => row.kind !== 'dictionary-occurrence');
      useDictionaryStore.setState({ replicaOutbox: remaining });
      return occRows;
    }
    default:
      return [];
  }
}

/**
 * Run one full sync cycle for the given kinds via a transport.
 *
 * Accepts optional `peerId` to use per-peer cursors in `localSyncCursors`
 * (for WiFi/USB P2P sync). Without `peerId`, falls back to the shared
 * `lastSyncedAtReplicas` cursor (WebDAV/KOSync path).
 *
 * On the first sync with a peer (`isFirstSync`):
 *   1. Pull all remote rows (no `?since=` cursor)
 *   2. Apply locally
 *   3. Push ALL local replicas (seed, not just outbox)
 *   4. Set cursor in `localSyncCursors[peerId]`
 *
 * On subsequent syncs:
 *   1. Pull since last cursor
 *   2. Apply locally
 *   3. Push only outbox rows
 *   4. Advance cursor
 *
 * Returns `SyncResult` with per-kind counts and any errors.
 * Accepts optional `onStep` callback for progress reporting.
 */
export async function runSyncCycle(
  transport: SyncTransport,
  kinds: readonly SyncCategory[] = ALL_KINDS,
  peerId?: string,
  onStep?: (step: SyncStep) => void,
  seedProvider?: VisibleSeedProvider,
): Promise<SyncResult> {
  // Resolve seed provider dynamically so HMR picks up code changes
  // without requiring a full page reload.
  const seed =
    seedProvider ??
    (await import('@/services/sync/visibleSeedRepository')).defaultVisibleSeedProvider;
  const startedAt = Date.now();
  const dbPath = await getDbPath();
  const errors: SyncError[] = [];
  const kindsResult: Record<string, SyncKindResult> = {};

  // Initialize result entries
  for (const kind of kinds) {
    kindsResult[kind] = { kind, pulled: 0, pushed: 0, conflicts: 0 };
  }

  const settings = useSettingsStore.getState().settings;
  const deviceId = settings.replicaDeviceId ?? 'unknown-device';
  // ── connecting ──
  onStep?.({ phase: 'connecting' });

  for (const kind of kinds) {
    // Determine cursor
    let since: Hlc | undefined;
    if (peerId) {
      const cursors = settings.localSyncCursors?.[peerId] ?? {};
      since = cursors[kind] as Hlc | undefined;
    } else {
      const cursors = settings.lastSyncedAtReplicas ?? {};
      since = cursors[kind] as Hlc | undefined;
    }
    // USB local sync always forces full bidirectional seed — visible DB
    // changes bypass the CRDT outbox, so incremental sync would miss them.
    const isFirstSyncForKind = peerId ? (transport.kind === 'usb' ? true : !since) : false;
    // Force full pull for USB so the server scans visible tables.
    const pullCursor: Hlc | undefined = transport.kind === 'usb' ? undefined : since;

    let toPush: ReplicaRow[] = [];
    let outbox: ReplicaRow[] = [];
    let pushedRowsForCursor: ReplicaRow[] = [];

    const collectLocalRowsToPush = async (): Promise<void> => {
      outbox = drainOutboxRows(kind);
      toPush = [...outbox];

      if (isFirstSyncForKind) {
        toPush = [...toPush, ...(await seed(kind, deviceId))];
      }
    };

    const pushLocalRows = async (): Promise<void> => {
      onStep?.({ phase: 'pushing', kind, current: toPush.length });
      if (toPush.length === 0) return;

      try {
        await transport.push(kind, toPush);
        kindsResult[kind]!.pushed = toPush.length;
        pushedRowsForCursor = toPush;

        // Push dictionary images that were in the pushed rows
        if (kind === 'dictionary-entry') {
          const appService = await environmentConfig.getAppService();
          for (const row of toPush) {
            if (row.deleted_at_ts) continue;
            const imagePathEnv = row.fields_jsonb['imagePath'] as FieldEnvelope | undefined;
            if (!imagePathEnv) continue;
            const entryId = row.replica_id.split(':').slice(1).join(':');
            try {
              const bytes = await appService.readFile(
                imagePathEnv.v as string,
                'Dictionaries',
                'binary',
              );
              await transport.pushDictionaryImage?.(entryId, bytes as ArrayBuffer);
            } catch {
              // Missing local file or read error — skip, retry next cycle.
            }
          }
        }

        // ── Write replica metadata to _replicas table ──
        if (dbPath) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            for (const row of toPush) {
              await invoke('write_replica_metadata', { row_json: row, db_path: dbPath });
            }
          } catch (err) {
            console.warn(
              '[sync] write_replica_metadata invoke failed, skipping metadata write',
              err,
            );
          }
        }
      } catch (err: unknown) {
        const msg = errorMessageFromUnknown(err);
        errors.push({
          peerId: peerId ?? 'unknown',
          kind,
          timestamp: Date.now(),
          message: msg,
        });
        // Restore outbox rows for retry.
        restoreOutboxRows(kind, outbox);
      }
    };

    if (transport.kind === 'usb') {
      await collectLocalRowsToPush();
      // ── Filter unchanged replicas before pushing ──
      toPush = await filterUnchangedViaInvoke(toPush, kind, dbPath);
      await pushLocalRows();
    }

    // ── 1. Pull ──
    let remoteRows: ReplicaRow[] = [];
    try {
      remoteRows = await transport.pull(kind, pullCursor);
      onStep?.({ phase: 'pulling', kind, current: remoteRows.length });
    } catch (err: unknown) {
      const msg = errorMessageFromUnknown(err);
      errors.push({
        peerId: peerId ?? 'unknown',
        kind,
        timestamp: Date.now(),
        message: msg,
      });
      continue; // Try next kind
    }

    // ── Filter unchanged replicas after pull, before applying locally ──
    remoteRows = await filterUnchangedViaInvoke(remoteRows, kind, dbPath);

    // ── 2. Apply remote rows locally ──
    if (remoteRows.length > 0) {
      onStep?.({ phase: 'merging', kind, current: remoteRows.length });
      for (const row of remoteRows) {
        switch (kind) {
          case 'annotation':
            useAnotacionesStore.getState().applyRemoteAnnotation(row);
            break;
          case 'quote':
            useCitasStore.getState().applyRemoteQuote(row);
            break;
          case 'dictionary-entry': {
            const dictStore = useDictionaryStore.getState();
            dictStore.applyRemoteDictionaryEntry(row);
            dictStore.applyRemoteDictionaryOccurrence(row);
            break;
          }
          case 'dictionary-occurrence':
            useDictionaryStore.getState().applyRemoteDictionaryOccurrence(row);
            break;
          default:
            break;
        }
      }

      kindsResult[kind]!.pulled = remoteRows.length;

      // Dictionary image sync — validate against manifest and surface retryable errors
      if (kind === 'dictionary-entry') {
        const appService = await environmentConfig.getAppService();
        for (const row of remoteRows) {
          if (row.deleted_at_ts) continue;
          const imagePathEnv = row.fields_jsonb['imagePath'] as FieldEnvelope | undefined;
          if (!imagePathEnv) continue;
          const entryId = row.replica_id.split(':').slice(1).join(':');

          try {
            const localExists = await appService
              .readFile(imagePathEnv.v as string, 'Dictionaries', 'binary')
              .then(() => true)
              .catch(() => false);
            if (!localExists) {
              const imageBytes = await transport.pullDictionaryImage?.(entryId);
              if (!imageBytes) {
                errors.push({
                  peerId: peerId ?? 'unknown',
                  kind,
                  timestamp: Date.now(),
                  message: `Dictionary image not available on peer: ${entryId}`,
                });
                continue;
              }
              // Validate against manifest metadata if present
              const manifest = manifestFromRow(row);
              if (manifest) {
                const { valid, error: integrityError } = await verifyImageManifest(
                  imageBytes,
                  manifest,
                );
                if (!valid) {
                  const errMsg = `Image integrity failed for ${entryId}: ${integrityError}`;
                  errors.push({
                    peerId: peerId ?? 'unknown',
                    kind,
                    timestamp: Date.now(),
                    message: errMsg,
                  });
                  continue;
                }
              }
              await appService.writeFile(imagePathEnv.v as string, 'Dictionaries', imageBytes);
            }
          } catch (err: unknown) {
            const msg = errorMessageFromUnknown(err);
            errors.push({
              peerId: peerId ?? 'unknown',
              kind,
              timestamp: Date.now(),
              message: `Dictionary image sync error for ${entryId}: ${msg}`,
            });
          }
        }
      }
    }

    if (transport.kind !== 'usb') {
      // ── 3. Collect local rows to push ──
      await collectLocalRowsToPush();
      // ── Filter unchanged replicas before pushing ──
      toPush = await filterUnchangedViaInvoke(toPush, kind, dbPath);
      // ── 4. Push ──
      await pushLocalRows();
    }

    // ── 5. Advance cursor ──
    let maxHLC: Hlc | undefined = since;
    for (const row of remoteRows) {
      if (!maxHLC || row.updated_at_ts > maxHLC) {
        maxHLC = row.updated_at_ts;
      }
    }
    for (const row of pushedRowsForCursor) {
      if (!maxHLC || row.updated_at_ts > maxHLC) {
        maxHLC = row.updated_at_ts;
      }
    }
    if (peerId && maxHLC && maxHLC !== since) {
      const latest = useSettingsStore.getState().settings;
      const next = {
        ...latest,
        localSyncCursors: {
          ...latest.localSyncCursors,
          [peerId]: {
            ...(latest.localSyncCursors?.[peerId] ?? {}),
            [kind]: maxHLC,
          },
        },
      };
      useSettingsStore.getState().setSettings(next);
      useSettingsStore.getState().saveSettings(environmentConfig, next);
    } else if (!peerId && maxHLC && maxHLC !== since) {
      // Backward compat: update lastSyncedAtReplicas when peerId is absent
      const latest = useSettingsStore.getState().settings;
      const next = {
        ...latest,
        lastSyncedAtReplicas: {
          ...latest.lastSyncedAtReplicas,
          [kind]: maxHLC,
        },
      };
      useSettingsStore.getState().setSettings(next);
      useSettingsStore.getState().saveSettings(environmentConfig, next);
    }
  }

  // ── USB book sync ─────────────────────────────────────────────────
  // Sync EPUB files, covers, and reading configs between devices.
  // Runs after CRDT kinds so book metadata is already reconciled.
  if (transport.kind === 'usb') {
    onStep?.({ phase: 'syncing-books' });
    try {
      const appService = await environmentConfig.getAppService();
      const { syncUsbBooks, createUsbBookFileService } = await import(
        '@/services/sync/usbBookSync'
      );
      const fileService = createUsbBookFileService(appService);
      const bookResult = await syncUsbBooks(transport, fileService);
      if (bookResult.errors.length > 0) {
        for (const err of bookResult.errors) {
          errors.push({
            peerId: peerId ?? 'unknown',
            kind: 'book',
            timestamp: Date.now(),
            message: err,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({
        peerId: peerId ?? 'unknown',
        kind: 'book',
        timestamp: Date.now(),
        message: msg,
      });
    }

    // Hot-reload the library store so the UI reflects tombstone
    // propagation and received books immediately, without a page refresh.
    try {
      const appService = await environmentConfig.getAppService();
      const updatedBooks = await appService.loadLibraryBooks();
      const { useLibraryStore } = await import('@/store/libraryStore');
      useLibraryStore.getState().setLibrary(updatedBooks);
    } catch {
      /* best-effort: store reload is cosmetic */
    }
  }

  // ── finalizing ──
  onStep?.({ phase: 'finalizing' });

  return {
    peerId: peerId ?? 'unknown',
    kinds: kindsResult,
    errors,
    startedAt,
    finishedAt: Date.now(),
  };
}
