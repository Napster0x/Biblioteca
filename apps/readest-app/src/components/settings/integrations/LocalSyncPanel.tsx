import clsx from 'clsx';
import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLocalSyncStore, type UsbSyncState } from '@/store/localSyncStore';
import { isTauriAppPlatform } from '@/services/environment';
import { createPeerTransport, runSyncCycle } from '@/services/sync/localSyncUtils';
import SubPageHeader from '../SubPageHeader';
import { BoxedList, SettingsRow, SettingsSwitchRow } from '../primitives';
import type { PeerInfo, SyncCategory } from '@/types/settings';
import type { SyncPhase, SyncResult, SyncStep } from '@/types/replica';

const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

interface LocalSyncPanelProps {
  onBack: () => void;
}

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

interface UsbDeviceStatus {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline';
  model?: string;
}

interface UsbStatusCopy {
  title: string;
  action?: string;
}

const ALL_KINDS: readonly SyncCategory[] = ['annotation', 'quote', 'dictionary-entry'];
const USB_HOST = 'localhost';

function usbPeerId(port: number): string {
  return `usb:${USB_HOST}:${port}`;
}

function buildUsbPeer(port: number, serial: string, health: unknown): PeerInfo {
  const healthData = health && typeof health === 'object' ? health : {};
  const deviceName =
    'deviceName' in healthData && typeof healthData.deviceName === 'string'
      ? healthData.deviceName
      : serial;
  const version =
    'version' in healthData && typeof healthData.version === 'string'
      ? healthData.version
      : '0.0.0';
  return { host: USB_HOST, port, deviceName, version, kind: 'usb', reachable: true };
}

function buildSyncSummary(result: SyncResult): string {
  let totalPulled = 0;
  let totalPushed = 0;
  let totalConflicts = 0;
  for (const kindResult of Object.values(result.kinds)) {
    totalPulled += kindResult.pulled;
    totalPushed += kindResult.pushed;
    totalConflicts += kindResult.conflicts;
  }
  return `📥 ${totalPulled} — 📤 ${totalPushed} — ⚡ ${totalConflicts} — ${result.peerId}`;
}

function statusCopy(state: UsbSyncState, errorMessage: string): UsbStatusCopy {
  switch (state) {
    case 'checking-adb':
      return { title: 'Checking ADB…', action: 'Looking for Android Platform Tools.' };
    case 'adb-missing':
      return {
        title: 'ADB is not installed or not available in PATH.',
        action: 'Install Android Platform Tools and restart Biblioteca.',
      };
    case 'no-device':
      return {
        title: 'No Android device detected over USB.',
        action: 'Connect your Android device with USB and enable USB debugging.',
      };
    case 'unauthorized':
      return {
        title: 'USB debugging is not authorized yet.',
        action: 'Accept the RSA fingerprint prompt on Android.',
      };
    case 'configuring-tunnel':
      return { title: 'Configuring USB tunnel…', action: 'Preparing adb forward to localhost.' };
    case 'server-unreachable':
      return {
        title: 'Android sync server is not reachable.',
        action: 'Open Biblioteca on Android and enable Local Sync there.',
      };
    case 'ready':
      return { title: 'USB device ready', action: 'Manual sync is available.' };
    case 'syncing':
      return { title: 'Syncing…', action: 'Keep the USB cable connected.' };
    case 'success':
      return {
        title: 'Sync completed',
        action: 'Data has been transferred. Check the other device.',
      };
    case 'error':
      return {
        title: 'USB sync failed',
        action: errorMessage || 'Check the USB connection and try again.',
      };
    case 'off':
    default:
      return {
        title: 'Connect your Android device with USB and enable ADB debugging.',
        action: 'Turn Local Sync on to check ADB, configure the tunnel, and unlock manual sync.',
      };
  }
}

