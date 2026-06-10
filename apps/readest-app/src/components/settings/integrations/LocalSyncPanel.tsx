import clsx from 'clsx';
import React, { useState, useCallback, useEffect } from 'react';
import { RiWifiLine } from 'react-icons/ri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useReplicaSync } from '@/hooks/useReplicaSync';
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
import type { PeerInfo } from '@/types/settings';

interface LocalSyncPanelProps {
  onBack: () => void;
}

/** Derive a human-readable connection type label from the peer host. */
function connectionType(host: string): string {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return 'USB';
  }
  return 'WiFi';
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
  const { isSyncing } = useReplicaSync();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const peers = useLocalSyncStore((s) => s.peers);
  const peerHealth = useLocalSyncStore((s) => s.peerHealth);

  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number } | null>(
    null,
  );

  const localSync = settings.localSync;

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
    if (isSyncingNow) return;

    const currentPeers = useLocalSyncStore.getState().peers;
    const currentHealth = useLocalSyncStore.getState().peerHealth;
    const reachable = filterReachablePeers(currentPeers, currentHealth);
    console.log('[Sync] reachable peers:', reachable.length, reachable);

    if (reachable.length === 0) return;

    setIsSyncingNow(true);
    setSyncProgress({ completed: 0, total: reachable.length });

    try {
      for (let i = 0; i < reachable.length; i++) {
        const peer = reachable[i]!;
        const transport = createPeerTransport(peer);
        console.log('[Sync] syncing with', peer.host, peer.port);
        await runSyncCycle(transport);
        console.log('[Sync] done with', peer.host);
        setSyncProgress({ completed: i + 1, total: reachable.length });
      }
      setLastSyncedAt(new Date());
    } finally {
      setIsSyncingNow(false);
      setSyncProgress(null);
    }
  }, [isSyncingNow]);

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
            addPeer({ host, port, deviceName, version: version ?? '0.0.0' });
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
                    addPeer({ host, port, deviceName: data.deviceName || host, version: '0.0.0' });
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
                        {connectionType(peer.host)}
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

        {/* ── Sync Now + progress + last synced ──────────────────────── */}
        {localSync.enabled && (
          <div className='flex flex-col items-end gap-2'>
            {/* Progress bar */}
            {isSyncingNow && syncProgress && (
              <div className='w-full space-y-1'>
                <p className='text-base-content/60 text-xs text-right'>
                  {_('Syncing…')}{' '}
                  <span className='tabular-nums'>
                    {syncProgress.completed}/{syncProgress.total}
                  </span>
                </p>
                <div className='w-full bg-base-200 rounded-full h-1.5'>
                  <div
                    className='bg-primary h-1.5 rounded-full transition-all duration-300'
                    style={{
                      width: `${(syncProgress.completed / syncProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Last synced + button row */}
            <div className='flex items-center justify-end gap-3 w-full'>
              {lastSyncedAt && (
                <span className='text-base-content/50 text-xs'>
                  {_('Last synced:')}{' '}
                  {lastSyncedAt.toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
              <button
                type='button'
                onClick={handleSyncNow}
                disabled={isSyncingNow || isSyncing}
                className={clsx(
                  'btn btn-primary',
                  'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                  'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
                  isSyncingNow && 'opacity-60',
                )}
              >
                {_('Sync Now')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LocalSyncPanel;
