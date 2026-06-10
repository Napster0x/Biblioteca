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
  const { isSyncing, syncNow: triggerSync } = useReplicaSync();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const peers = useLocalSyncStore((s) => s.peers);
  const peerHealth = useLocalSyncStore((s) => s.peerHealth);

  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

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
    setIsSyncingNow(true);
    try {
      await triggerSync();
      setLastSyncedAt(new Date());
    } finally {
      setIsSyncingNow(false);
    }
  }, [isSyncingNow, triggerSync]);

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

        {/* ── Sync Now + last synced ────────────────────────────────── */}
        {localSync.enabled && (
          <div className='flex items-center justify-end gap-3'>
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
              {isSyncingNow ? (
                <span className='loading loading-spinner loading-sm' />
              ) : (
                _('Sync Now')
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LocalSyncPanel;
