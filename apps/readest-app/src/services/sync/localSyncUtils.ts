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
import { USBHttpTransport } from '@/services/sync/USBHttpTransport';
import environmentConfig from '@/services/environment';
import {
  defaultVisibleSeedProvider,
  type VisibleSeedProvider,
} from '@/services/sync/visibleSeedRepository';

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

const ALL_KINDS: readonly SyncCategory[] = ['annotation', 'quote', 'dictionary-entry'];

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
  seedProvider: VisibleSeedProvider = defaultVisibleSeedProvider,
): Promise<SyncResult> {
  const startedAt = Date.now();
  const errors: SyncError[] = [];
  const kindsResult: Record<string, { kind: SyncCategory; pulled: number; pushed: number }> = {};

  // Initialize result entries
  for (const kind of kinds) {
    kindsResult[kind] = { kind, pulled: 0, pushed: 0 };
  }

  const settings = useSettingsStore.getState().settings;
  const deviceId = settings.replicaDeviceId ?? 'unknown-device';
  const isFirstSync = peerId ? !settings.localSyncCursors?.[peerId] : false;

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

    // ── 1. Pull ──
    let remoteRows: ReplicaRow[] = [];
    try {
      remoteRows = await transport.pull(kind, since);
      onStep?.({ phase: 'pulling', kind, current: remoteRows.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({
        peerId: peerId ?? 'unknown',
        kind,
        timestamp: Date.now(),
        message: msg,
      });
      continue; // Try next kind
    }

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
        }
      }

      kindsResult[kind]!.pulled = remoteRows.length;

      // Dictionary image sync (same as before — best-effort)
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
              if (imageBytes) {
                await appService.writeFile(imagePathEnv.v as string, 'Dictionaries', imageBytes);
              }
            }
          } catch {
            // Best-effort image sync
          }
        }
      }
    }

    // ── 3. Collect local rows to push ──
    let toPush: ReplicaRow[] = [];
    let outbox: ReplicaRow[] = [];

    // Drain outbox for this kind
    switch (kind) {
      case 'annotation':
        outbox = [...useAnotacionesStore.getState().replicaOutbox];
        useAnotacionesStore.setState({ replicaOutbox: [] });
        break;
      case 'quote':
        outbox = [...useCitasStore.getState().replicaOutbox];
        useCitasStore.setState({ replicaOutbox: [] });
        break;
      case 'dictionary-entry':
        outbox = [...useDictionaryStore.getState().replicaOutbox];
        useDictionaryStore.setState({ replicaOutbox: [] });
        break;
    }

    // Always push outbox rows (incremental changes)
    toPush = [...outbox];

    // On first sync, additionally push ALL local replicas (seed)
    if (isFirstSync) {
      toPush = [...toPush, ...(await seedProvider(kind, deviceId))];
    }

    // ── 4. Push ──
    onStep?.({ phase: 'pushing', kind, current: toPush.length });
    if (toPush.length > 0) {
      try {
        await transport.push(kind, toPush);
        kindsResult[kind]!.pushed = toPush.length;

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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({
          peerId: peerId ?? 'unknown',
          kind,
          timestamp: Date.now(),
          message: msg,
        });
        // Restore outbox rows for retry
        if (outbox.length > 0) {
          switch (kind) {
            case 'annotation':
              useAnotacionesStore.setState({
                replicaOutbox: [...useAnotacionesStore.getState().replicaOutbox, ...outbox],
              });
              break;
            case 'quote':
              useCitasStore.setState({
                replicaOutbox: [...useCitasStore.getState().replicaOutbox, ...outbox],
              });
              break;
            case 'dictionary-entry':
              useDictionaryStore.setState({
                replicaOutbox: [...useDictionaryStore.getState().replicaOutbox, ...outbox],
              });
              break;
          }
        }
      }
    }

    // ── 5. Advance cursor ──
    let maxHLC: Hlc | undefined = since;
    for (const row of remoteRows) {
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
