'use client';

import { useEffect, useRef } from 'react';
import { runSyncCycle, createPeerTransport } from '@/services/sync/localSyncUtils';
import type { PeerInfo, SyncCategory } from '@/types/settings';

const USB_PEER: PeerInfo = {
  kind: 'usb',
  host: 'localhost',
  port: 7878,
  deviceName: 'Android',
  version: '1.0.0',
};

const ALL_KINDS = ['annotation', 'quote', 'dictionary-entry', 'dictionary-occurrence'] as const;

export interface DebugSyncTriggerEnv {
  nodeEnv?: string;
  devHarness?: string;
}

interface DebugSyncTriggerProps {
  env?: DebugSyncTriggerEnv;
  userAgent?: string;
}

interface SyncKindEvidence {
  pulled?: number;
  pushed?: number;
  cursor?: string;
}

type SyncResultEvidence = Awaited<ReturnType<typeof runSyncCycle>> & {
  kinds?: Record<string, SyncKindEvidence>;
  kindsResult?: Record<string, SyncKindEvidence>;
};

function defaultDebugSyncEnv(): DebugSyncTriggerEnv {
  return {
    nodeEnv: process.env.NODE_ENV,
    devHarness: process.env['NEXT_PUBLIC_BIBLIOTECA_DEV_SYNC_HARNESS'],
  };
}

export function shouldEnableDebugSyncTrigger(env: DebugSyncTriggerEnv, userAgent: string): boolean {
  const isAndroid = /Android/i.test(userAgent);
  if (isAndroid) return false;
  return env.nodeEnv === 'development' || env.devHarness === '1';
}

function syncKindResults(result: SyncResultEvidence): Record<string, SyncKindEvidence> {
  return result.kindsResult ?? result.kinds ?? {};
}

function changedKindsFrom(result: SyncResultEvidence): SyncCategory[] {
  const kinds = syncKindResults(result);
  return ALL_KINDS.filter((kind) => {
    const kindResult = kinds[kind];
    return (kindResult?.pulled ?? 0) > 0 || (kindResult?.pushed ?? 0) > 0;
  });
}

function cursorEvidenceFrom(
  result: SyncResultEvidence,
  triggerCounter: number,
): Record<string, string> {
  const kinds = syncKindResults(result);
  return {
    triggerCounter: String(triggerCounter),
    ...Object.fromEntries(ALL_KINDS.map((kind) => [kind, kinds[kind]?.cursor ?? 'not-reported'])),
  };
}

/**
 * Debug component: polls a trigger counter endpoint.
 * Increment the counter from the terminal to force sync.
 *
 *   curl -X POST http://localhost:3000/api/sync-trigger
 */
export function DebugSyncTrigger({
  env = defaultDebugSyncEnv(),
  userAgent,
}: DebugSyncTriggerProps = {}) {
  const lastCount = useRef(-1);
  const syncingRef = useRef(false);

  useEffect(() => {
    const resolvedUserAgent =
      userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
    if (!shouldEnableDebugSyncTrigger(env, resolvedUserAgent)) return;

    console.info('[DebugSync] Mounted');
    fetch('/api/reload-ping', { method: 'POST' }).catch(() => {});
    const poll = async () => {
      if (syncingRef.current) return;
      try {
        const res = await fetch('/api/sync-trigger');
        if (!res.ok) return;
        const payload = (await res.json()) as { count?: unknown };
        if (typeof payload.count !== 'number') return;
        const { count } = payload;
        if (lastCount.current < 0) {
          console.info('[DebugSync] Initial count:', count);
        }
        if (lastCount.current >= 0 && count > lastCount.current) {
          console.info('[DebugSync] Trigger detected! count=', count);
          syncingRef.current = true;
          console.info('[DebugSync] Starting sync cycle...');

          const transport = createPeerTransport(USB_PEER);
          const peerId = `usb:${USB_PEER.host}:${USB_PEER.port}`;
          try {
            const result = await runSyncCycle(transport, ALL_KINDS, peerId);
            const syncResult = result as SyncResultEvidence;
            const kindResults = syncKindResults(syncResult);
            const lines = ALL_KINDS.map((k) => {
              const r = kindResults[k];
              return `${k}: ↓${r?.pulled ?? 0} ↑${r?.pushed ?? 0}`;
            });
            console.info('[DebugSync] Done:', lines.join(' | '));
            const evidence = {
              runId: `debug-sync-count-${count}`,
              timestamp: new Date().toISOString(),
              peer: peerId,
              direction: 'bidirectional-local-usb',
              changedKinds: changedKindsFrom(syncResult),
              cursors: cursorEvidenceFrom(syncResult, count),
              outcome: result.errors.length > 0 ? 'error' : 'success',
              errors: result.errors,
            };
            console.info('[DebugSync] evidence', evidence);
            // Persist evidence to a file-based log for terminal inspection
            fetch('/api/sync-trigger/log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(evidence),
            }).catch(() => {});
            if (result.errors.length > 0) {
              console.warn('[DebugSync] Errors:', result.errors);
            }
          } catch (syncErr) {
            console.error('[DebugSync] Sync failed:', syncErr);
          } finally {
            syncingRef.current = false;
          }
        }
        lastCount.current = count;
      } catch (err) {
        console.error('[DebugSync] Poll error:', err);
      }
    };

    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [env, userAgent]);

  return null;
}
