/**
 * localSyncUtils — sync utilities for local peer-to-peer Wi-Fi/USB sync.
 *
 * Provides standalone functions that replicate `useReplicaSync`'s sync cycle
 * logic but accept a transport directly, enabling per-peer progress tracking.
 */
import type { ReplicaRow, Hlc, FieldEnvelope } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';
import type { SyncTransport } from '@/services/sync/SyncTransport';
import type { PeerInfo } from '@/types/settings';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import { useCitasStore } from '@/store/citasStore';
import { useDictionaryStore } from '@/store/dictionaryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { peerKey, type PeerKey } from '@/store/localSyncStore';
import { WiFiHttpTransport } from '@/services/sync/WiFiHttpTransport';
import { USBHttpTransport } from '@/services/sync/USBHttpTransport';
import environmentConfig from '@/services/environment';

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
    // USB peers (ADB tunnel) legitimately report localhost — allow them.
    // WiFi peers on localhost are our own device and must be excluded.
    if (p.kind !== 'usb') {
      if (p.host === 'localhost' || p.host === '127.0.0.1' || p.host === '::1') return false;
    }
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
 * Uses peer.kind to determine transport: 'usb' → USBHttpTransport, 'wifi' (or absent) → WiFiHttpTransport.
 */
export function createPeerTransport(peer: PeerInfo): SyncTransport {
  if (peer.kind === 'usb') {
    return new USBHttpTransport(peer.port);
  }
  return new WiFiHttpTransport(peer.host, peer.port);
}

// ---------------------------------------------------------------------------
// runSyncCycle
// ---------------------------------------------------------------------------

const ALL_KINDS: readonly SyncCategory[] = ['annotation', 'quote', 'dictionary-entry'];

/**
 * Run one full sync cycle for the given kinds via a transport.
 *
 * Per kind:
 *   1. Pull remote rows
 *   2. Apply locally
 *   3. Drain outbox
 *   4. Push outbox
 *   5. Advance HLC cursor
 */
export async function runSyncCycle(
  transport: SyncTransport,
  kinds: readonly SyncCategory[] = ALL_KINDS,
): Promise<void> {
  for (const kind of kinds) {
    // Determine cursor
    const settings = useSettingsStore.getState().settings;
    const cursors = settings.lastSyncedAtReplicas ?? {};
    const since = cursors[kind] as Hlc | undefined;

    // 1. Pull
    let remoteRows: ReplicaRow[];
    try {
      remoteRows = await transport.pull(kind, since);
    } catch {
      console.warn(`[localSync] pull failed for ${kind}, skipping`);
      continue;
    }

    // 2. Apply each remote row locally
    if (remoteRows.length > 0) {
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

      // Dictionary image sync
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

    // 3. Drain outbox for this kind
    let outbox: ReplicaRow[];
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
      default:
        return;
    }

    // 4. Push
    if (outbox.length > 0) {
      try {
        await transport.push(kind, outbox);

        // Push dictionary images that were in the outbox
        if (kind === 'dictionary-entry') {
          const appService = await environmentConfig.getAppService();
          for (const row of outbox) {
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
      } catch {
        // Push failed — put rows back for retry
        console.warn(`[localSync] push failed for ${kind}, rows kept in outbox`);
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

    // 5. Advance cursor to max observed HLC
    let maxHLC: Hlc | undefined = since;
    for (const row of remoteRows) {
      if (!maxHLC || row.updated_at_ts > maxHLC) {
        maxHLC = row.updated_at_ts;
      }
    }
    if (maxHLC && maxHLC !== since) {
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
}
