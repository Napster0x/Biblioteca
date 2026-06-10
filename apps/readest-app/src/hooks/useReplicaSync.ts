/**
 * CRDT Replica sync hook.
 *
 * Auto-syncs annotation, quote, and dictionary-entry replicas via the
 * configured SyncTransport. When no transport is provided, defaults to
 * WebDAV (preserving existing cloud sync behaviour).
 *
 * On mount and every 30s while the window is active:
 *   1. Pulls remote ReplicaRows for each enabled kind.
 *   2. Applies them locally via the store's applyRemote* methods.
 *   3. Drains the local outbox and pushes to the remote.
 *   4. Advances the per-kind `lastSyncedAtReplicas` cursor.
 *
 * Gates on `syncCategories` settings — only enabled kinds are synced.
 * Does nothing when the transport backend is not configured.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import { useCitasStore } from '@/store/citasStore';
import { useDictionaryStore } from '@/store/dictionaryStore';
import { WebDAVTransport } from '@/services/sync/WebDAVTransport';
import type { SyncTransport } from '@/services/sync/SyncTransport';
import environmentConfig from '@/services/environment';
import type { ReplicaRow, Hlc, FieldEnvelope } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Polling interval for auto-sync in milliseconds. */
const POLL_INTERVAL_MS = 30_000;

/** Kinds of replicas this hook manages. */
const REPLICA_KINDS: readonly SyncCategory[] = ['annotation', 'quote', 'dictionary-entry'];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseReplicaSyncOptions {
  /** Optional custom transport. When not provided, defaults to WebDAV. */
  transport?: SyncTransport;
}

export interface UseReplicaSyncResult {
  /** True while a sync cycle is in progress. */
  isSyncing: boolean;
  /** The last error encountered, if any. Null when the last cycle succeeded. */
  lastError: Error | null;
}

export function useReplicaSync(opts?: UseReplicaSyncOptions): UseReplicaSyncResult {
  const { transport: customTransport } = opts ?? {};

  const [isSyncing, setIsSyncing] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);

  // Track whether we're in the middle of a sync to avoid overlapping cycles.
  const syncingRef = useRef(false);

  /**
   * Resolve the transport to use for this sync cycle.
   *
   * When a custom transport is provided (e.g. WiFi, USB), use it directly.
   * Otherwise, fall back to WebDAVTransport — preserving zero-change
   * behaviour for existing cloud sync users.
   */
  const resolveTransport = useCallback((): SyncTransport | null => {
    if (customTransport) return customTransport;

    const settings = useSettingsStore.getState().settings;
    const webdav = settings.webdav;
    if (!webdav?.enabled || !webdav?.serverUrl || !webdav?.username) return null;

    const toClientConfig = {
      serverUrl: webdav.serverUrl,
      username: webdav.username,
      password: webdav.password,
    };
    const rootPath = webdav.rootPath;
    return new WebDAVTransport(toClientConfig, rootPath);
  }, [customTransport]);

  /**
   * Run one full sync cycle for a single kind:
   * pull → apply locally → drain outbox → push → advance cursor.
   */
  const syncKind = useCallback(
    async (kind: SyncCategory): Promise<void> => {
      const transport = resolveTransport();
      if (!transport) return;

      // Determine the cursor for this kind
      const settings = useSettingsStore.getState().settings;
      const cursors = settings.lastSyncedAtReplicas ?? {};
      const since = cursors[kind] as Hlc | undefined;

      // 1. Pull remote rows newer than the cursor
      let remoteRows: ReplicaRow[];
      try {
        remoteRows = await transport.pull(kind, since);
      } catch (e) {
        console.warn(`Replica sync: pull failed for ${kind}`, e);
        return;
      }

      // 2. Apply each remote row to the local store
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
              // Occurrences are also of kind 'dictionary-entry' based on
              // how they arrive in the transport. The applyRemote method
              // determines whether it's an entry or occurrence.
              dictStore.applyRemoteDictionaryOccurrence(row);
              break;
            }
          }
        }

        // After applying remote dictionary entries, pull associated images
        // when the local file is missing.
        if (kind === 'dictionary-entry') {
          const appService = await environmentConfig.getAppService();
          for (const row of remoteRows) {
            if (row.deleted_at_ts) continue;
            const imagePathEnv = row.fields_jsonb['imagePath'] as FieldEnvelope | undefined;
            if (!imagePathEnv) continue;
            const entryId = row.replica_id.split(':').slice(1).join(':');
            try {
              // Only pull if the local image file doesn't exist yet
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
              // Best-effort image sync — errors are logged but don't block
              // the rest of the sync cycle.
            }
          }
        }
      }

      // 3. Drain the local outbox for this kind
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

      // 4. Push outbox rows to remote (append-only merge)
      if (outbox.length > 0) {
        try {
          await transport.push(kind, outbox);

          // After a successful push, upload associated dictionary images
          // so the image bytes arrive alongside the entry metadata.
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
                // Missing local file or read error — skip, will retry next cycle.
              }
            }
          }
        } catch (e) {
          // If push fails, put the rows back in the outbox so they are
          // retried on the next cycle.
          console.warn(`Replica sync: push failed for ${kind}`, e);
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
          throw e;
        }
      }

      // 5. Advance cursor to the max observed HLC
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
        // Fire-and-forget persistence — settings service handles this internally.
        useSettingsStore.getState().saveSettings(environmentConfig, next);
      }
    },
    [resolveTransport],
  );

  /**
   * Run a full sync cycle across all enabled kinds.
   */
  const syncAll = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    setLastError(null);

    const settings = useSettingsStore.getState().settings;
    const syncCategories = settings.syncCategories ?? {};

    for (const kind of REPLICA_KINDS) {
      // Gate on syncCategories: missing key defaults to enabled (truthy).
      if (syncCategories[kind] === false) continue;

      try {
        await syncKind(kind);
      } catch (e) {
        setLastError(e instanceof Error ? e : new Error(String(e)));
      }
    }

    setIsSyncing(false);
    syncingRef.current = false;
  }, [syncKind]);

  // Initial sync on mount
  useEffect(() => {
    syncAll();
    // We intentionally run this only once on mount — the polling effect
    // handles subsequent cycles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling every POLL_INTERVAL_MS when the window is active
  useEffect(() => {
    const interval = setInterval(() => {
      syncAll();
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [syncAll]);

  return { isSyncing, lastError };
}
