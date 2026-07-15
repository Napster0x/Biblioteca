/**
 * USB discovery hook.
 *
 * Shared blackboard via /api/dev-sync/pair:
 * - POST { deviceId, searching, syncing, progress, runId }  → declare state
 * - GET  ?deviceId=X                                        → read the OTHER device's state
 * - DELETE { deviceId }                                     → cancel
 *
 * Both devices must be searching simultaneously for pairing.
 * Syncing state is mirrored bidirectionally: when either device
 * starts syncing, the other sees it on the next poll and follows.
 *
 * Desktop runs the sync directly via `runSyncCycle` (USBHttpTransport to
 * localhost:7878), which avoids the SQLite lock that the old sync-trigger
 * `sync-execute.mjs` approach hit. Progress is reported through the pair
 * blackboard so both devices see it. Android polls the blackboard to mirror
 * the desktop's progress.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { USBHttpTransport } from '@/services/sync/USBHttpTransport';
import { runSyncCycle, ALL_KINDS } from '@/services/sync/localSyncUtils';
import { refreshUsbSyncedStores } from '@/services/sync/refreshUsbSyncedStores';
import type { SyncStep } from '@/types/replica';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsbDiscoveryState = 'idle' | 'searching' | 'paired' | 'syncing';

export interface DiscoveredUsbDevice {
  found: boolean;
  serial: string | null;
  model: string | null;
  healthOk: boolean;
  healthDetail: string | null;
  error: string | null;
}

export interface UsbDiscoveryResult {
  state: UsbDiscoveryState;
  device: DiscoveredUsbDevice | null;
  lastError: string | null;
  progress: number;
  startSearching: () => void;
  cancelSearching: () => void;
  startSync: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_FAST_MS = 2000;
const SYNC_DONE_GRACE_MS = POLL_FAST_MS + 1000;
const POLL_SLOW_MS = 4000; // must be < WINDOW_MS (5000) in route.ts
const BASE = 'http://127.0.0.1:3000';
const PAIR_URL = '/api/dev-sync/pair';
const ANDROID_HEALTH = 'http://127.0.0.1:7878/health';
const DESKTOP_HEALTH = `${BASE}/api/dev-sync/health`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|wv/.test(navigator.userAgent);
}

function getDeviceId(): string {
  return isAndroid() ? 'android' : 'desktop';
}

function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  return fetch(url, { ...init, signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .finally(() => clearTimeout(t));
}

// ---------------------------------------------------------------------------
// Pairing blackboard
// ---------------------------------------------------------------------------

interface BlackboardResult {
  paired: boolean;
  syncing: boolean;
  progress: number;
  runId: string | null;
  syncDone: boolean;
}

async function postState(
  deviceId: string,
  state: UsbDiscoveryState,
  progress: number,
  runId: string | null,
): Promise<BlackboardResult> {
  try {
    const searching = state === 'searching' || state === 'paired';
    const syncing = state === 'syncing';
    const r = (await fetchJson(PAIR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, searching, syncing, progress, runId }),
    })) as {
      paired?: boolean;
      syncing?: boolean;
      progress?: number;
      runId?: string;
      syncDone?: boolean;
    };
    return {
      paired: r.paired === true,
      syncing: r.syncing === true,
      progress: typeof r.progress === 'number' ? r.progress : 0,
      runId: typeof r.runId === 'string' ? r.runId : null,
      syncDone: r.syncDone === true,
    };
  } catch {
    return { paired: false, syncing: false, progress: 0, runId: null, syncDone: false };
  }
}

async function postSyncDone(deviceId: string): Promise<void> {
  try {
    await fetchJson(PAIR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        searching: false,
        syncing: false,
        progress: 100,
        syncDone: true,
      }),
    });
  } catch {
    /* best-effort */
  }
}

