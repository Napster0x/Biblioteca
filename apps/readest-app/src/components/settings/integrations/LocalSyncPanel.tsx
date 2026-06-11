import clsx from 'clsx';
import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { RiWifiLine } from 'react-icons/ri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLocalSyncStore, peerKey } from '@/store/localSyncStore';
import { isTauriAppPlatform } from '@/services/environment';
import {
  filterReachablePeers,
  createPeerTransport,
  runSyncCycle,
} from '@/services/sync/localSyncUtils';
import SubPageHeader from '../SubPageHeader';
import { BoxedList, SettingsRow, SettingsSwitchRow } from '../primitives';
import type { PeerInfo, SyncCategory } from '@/types/settings';
import type { SyncResult, SyncStep, SyncPhase } from '@/types/replica';

interface LocalSyncPanelProps {
  onBack: () => void;
}

// ── 4-state sync UI reducer ────────────────────────────────────────────

type SyncUIState = 'idle' | 'syncing' | 'success' | 'error';

export interface SyncUI {
  state: SyncUIState;
  progress: SyncStep | null;
  result: SyncResult | null;
  errorPeerId: string;
  errorMessage: string;
  lastSyncedAt: Date | null;
  lastSyncSummary: string;
}

type SyncAction =
  | { type: 'START_SYNC' }
  | { type: 'SYNC_STEP'; step: SyncStep }
  | { type: 'SYNC_DONE'; result: SyncResult; lastSyncedAt: Date; summary: string }
  | { type: 'SYNC_ERROR'; peerId: string; message: string }
  | { type: 'DISMISS' };

function initialSyncUI(
  lastSyncedAt: number | undefined,
  lastSyncSummary: string | undefined,
): SyncUI {
  return {
    state: 'idle',
    progress: null,
    result: null,
    errorPeerId: '',
    errorMessage: '',
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt) : null,
    lastSyncSummary: lastSyncSummary ?? '',
  };
}

export function syncUIReducer(state: SyncUI, action: SyncAction): SyncUI {
  switch (action.type) {
    case 'START_SYNC':
      return {
        ...state,
        state: 'syncing',
        progress: { phase: 'connecting' },
        result: null,
        errorPeerId: '',
        errorMessage: '',
      };
    case 'SYNC_STEP':
      return { ...state, state: 'syncing', progress: action.step };
    case 'SYNC_DONE':
      return {
        ...state,
        state: 'success',
        progress: null,
        result: action.result,
        lastSyncedAt: action.lastSyncedAt,
        lastSyncSummary: action.summary,
      };
    case 'SYNC_ERROR':
      return {
        ...state,
        state: 'error',
        progress: null,
        result: null,
        errorPeerId: action.peerId,
        errorMessage: action.message,
      };
    case 'DISMISS':
      return {
        ...state,
        state: 'idle',
        progress: null,
        result: null,
        errorPeerId: '',
        errorMessage: '',
      };
    default:
      return state;
  }
}

const ALL_KINDS: readonly SyncCategory[] = ['annotation', 'quote', 'dictionary-entry'];

// ── Helpers ────────────────────────────────────────────────────────────

/** Derive a human-readable badge label from peer.kind, with fallback. */
function peerKindLabel(peer: PeerInfo): string {
  if (peer.kind) return peer.kind === 'usb' ? 'USB' : 'WiFi';
  // Fallback for pre-kind peers
  if (peer.host === 'localhost' || peer.host === '127.0.0.1' || peer.host === '::1') {
    return 'USB';
  }
  return 'WiFi';
}

/** Build a one-line summary string from a SyncResult. */
function buildSyncSummary(result: SyncResult): string {
  const parts: string[] = [];
  let totalPulled = 0;
  let totalPushed = 0;
  let totalConflicts = 0;
  for (const kr of Object.values(result.kinds)) {
    totalPulled += kr.pulled;
    totalPushed += kr.pushed;
    totalConflicts += kr.conflicts;
  }
  if (totalPulled > 0) parts.push(`📥 ${totalPulled}`);
  if (totalPushed > 0) parts.push(`📤 ${totalPushed}`);
  if (totalConflicts > 0) parts.push(`⚡ ${totalConflicts}`);
  parts.push(result.peerId);
  return parts.join(' — ');
}