const LocalSyncPanel: React.FC<LocalSyncPanelProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const usbState = useLocalSyncStore((s) => s.usbState);
  const usbPeer = useLocalSyncStore((s) => s.usbPeer);
  const errorMessage = useLocalSyncStore((s) => s.errorMessage);
  const setUsbState = useLocalSyncStore((s) => s.setUsbState);
  const setUsbPeer = useLocalSyncStore((s) => s.setUsbPeer);
  const setSyncPort = useLocalSyncStore((s) => s.setSyncPort);
  const setLastResult = useLocalSyncStore((s) => s.setLastResult);
  const resetUsbSync = useLocalSyncStore((s) => s.resetUsbSync);

  const localSync = settings.localSync;
  const [enabled, setEnabled] = useState(localSync.enabled);
  const [ui, dispatch] = useReducer(
    syncUIReducer,
    initialSyncUI(localSync.lastSyncedAt, localSync.lastSyncSummary),
  );

  useEffect(() => {
    setEnabled(localSync.enabled);
    setSyncPort(localSync.port);
  }, [localSync.enabled, localSync.port, setSyncPort]);

  useEffect(() => {
    if (ui.state !== 'success') return;
    const timer = setTimeout(() => dispatch({ type: 'DISMISS' }), 5000);
    return () => clearTimeout(timer);
  }, [ui.state]);

  useEffect(() => {
    if (!ui.lastSyncSummary) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.lastSyncSummary, ui.lastSyncedAt]);

  const configureUsb = useCallback(async () => {
    const port = localSync.port;
    setSyncPort(port);
    setUsbPeer(null);
    setUsbState('checking-adb');

    try {
      await invoke('check_adb');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUsbState('adb-missing', message);
      return;
    }

    const devices = await invoke<UsbDeviceStatus[]>('list_usb_devices_detailed');
    if (devices.length === 0) {
      setUsbState('no-device');
      return;
    }

    const authorized = devices.find((device) => device.state === 'device');
    if (!authorized) {
      const hasUnauthorized = devices.some((device) => device.state === 'unauthorized');
      setUsbState(hasUnauthorized ? 'unauthorized' : 'no-device');
      return;
    }

    setUsbState('configuring-tunnel');
    try {
      await invoke('setup_usb_tunnel', { serial: authorized.serial, port });
      const response = await fetch(`http://localhost:${port}/health`);
      if (!response.ok) {
        setUsbState('server-unreachable');
        return;
      }
      const health = (await response.json()) as unknown;
      setUsbPeer(buildUsbPeer(port, authorized.model ?? authorized.serial, health));
      setUsbState('ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUsbState('server-unreachable', message);
    }
  }, [localSync.port, setSyncPort, setUsbPeer, setUsbState]);

  const handleToggleEnabled = useCallback(async () => {
    const enabling = !enabled;
    setEnabled(enabling);
    const newSettings = { ...settings, localSync: { ...localSync, enabled: enabling } };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);

    if (!enabling) {
      if (isTauriAppPlatform()) {
        try {
          await invoke('stop_local_sync_server');
        } catch {
          /* best-effort */
        }
      }
      resetUsbSync();
      return;
    }
    if (!isTauriAppPlatform()) {
      setUsbState('error', 'USB local sync requires the Tauri desktop app.');
      return;
    }
    // Desktop: coordinate via ADB. Android: start the HTTP server.
    if (isAndroid()) {
      try {
        await invoke('start_local_sync_server', { port: localSync.port });
        setUsbState('ready');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setUsbState('server-unreachable', message);
      }
    } else {
      await configureUsb();
    }
  }, [
    configureUsb,
    enabled,
    envConfig,
    localSync,
    resetUsbSync,
    saveSettings,
    setSettings,
    setUsbState,
    settings,
  ]);

  const handleSyncNow = useCallback(async () => {
    const canSync = usbState === 'ready' || (usbState === 'error' && usbPeer);
    if (!canSync || !usbPeer || ui.state === 'syncing') return;

    setUsbState('syncing');
    dispatch({ type: 'START_SYNC' });
    try {
      const result = await runSyncCycle(
        createPeerTransport(usbPeer),
        ALL_KINDS,
        usbPeerId(usbPeer.port),
        (step) => dispatch({ type: 'SYNC_STEP', step }),
      );
      const now = new Date();
      const summary = buildSyncSummary(result);
      setLastResult(result);
      if (result.errors.length > 0) {
        const message = result.errors.map((error) => `${error.kind}: ${error.message}`).join('\n');
        setUsbState('error', message);
        dispatch({ type: 'SYNC_ERROR', peerId: usbPeer.deviceName, message });
        return;
      }
      setUsbState('success');
      dispatch({ type: 'SYNC_DONE', result, lastSyncedAt: now, summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUsbState('error', message);
      dispatch({ type: 'SYNC_ERROR', peerId: usbPeer.deviceName, message });
    }
  }, [setLastResult, setUsbState, ui.state, usbPeer, usbState]);

  const copy = statusCopy(usbState, errorMessage);
  const syncButtonDisabled = usbState !== 'ready' || ui.state === 'syncing';

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Local Sync')}
        description={_('Connect your Android device with USB and enable ADB debugging.')}
        onBack={onBack}
      />

      <div className='space-y-5'>
        <BoxedList>
          <SettingsSwitchRow
            label={_('Local Sync')}
            checked={enabled}
            onChange={handleToggleEnabled}
          />
          <SettingsRow label={_('Port')}>
            <span className='text-base-content/60 text-sm tabular-nums'>{localSync.port}</span>
          </SettingsRow>
        </BoxedList>

        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='space-y-2 px-4 py-5'>
            <p className='text-base-content text-sm font-medium'>{_(copy.title)}</p>
            {copy.action && (
              <p className='text-base-content/60 text-sm leading-relaxed'>{_(copy.action)}</p>
            )}
            {usbPeer && (
              <p className='text-base-content/50 text-xs'>
                USB · {usbPeer.deviceName} · {usbPeerId(usbPeer.port)}
              </p>
            )}
          </div>
        </div>

        {enabled && (
          <div className='flex flex-col items-end gap-2'>
            {ui.state === 'syncing' && (
              <div className='w-full space-y-2'>
                <div className='flex flex-wrap gap-2 text-xs text-base-content/60'>
                  {(
                    ['connecting', 'pulling', 'merging', 'pushing', 'finalizing'] as SyncPhase[]
                  ).map((phase) => {
                    const isActive = ui.progress?.phase === phase;
                    return (
                      <span
                        key={phase}
                        className={clsx(
                          'rounded px-2 py-0.5',
                          isActive
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-base-content/40',
                        )}
                      >
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
                  <p className='text-base-content/60 text-xs'>{ui.progress.detail}</p>
                )}
              </div>
            )}

            {ui.state === 'success' && ui.result && (
              <div className='card eink-bordered border-base-200 bg-base-100 w-full border px-4 py-3'>
                <p className='text-sm font-medium text-base-content'>
                  ✅ {_('Transferencia CRDT completada')}
                </p>
                <div className='mt-2 flex flex-wrap gap-3 text-xs text-base-content/70'>
                  {(() => {
                    let totalPulled = 0;
                    let totalPushed = 0;
                    let totalConflicts = 0;
                    for (const result of Object.values(ui.result.kinds)) {
                      totalPulled += result.pulled;
                      totalPushed += result.pushed;
                      totalConflicts += result.conflicts;
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

            {ui.state === 'error' && (
              <div className='card eink-bordered border-base-200 bg-base-100 w-full border px-4 py-3'>
                <p className='text-sm font-medium text-red-600'>❌ {_('Error al sincronizar')}</p>
                <p className='text-xs text-base-content/70 mt-1 whitespace-pre-wrap'>
                  {ui.errorMessage}
                </p>
                <button
                  type='button'
                  onClick={handleSyncNow}
                  className='btn btn-primary mt-3 h-8 min-h-8 rounded-lg border-0 px-4 text-xs font-medium'
                >
                  {_('Reintentar')}
                </button>
              </div>
            )}

            {(ui.state === 'idle' || ui.state === 'success') && ui.lastSyncedAt && (
              <span className='text-base-content/50 text-xs'>
                {_('Last synced:')}{' '}
                {ui.lastSyncedAt.toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
            {(ui.state === 'idle' || ui.state === 'success' || ui.state === 'error') && (
              <button
                type='button'
                onClick={handleSyncNow}
                disabled={syncButtonDisabled}
                className={clsx(
                  'btn btn-primary h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                  syncButtonDisabled && 'opacity-60',
                )}
              >
                {_('Sync Now')}
              </button>
            )}
            {ui.state === 'syncing' && (
              <button
                type='button'
                disabled={true}
                className='btn btn-primary h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium opacity-60'
              >
                {_('Sincronizando…')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LocalSyncPanel;