async function cancelState(deviceId: string): Promise<void> {
  try {
    await fetchJson(PAIR_URL, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Device discovery
// ---------------------------------------------------------------------------

async function discoverDevice(): Promise<DiscoveredUsbDevice | null> {
  if (!isAndroid()) {
    try {
      const r = await invoke<DiscoveredUsbDevice>('discover_usb_device');
      if (r?.found) return r;
    } catch {
      /* fall through */
    }
  }

  try {
    const r = (await fetchJson(ANDROID_HEALTH)) as Record<string, unknown>;
    if (r) {
      return {
        found: true,
        serial: null,
        model: (r['deviceName'] as string) ?? (r['device_name'] as string) ?? null,
        healthOk: true,
        healthDetail: JSON.stringify(r),
        error: null,
      };
    }
  } catch {
    /* next */
  }

  try {
    const r = (await fetchJson(DESKTOP_HEALTH)) as Record<string, unknown>;
    if (r) {
      return {
        found: true,
        serial: null,
        model: (r['controlPlane'] as string) ?? (r['version'] as string) ?? 'Desktop',
        healthOk: true,
        healthDetail: JSON.stringify(r),
        error: null,
      };
    }
  } catch {
    /* neither reachable */
  }

  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUsbDiscovery(): UsbDiscoveryResult {
  const [state, setState] = useState<UsbDiscoveryState>('idle');
  const [device, setDevice] = useState<DiscoveredUsbDevice | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const deviceIdRef = useRef(getDeviceId());
  const stateRef = useRef<UsbDiscoveryState>('idle');
  const progressRef = useRef(0);
  const runIdRef = useRef<string | null>(null);

  // ── sync ref + React state atomically ──────────────────────────
  const transition = useCallback((next: UsbDiscoveryState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // ── fire actual sync cycle (desktop only) ──────────────────────
  const fireSyncCycle = useCallback(() => {
    void (async () => {
      try {
        const transport = new USBHttpTransport(7878);
        const onStep = (step: SyncStep): void => {
          let pct: number;
          switch (step.phase) {
            case 'connecting':
              pct = 5;
              break;
            case 'pushing':
              pct = 30;
              break;
            case 'pulling':
            case 'merging':
              pct = 60;
              break;
            case 'syncing-books':
              pct = 80;
              break;
            case 'finalizing':
              pct = 95;
              break;
            default:
              return;
          }
          progressRef.current = pct;
          setProgress(pct);
          void postState(deviceIdRef.current, 'syncing', pct, null);
        };

        await runSyncCycle(transport, ALL_KINDS, undefined, onStep);
        await refreshUsbSyncedStores();

        stopPolling();
        setProgress(100);
        progressRef.current = 100;
        runIdRef.current = null;
        await postSyncDone(deviceIdRef.current);
        setTimeout(async () => {
          await cancelState(deviceIdRef.current);
        }, SYNC_DONE_GRACE_MS);
        transition('idle');
      } catch (err) {
        setLastError(err instanceof Error ? err.message : 'Sync failed');
        stopPolling();
        await cancelState(deviceIdRef.current);
        transition('idle');
      }
    })();
  }, []);

  // ── polling tick (pair blackboard) ────────────────────────────
  const tick = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      const deviceId = deviceIdRef.current;
      const currentS = stateRef.current;
      const result = await postState(deviceId, currentS, progressRef.current, runIdRef.current);

      // POST already returns the other device's state — no GET needed.
      // The backend acts as a blackboard: POST writes our state AND reads theirs.

      if (result.syncing) {
        // Other device is syncing — mirror its state
        if (stateRef.current !== 'syncing') {
          transition('syncing');
          if (result.runId) {
            runIdRef.current = result.runId;
          }
          // If WE are the desktop and the OTHER device (Android) started
          // syncing, WE must actually run the sync engine.
          if (!isAndroid()) {
            fireSyncCycle();
          }
        }
        // Always mirror progress from the initiator via blackboard.
        // The initiator pushes to blackboard every poll tick; the follower
        // must track it continuously — not just on initial transition.
        if (result.progress > 0) {
          progressRef.current = result.progress;
          setProgress(result.progress);
        }
        setLastError(null);
      } else if (result.syncDone) {
        // Initiator signaled sync is done
        if (stateRef.current === 'syncing') {
          setProgress(100);
          progressRef.current = 100;
          runIdRef.current = null;
          await refreshUsbSyncedStores();
          transition('idle');
        }
      } else if (result.paired) {
        // Other device is searching or paired
        if (stateRef.current === 'syncing') {
          // In syncing but initiator is no longer signaling syncing — still
          // paired, so the initiator is alive. Keep syncing with fallback:
          // the initiator will eventually send syncDone or disappear.
          setLastError(null);
        } else {
          transition('paired');
          setLastError(null);
          // Refresh device info
          const dev = await discoverDevice();
          if (dev?.found) setDevice(dev);
        }
      } else if (currentS === 'paired') {
        // Other device disappeared while paired — go back to searching
        transition('searching');
        setLastError('Waiting for the other device to start searching...');
      } else if (currentS === 'syncing') {
        // Follower lost contact with initiator — return to idle so we
        // don't get stuck in syncing state forever.
        setLastError('Sync connection lost.');
        runIdRef.current = null;
        transition('idle');
      }
      // else: searching → stay searching, no-op
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
    }
  }, []);

  // ── polling control ───────────────────────────────────────────
  const startPolling = useCallback(
    (intervalMs: number) => {
      if (pollRef.current) clearInterval(pollRef.current);
      void tick();
      pollRef.current = setInterval(() => void tick(), intervalMs);
    },
    [tick],
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── public API ─────────────────────────────────────────────────
  const startSearching = useCallback(() => {
    transition('searching');
    setLastError(null);
    setDevice(null);
    setProgress(0);
    progressRef.current = 0;
    startPolling(POLL_FAST_MS);
  }, [startPolling]);

  const cancelSearching = useCallback(() => {
    stopPolling();
    void cancelState(deviceIdRef.current);
    transition('idle');
    setLastError(null);
    setProgress(0);
    progressRef.current = 0;
    runIdRef.current = null;
  }, [stopPolling]);

  const startSync = useCallback(() => {
    transition('syncing');
    setProgress(0);
    progressRef.current = 0;
    runIdRef.current = null;
    setLastError(null);

    if (!isAndroid()) {
      fireSyncCycle();
    }
    // Android: transitions to syncing; desktop will pick it up via the
    // pair blackboard and fire the real sync cycle.
  }, [fireSyncCycle]);

  // ── adjust polling rate on state change ───────────────────────
  useEffect(() => {
    if (state === 'idle') {
      // Stop polling when transitioning to idle from any path
      // (cancelSearching, sync-complete, or connection-lost).
      stopPolling();
    } else if (state === 'paired') {
      startPolling(POLL_SLOW_MS);
    } else if (state === 'syncing') {
      startPolling(POLL_FAST_MS);
    } else if (state === 'searching') {
      // When the tick detects unpairing and transitions to searching,
      // restart fast polling so recovery doesn't wait for a slow interval.
      startPolling(POLL_FAST_MS);
    }
  }, [state, startPolling, stopPolling]);

  // ── cleanup on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopPolling();
      void cancelState(deviceIdRef.current);
    };
  }, [stopPolling]);

  return {
    state,
    device,
    lastError,
    progress,
    startSearching,
    cancelSearching,
    startSync,
  };
}