/** Derive the dot color, aria label, and CSS from a peer's health status. */
function healthDotProps(
  reachable: boolean | undefined,
  _: (s: string) => string,
): { colorClass: string; label: string } {
  if (reachable === true) return { colorClass: 'bg-green-500', label: _('Connected') };
  if (reachable === false) return { colorClass: 'bg-red-500', label: _('Not connected') };
  return { colorClass: 'bg-gray-400', label: _('Unknown') };
}

/**
 * LocalSyncPanel — sub-page for WiFi/USB local sync configuration.
 *
 * Follows the same sub-page pattern as KOSyncForm, ReadwiseForm, etc.:
 * <SubPageHeader> breadcrumb, <BoxedList> cards for settings rows,
 * peer discovery state with reachability indicators, and manual sync.
 */
const LocalSyncPanel: React.FC<LocalSyncPanelProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const peers = useLocalSyncStore((s) => s.peers);
  const peerHealth = useLocalSyncStore((s) => s.peerHealth);

  const localSync = settings.localSync;

  const [ui, dispatch] = useReducer(
    syncUIReducer,
    initialSyncUI(localSync.lastSyncedAt, localSync.lastSyncSummary),
  );

  // Persist lastSyncedAt / lastSyncSummary to settings after SUCCESS
  const prevSummaryRef = useRef(ui.lastSyncSummary);
  useEffect(() => {
    if (ui.lastSyncSummary && ui.lastSyncSummary !== prevSummaryRef.current) {
      prevSummaryRef.current = ui.lastSyncSummary;
      const next = {
        ...settings,
        localSync: {
          ...settings.localSync,
          lastSyncedAt: ui.lastSyncedAt?.getTime(),
          lastSyncSummary: ui.lastSyncSummary,
        },
      };
      setSettings(next);
      saveSettings(envConfig, next).catch(() => {});
    }
  }, [ui.lastSyncSummary, ui.lastSyncedAt]);

  // Auto-dismiss from SUCCESS after 5 seconds
  useEffect(() => {
    if (ui.state !== 'success') return;
    const timer = setTimeout(() => dispatch({ type: 'DISMISS' }), 5000);
    return () => clearTimeout(timer);
  }, [ui.state]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleToggleEnabled = useCallback(async () => {
    const enabling = !localSync.enabled;
    const newLocalSync = { ...localSync, enabled: enabling };
    const newSettings = { ...settings, localSync: newLocalSync };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);

    if (!isTauriAppPlatform()) return;
    try {
      if (enabling) {
        await invoke('start_local_sync_server', { port: localSync.port });
        await invoke('start_discovery', {
          port: localSync.port,
          deviceName: localSync.deviceName || 'Readest',
        });
      } else {
        await invoke('stop_discovery');
        await invoke('stop_local_sync_server');
      }
    } catch (e) {
      console.error('[LocalSync] invoke failed:', e);
    }
  }, [envConfig, localSync, saveSettings, setSettings, settings]);

  const handleSyncNow = useCallback(async () => {
    if (ui.state !== 'idle' && ui.state !== 'error') return;

    const currentPeers = useLocalSyncStore.getState().peers;
    const currentHealth = useLocalSyncStore.getState().peerHealth;
    const reachable = filterReachablePeers(currentPeers, currentHealth);

    if (reachable.length === 0) return;

    dispatch({ type: 'START_SYNC' });

    try {
      let combinedResult: SyncResult | null = null;
      for (const peer of reachable) {
        const transport = createPeerTransport(peer);
        const result = await runSyncCycle(
          transport,
          ALL_KINDS,
          peerKey(peer.host, peer.port),
          (step) => dispatch({ type: 'SYNC_STEP', step }),
        );
        if (!combinedResult) {
          combinedResult = result;
        } else {
          // Merge per-kind counts
          for (const [kind, kr] of Object.entries(result.kinds)) {
            const existing = combinedResult.kinds[kind];
            if (existing) {
              existing.pulled += kr.pulled;
              existing.pushed += kr.pushed;
              existing.conflicts += kr.conflicts;
            } else {
              combinedResult.kinds[kind] = { ...kr };
            }
          }
          combinedResult.errors.push(...result.errors);
          combinedResult.finishedAt = result.finishedAt;
        }
      }
      const now = new Date();
      const summary = buildSyncSummary(combinedResult!);
      dispatch({ type: 'SYNC_DONE', result: combinedResult!, lastSyncedAt: now, summary });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const peerName = reachable[0]?.deviceName ?? 'unknown';
      dispatch({ type: 'SYNC_ERROR', peerId: peerName, message });
    }
  }, [ui.state]);

  // ── Tauri event listeners for peer discovery ─────────────────────────────
  useEffect(() => {
    if (!isTauriAppPlatform() || !localSync.enabled) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const addPeer = useLocalSyncStore.getState().addPeer;
        const setPeerReachable = useLocalSyncStore.getState().setPeerReachable;
        unlisten = await listen<PeerInfo & { reachable: boolean }>(
          'local-sync:peer-discovered',
          (event) => {
            console.log('[LocalSync] peer discovered:', event.payload);
            const { host, port, deviceName, version, reachable } = event.payload;
            addPeer({ host, port, deviceName, version: version ?? '0.0.0', kind: 'wifi' });
            setPeerReachable(peerKey(host, port), reachable);
          },
        );
      } catch (e) {
        console.warn('LocalSync: failed to listen for peer events', e);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [localSync.enabled]);

  // ── WiFi polling: refresh discovered peers every 5s ───────────────────────
  useEffect(() => {
    if (!isTauriAppPlatform() || !localSync.enabled) return;
    // Delay first poll to let the Rust server finish starting up
    const startPolling = () => {
      const interval = setInterval(async () => {
        try {
          const discovered: PeerInfo[] = await invoke('get_discovered_peers');
          const addPeer = useLocalSyncStore.getState().addPeer;
          const setPeerReachable = useLocalSyncStore.getState().setPeerReachable;
          for (const p of discovered) {
            addPeer(p);
            setPeerReachable(peerKey(p.host, p.port), p.reachable ?? true);
          }
          // Fallback: if mDNS found nothing, scan subnet for Readest instances
          if (discovered.length === 0) {
            const port = localSync.port;
            for (const base of ['192.168.1', '192.168.0', '10.0.0']) {
              for (let i = 30; i <= 60; i++) {
                const host = `${base}.${i}`;
                try {
                  const ctrl = new AbortController();
                  const t = setTimeout(() => ctrl.abort(), 200);
                  const resp = await fetch(`http://${host}:${port}/health`, {
                    signal: ctrl.signal,
                  });
                  clearTimeout(t);
                  if (resp.ok) {
                    const data = await resp.json();
                    addPeer({
                      host,
                      port,
                      deviceName: data.deviceName || host,
                      version: '0.0.0',
                      kind: 'wifi',
                    });
                    setPeerReachable(peerKey(host, port), true);
                    break; // found one, stop scanning this subnet
                  }
                } catch {
                  // unreachable, continue
                }
              }
            }
          }
        } catch {
          // Silently skip — backend might not be ready
        }
      }, 5000);
      return () => clearInterval(interval);
    };
    const delay = setTimeout(startPolling, 2000);
    return () => {
      clearTimeout(delay);
    };
  }, [localSync.enabled]);

  // ── USB polling: scan ADB devices and auto-configure tunnels every 5s ─────
  useEffect(() => {
    if (!isTauriAppPlatform() || !localSync.enabled) return;
    const interval = setInterval(async () => {
      try {
        const serials: string[] = await invoke('list_usb_devices');
        const port = localSync.port;
        const addPeer = useLocalSyncStore.getState().addPeer;
        const setPeerReachable = useLocalSyncStore.getState().setPeerReachable;
        for (const serial of serials) {
          // Set up tunnel
          try {
            await invoke('setup_usb_tunnel', { serial, port });
          } catch {
            // Tunnel setup may fail if already configured — continue anyway.
          }
          // Health-check via tunnel
          try {
            const resp = await fetch(`http://localhost:${port}/health`);
            if (resp.ok) {
              const data = await resp.json();
              addPeer({
                host: 'localhost',
                port,
                deviceName: data.deviceName || serial,
                version: data.version || '0.0.0',
                kind: 'usb',
              });
              setPeerReachable(peerKey('localhost', port), true);
            }
          } catch {
            // Device not reachable via tunnel yet — maybe next cycle.
          }
        }
      } catch {
        // adb not installed or no devices
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [localSync.enabled, localSync.port]);

  // ── Health-check: probe all known peers every 15s ─────────────────────────
  useEffect(() => {
    if (!localSync.enabled) return;
    const interval = setInterval(async () => {
      const peers = useLocalSyncStore.getState().peers;
      const setPeerReachable = useLocalSyncStore.getState().setPeerReachable;
      for (const p of peers) {
        // On Android, outbound TCP to LAN peers is blocked — only probe localhost
        const isLocal = p.host === 'localhost' || p.host === '127.0.0.1';
        if (!isLocal && !isTauriAppPlatform()) continue;
        // Also skip non-local on Android (detect via userAgent or osType)
        if (!isLocal && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent))
          continue;
        try {
          const resp = await fetch(`http://${p.host}:${p.port}/health`);
          setPeerReachable(peerKey(p.host, p.port), resp.ok);
        } catch {
          setPeerReachable(peerKey(p.host, p.port), false);
        }
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [localSync.enabled]);

  const description: string = localSync.enabled
    ? _('Discover and sync with nearby devices on the same WiFi network.')
    : _('Connect via USB or make sure both devices are on the same WiFi network');

  const hasPeers = peers.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Local Sync')}
        description={description}
        onBack={onBack}
      />

      <div className='space-y-5'>
        {/* ── Settings ─────────────────────────────────────────────── */}
        <BoxedList>
          <SettingsSwitchRow
            label={_('Local Sync')}
            checked={localSync.enabled}
            onChange={handleToggleEnabled}
          />
          <SettingsRow label={_('Port')}>
            <span className='text-base-content/60 text-sm tabular-nums'>{localSync.port}</span>
          </SettingsRow>
        </BoxedList>

        {/* ── Peer list ────────────────────────────────────────────── */}
        {localSync.enabled && hasPeers && (
          <BoxedList title={_('Discovered Devices')}>
            {peers.map((peer) => {
              const key = peerKey(peer.host, peer.port);
              const health = peerHealth[key];
              const dot = healthDotProps(health?.reachable, _);
              return (
                <SettingsRow
                  key={key}
                  label={
                    <span className='flex items-center gap-2'>
                      {/* Reachability indicator dot */}
                      <span
                        className={clsx(dot.colorClass, 'h-2.5 w-2.5 flex-shrink-0 rounded-full')}
                        aria-label={dot.label}
                      />
                      {peer.deviceName}
                    </span>
                  }
                  description={
                    <span className='flex items-center gap-1.5'>
                      <span className='bg-base-200/80 text-base-content/60 rounded px-1.5 py-px text-[0.75em] font-medium uppercase tracking-wide'>
                        {peerKindLabel(peer)}
                      </span>
                      {key}
                    </span>
                  }
                />
              );
            })}
          </BoxedList>
        )}

        {/* ── Empty state ──────────────────────────────────────────── */}
        {localSync.enabled && !hasPeers && (
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='flex flex-col items-center gap-3 px-4 py-8 text-center'>
              <RiWifiLine className='text-base-content/30 h-10 w-10' />
              <p className='text-base-content/60 max-w-xs text-sm leading-relaxed'>
                {_('Connect via USB or make sure both devices are on the same WiFi network')}
              </p>
            </div>
          </div>
        )}

        {/* ── Sync action area: IDLE / SYNCING / SUCCESS / ERROR ──────── */}
        {localSync.enabled && (
          <div className='flex flex-col items-end gap-2'>
            {/* ── IDLE state: last sync info + Sync Now button ── */}
            {ui.state === 'idle' && (
              <div className='flex items-center justify-end gap-3 w-full'>
                {ui.lastSyncedAt && (
                  <span className='text-base-content/50 text-xs'>
                    {_('Last synced:')}{' '}
                    {ui.lastSyncedAt.toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {ui.lastSyncSummary && (
                      <span className='ml-1.5 text-base-content/40'>{ui.lastSyncSummary}</span>
                    )}
                  </span>
                )}
                <button
                  type='button'
                  onClick={handleSyncNow}
                  disabled={false}
                  className={clsx(
                    'btn btn-primary',
                    'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                    'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
                  )}
                >
                  {_('Sync Now')}
                </button>
              </div>
            )}

            {/* ── SYNCING state: progress bar with phase steps ── */}
            {ui.state === 'syncing' && (
              <div className='w-full space-y-2'>
                <div className='flex flex-wrap gap-2 text-xs text-base-content/60'>
                  {(
                    ['connecting', 'pulling', 'merging', 'pushing', 'finalizing'] as SyncPhase[]
                  ).map((phase) => {
                    const isActive = ui.progress?.phase === phase;
                    const isDone =
                      ui.progress &&
                      ['connecting', 'pulling', 'merging', 'pushing', 'finalizing'].indexOf(phase) <
                        ['connecting', 'pulling', 'merging', 'pushing', 'finalizing'].indexOf(
                          ui.progress.phase,
                        );
                    return (
                      <span
                        key={phase}
                        className={clsx(
                          'rounded px-2 py-0.5',
                          isActive && 'bg-primary/10 text-primary font-medium',
                          isDone && 'text-base-content/40',
                          !isActive && !isDone && 'text-base-content/30',
                        )}
                      >
                        {isDone ? '✅' : isActive ? '🔄' : '⏳'}{' '}
                        {phase === 'connecting' && _('Conectando')}
                        {phase === 'pulling' && _('Recibiendo')}
                        {phase === 'merging' && _('Fusionando')}
                        {phase === 'pushing' && _('Enviando')}
                        {phase === 'finalizing' && _('Finalizando')}
                      </span>
                    );
                  })}
                </div>
                {ui.progress?.detail && (
                  <p className='text-base-content/60 text-xs'>
                    {ui.progress.detail}{' '}
                    {ui.progress.current != null && ui.progress.current > 0 && (
                      <span className='tabular-nums'>({ui.progress.current})</span>
                    )}
                  </p>
                )}
                <button
                  type='button'
                  disabled={true}
                  className={clsx(
                    'btn btn-primary opacity-60',
                    'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                  )}
                >
                  {_('Sincronizando…')}
                </button>
              </div>
            )}

            {/* ── SUCCESS state: summary card ── */}
            {ui.state === 'success' && ui.result && (
              <div className='card eink-bordered border-base-200 bg-base-100 w-full border px-4 py-3'>
                <p className='text-sm font-medium text-base-content flex items-center gap-1.5'>
                  ✅ {_('Sincronización completada')}
                </p>
                <p className='text-xs text-base-content/60 mt-1'>
                  {new Date(ui.result.finishedAt).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <div className='mt-2 flex flex-wrap gap-3 text-xs text-base-content/70'>
                  {(() => {
                    let totalPulled = 0;
                    let totalPushed = 0;
                    let totalConflicts = 0;
                    for (const kr of Object.values(ui.result.kinds)) {
                      totalPulled += kr.pulled;
                      totalPushed += kr.pushed;
                      totalConflicts += kr.conflicts;
                    }
                    return (
                      <>
                        <span>
                          📥 {_('recibido')}: {totalPulled}
                        </span>
                        <span>
                          📤 {_('enviado')}: {totalPushed}
                        </span>
                        <span>
                          ⚡ {_('conflictos')}: {totalConflicts}
                        </span>
                      </>
                    );
                  })()}
                </div>
                {ui.result.errors.length > 0 && (
                  <p className='mt-1 text-xs text-amber-600'>
                    ⚠ {ui.result.errors.length} {_('error(es) en la sincronización')}
                  </p>
                )}
              </div>
            )}

            {/* ── ERROR state: error message + Retry / Dismiss ── */}
            {ui.state === 'error' && (
              <div className='card eink-bordered border-base-200 bg-base-100 w-full border px-4 py-3'>
                <p className='text-sm font-medium text-red-600 flex items-center gap-1.5'>
                  ❌ {_('Error al sincronizar')}
                </p>
                <p className='text-xs text-base-content/70 mt-1'>{ui.errorMessage}</p>
                {ui.errorPeerId && (
                  <p className='text-xs text-base-content/50 mt-0.5'>
                    {_('Peer')}: {ui.errorPeerId}
                  </p>
                )}
                <p className='text-xs text-base-content/50 mt-2'>
                  {ui.errorMessage.includes('refused') || ui.errorMessage.includes('ECONNREFUSED')
                    ? _('¿Está el otro dispositivo encendido y con sync activado?')
                    : _('Verifica la conexión e inténtalo de nuevo.')}
                </p>
                <div className='mt-3 flex gap-2'>
                  <button
                    type='button'
                    onClick={handleSyncNow}
                    className={clsx(
                      'btn btn-primary',
                      'h-8 min-h-8 rounded-lg border-0 px-4 text-xs font-medium',
                    )}
                  >
                    {_('Reintentar')}
                  </button>
                  <button
                    type='button'
                    onClick={() => dispatch({ type: 'DISMISS' })}
                    className={clsx(
                      'btn btn-ghost',
                      'h-8 min-h-8 rounded-lg border-0 px-4 text-xs font-medium',
                    )}
                  >
                    {_('Cerrar')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LocalSyncPanel;
