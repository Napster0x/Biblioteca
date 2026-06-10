import { create } from 'zustand';
import { stubTranslation as _ } from '@/utils/misc';
import type { PeerInfo } from '@/types/settings';

/**
 * i18n keys registered for scanner extraction. These labels are consumed
 * by the LocalSyncPanel React component (Phase 6); the stubTranslation
 * calls here ensure the extraction tool discovers them during
 * `pnpm i18n:extract`.
 */
_('Local Sync');
_('Not connected');
_('Connected');
_('Syncing…');
_('Sync Now');
_('Connect via USB or make sure both devices are on the same WiFi network');
_('Discover and sync with nearby devices on the same WiFi network.');
_('Discovered Devices');
_('Unknown');
_('Last synced:');

/** Peer key format: `host:port` (e.g. `192.168.1.5:7878`). */
export type PeerKey = string;

/** Build a PeerKey from host and port. */
export function peerKey(host: string, port: number): PeerKey {
  return `${host}:${port}`;
}

interface LocalSyncState {
  /** mDNS-discovered peers. Upserted keyed on host+port. */
  peers: PeerInfo[];
  /** Whether mDNS discovery is currently browsing. */
  isDiscovering: boolean;
  /**
   * Reachability state per peer, keyed by `host:port`.
   * Absent key means health has NOT been checked yet.
   */
  peerHealth: Record<PeerKey, { reachable: boolean }>;

  /** Add or update a peer (upsert by host:port). */
  addPeer: (peer: PeerInfo) => void;
  /** Remove a peer by host. */
  removePeer: (host: string) => void;
  /** Clear all discovered peers. */
  clearPeers: () => void;
  /** Set the reachability of a peer. */
  setPeerReachable: (key: PeerKey, reachable: boolean) => void;
  /** Signal that discovery has started. */
  startDiscovery: () => void;
  /** Signal that discovery has stopped. */
  stopDiscovery: () => void;
}

export const useLocalSyncStore = create<LocalSyncState>((set) => ({
  peers: [],
  isDiscovering: false,
  peerHealth: {},

  addPeer: (peer) =>
    set((state) => {
      const idx = state.peers.findIndex((p) => p.host === peer.host && p.port === peer.port);
      if (idx >= 0) {
        const peers = [...state.peers];
        peers[idx] = peer;
        return { peers };
      }
      return { peers: [...state.peers, peer] };
    }),

  removePeer: (host) =>
    set((state) => ({
      peers: state.peers.filter((p) => p.host !== host),
    })),

  clearPeers: () => set({ peers: [], peerHealth: {} }),

  setPeerReachable: (key, reachable) =>
    set((state) => ({
      peerHealth: { ...state.peerHealth, [key]: { reachable } },
    })),

  startDiscovery: () => set({ isDiscovering: true }),

  stopDiscovery: () => set({ isDiscovering: false }),
}));
