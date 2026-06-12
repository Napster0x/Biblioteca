import { create } from 'zustand';
import { stubTranslation as _ } from '@/utils/misc';
import type { PeerInfo } from '@/types/settings';
import type { SyncResult } from '@/types/replica';

_('Local Sync');
_('Not connected');
_('Connected');
_('Syncing…');
_('Sync Now');
_('Connect your Android device with USB and enable ADB debugging.');
_('USB device ready');
_('ADB is not installed or not available in PATH.');
_('No Android device detected over USB.');
_('USB debugging is not authorized yet.');
_('Android sync server is not reachable.');
_('USB CRDT transfer completed');
_('Visible-data convergence is still blocked by the server repository gate.');
_('Transferencia CRDT completada');
_('Convergencia visible pendiente: el servidor Android todavía usa JSON shadow.');

/** Peer key format: `host:port` (e.g. `localhost:7878`). */
export type PeerKey = string;

/** Build a PeerKey from host and port. */
export function peerKey(host: string, port: number): PeerKey {
  return `${host}:${port}`;
}

export type UsbSyncState =
  | 'off'
  | 'checking-adb'
  | 'adb-missing'
  | 'no-device'
  | 'unauthorized'
  | 'configuring-tunnel'
  | 'server-unreachable'
  | 'ready'
  | 'syncing'
  | 'success'
  | 'error';

interface LocalSyncState {
  usbState: UsbSyncState;
  usbPeer: PeerInfo | null;
  syncPort: number;
  lastResult: SyncResult | null;
  errorMessage: string;

  setUsbState: (usbState: UsbSyncState, errorMessage?: string) => void;
  setUsbPeer: (peer: PeerInfo | null) => void;
  setSyncPort: (syncPort: number) => void;
  setLastResult: (lastResult: SyncResult | null) => void;
  resetUsbSync: () => void;
}

const initialUsbState = {
  usbState: 'off' as UsbSyncState,
  usbPeer: null,
  syncPort: 7878,
  lastResult: null,
  errorMessage: '',
};

export const useLocalSyncStore = create<LocalSyncState>((set) => ({
  ...initialUsbState,

  setUsbState: (usbState, errorMessage = '') => set({ usbState, errorMessage }),
  setUsbPeer: (usbPeer) => set({ usbPeer }),
  setSyncPort: (syncPort) => set({ syncPort }),
  setLastResult: (lastResult) => set({ lastResult }),
  resetUsbSync: () => set({ ...initialUsbState }),
}));
